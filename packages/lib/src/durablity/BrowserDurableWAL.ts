import { WALManagerFactory } from "../factory/WALManagerFactory";
import {
  ReplayResult,
  RetryConfig,
  DurabilityConfig,
  IWALManager,
  IDurabilityManager,
} from "../types/types";
import { WALBuilder } from "../wal/WAL";

/**
 * Default retry configuration for browser WAL operations
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
};

/**
 * BrowserDurableWal
 *
 * A browser-safe durability manager that:
 * - Handles replaying events from browser storage (IndexedDB, LocalStorage, etc.)
 * - Provides retry logic with exponential backoff
 * - Ensures sequential replay for consistency
 * - Delegates persistence to a browser-specific WAL manager
 */
export class BrowserDurableWAL implements IDurabilityManager {
  private readonly walManager: IWALManager;
  private readonly walFileName: string;
  private readonly retryConfig: RetryConfig;
  private readonly onEventProcessed?: (event: string, success: boolean) => void;
  private isReplaying = false;

  constructor(config: DurabilityConfig) {
    this.walManager = WALManagerFactory.create("BROWSER");
    this.walFileName = config.walFileName;
    this.walManager.register(new WALBuilder().file(this.walFileName).build());
    this.retryConfig = config.retryConfig ?? DEFAULT_RETRY_CONFIG;
    this.onEventProcessed = config.onEventProcessed;
  }

  /**
   * Append data to the WAL
   */
  async append(content: string): Promise<void> {
    await this.walManager.append(this.walFileName, content);
  }

  /**
   * Read the full WAL contents
   */
  async read(): Promise<string> {
    return await this.walManager.read(this.walFileName);
  }

  /**
   * Replay the last N events with retry + backoff logic
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

      const eventsToReplay = count <= 0 ? [] : events.slice(-count);

      const result: ReplayResult = {
        success: true,
        processedCount: 0,
        failedCount: 0,
        errors: [],
      };

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
   * Process a single event with exponential backoff and retry
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
        return true;
      } catch (error) {
        lastError = error as Error;

        if (attempt < this.retryConfig.maxRetries) {
          const delay = this.calculateBackoffDelay(attempt);
          await this.sleep(delay);
        }
      }
    }

    // All retries exhausted
    if (lastError) {
      console.error(
        `Failed to process event after ${attemptCount} attempts:`,
        event,
        lastError
      );
    }

    return false;
  }

  /**
   * Exponential backoff delay with jitter
   */
  private calculateBackoffDelay(attempt: number): number {
    const exponentialDelay =
      this.retryConfig.initialDelayMs *
      Math.pow(this.retryConfig.backoffMultiplier, attempt);

    const cappedDelay = Math.min(exponentialDelay, this.retryConfig.maxDelayMs);
    const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1);

    return Math.floor(cappedDelay + jitter);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get total number of events in the WAL
   */
  async getEventCount(): Promise<number> {
    const content = await this.walManager.read(this.walFileName);
    return content.split("\n").filter((line) => line.trim().length > 0).length;
  }

  /**
   * Replay status
   */
  get isReplayInProgress(): boolean {
    return this.isReplaying;
  }
}

export type BrowserDurableWalType = BrowserDurableWAL;
