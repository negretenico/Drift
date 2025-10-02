import { WALManager } from "../walmanager/WalManager";
export interface ReplayResult {
  success: boolean;
  processedCount: number;
  failedCount: number;
  errors: Array<{ event: string; error: Error; attemptCount: number }>;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export interface DurabilityConfig {
  walFileName: string;
  retryConfig?: RetryConfig;
  onEventProcessed?: (event: string, success: boolean) => void;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
};

/**
 * DurabilityManager handles replaying events from WAL with retry logic and backoff
 *
 * Design decisions:
 * - Sequential processing: Events must be processed in order to maintain consistency
 * - Exponential backoff: Prevents overwhelming downstream systems during failures
 * - Configurable retry: Allows tuning based on system characteristics
 * - Detailed result tracking: Enables observability and debugging
 */
export class DurabilityManager {
  private readonly walManager: WALManager;
  private readonly walFileName: string;
  private readonly retryConfig: RetryConfig;
  private readonly onEventProcessed?: (event: string, success: boolean) => void;

  // Track in-flight replay to prevent concurrent replays
  private isReplaying = false;

  constructor(config: DurabilityConfig) {
    this.walManager = WALManager.getInstance();
    this.walFileName = config.walFileName;
    this.retryConfig = config.retryConfig ?? DEFAULT_RETRY_CONFIG;
    this.onEventProcessed = config.onEventProcessed;
  }

  async append(content: string): Promise<void> {
    await this.walManager.append(this.walFileName, content);
  }

  async read(): Promise<string> {
    return await this.walManager.read(this.walFileName);
  }

  /**
   * Replay the last N events from the WAL
   * Events are processed sequentially with retry logic
   *
   * @param count Number of events to replay (from the end)
   * @param processor Function that processes each event
   * @returns Result summary of the replay operation
   */
  async replay(
    count: number,
    processor: (event: string) => Promise<void>
  ): Promise<ReplayResult> {
    if (this.isReplaying) {
      throw new Error("Replay already in progress");
    }

    this.isReplaying = true;

    try {
      const content = await this.walManager.read(this.walFileName);
      const events = content
        .split("\n")
        .filter((line) => line.trim().length > 0);

      // Get last N events
      // Handle edge case: slice(-0) returns all events, so check for count <= 0
      const eventsToReplay = count <= 0 ? [] : events.slice(-count);

      const result: ReplayResult = {
        success: true,
        processedCount: 0,
        failedCount: 0,
        errors: [],
      };

      // Process events sequentially (critical for consistency)
      for (const event of eventsToReplay) {
        const success = await this.processEventWithRetry(event, processor);

        if (success) {
          result.processedCount++;
          this.onEventProcessed?.(event, true);
        } else {
          result.failedCount++;
          result.success = false;
          this.onEventProcessed?.(event, false);
        }
      }

      return result;
    } finally {
      this.isReplaying = false;
    }
  }

  /**
   * Process a single event with exponential backoff retry logic
   *
   * Algorithm:
   * 1. Try to process the event
   * 2. On failure, wait with exponential backoff
   * 3. Retry up to maxRetries times
   * 4. Return success/failure status
   *
   * @param event The event to process
   * @param processor Function that processes the event
   * @returns true if successful, false if all retries exhausted
   */
  private async processEventWithRetry(
    event: string,
    processor: (event: string) => Promise<void>
  ): Promise<boolean> {
    let lastError: Error | null = null;
    let attemptCount = 0;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      attemptCount++;

      try {
        await processor(event);
        return true; // Success!
      } catch (error) {
        lastError = error as Error;

        // Don't wait after the last attempt
        if (attempt < this.retryConfig.maxRetries) {
          const delay = this.calculateBackoffDelay(attempt);
          await this.sleep(delay);
        }
      }
    }

    // All retries exhausted
    if (lastError) {
      // Track the failure for observability
      // In production, this would be logged to monitoring system
      console.error(
        `Failed to process event after ${attemptCount} attempts:`,
        event,
        lastError
      );
    }

    return false;
  }

  /**
   * Calculate exponential backoff delay with jitter
   *
   * Formula: min(maxDelay, initialDelay * (multiplier ^ attempt)) + jitter
   *
   * Jitter (randomization) prevents thundering herd problem when multiple
   * instances retry simultaneously
   *
   * @param attempt Current attempt number (0-indexed)
   * @returns Delay in milliseconds
   */
  private calculateBackoffDelay(attempt: number): number {
    const exponentialDelay =
      this.retryConfig.initialDelayMs *
      Math.pow(this.retryConfig.backoffMultiplier, attempt);

    // Cap at max delay
    const cappedDelay = Math.min(exponentialDelay, this.retryConfig.maxDelayMs);

    // Add jitter (±25% randomization)
    const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1);

    return Math.floor(cappedDelay + jitter);
  }

  /**
   * Utility to sleep for a given duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get statistics about the WAL
   */
  async getEventCount(): Promise<number> {
    const content = await this.walManager.read(this.walFileName);
    return content.split("\n").filter((line) => line.trim().length > 0).length;
  }

  /**
   * Check if a replay is currently in progress
   */
  get isReplayInProgress(): boolean {
    return this.isReplaying;
  }
}
