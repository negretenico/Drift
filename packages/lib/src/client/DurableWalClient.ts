import { randomUUID } from "../browermanager/randomUUID";
import { IDurabilityManager, WalClient, WalEntry } from "../types/types";

/**
 * DurableWalClient provides a user-facing abstraction on top of
 * any IDurabilityManager (browser, node, etc.).
 *
 * It handles:
 * - Entry creation with metadata
 * - JSON serialization/deserialization
 * - Replay safety and error handling
 */
export class DurableWalClient implements WalClient {
  private readonly durabilityManager: IDurabilityManager;

  constructor(durabilityManager: IDurabilityManager) {
    this.durabilityManager = durabilityManager;
  }

  /**
   * Append user content to the WAL with metadata.
   *
   * @param content - User data to append
   * @returns Unique entry ID
   */
  async append(content: string): Promise<string> {
    if (!content || content.trim().length === 0) {
      throw new Error("Cannot append empty content");
    }

    const entry: WalEntry = {
      id: randomUUID(),
      timestamp: Date.now(),
      data: content,
    };

    await this.durabilityManager.append(JSON.stringify(entry));
    return entry.id;
  }

  /**
   * Replay the last N events from the WAL.
   *
   * @param eventNum - Number of events to replay from the end
   * @param processor - Function to process each event's data
   */
  async replay(
    eventNum: number,
    processor: (event: string) => Promise<void>
  ): Promise<void> {
    if (eventNum < 0) throw new Error("Event number must be non-negative");
    if (!processor || typeof processor !== "function")
      throw new Error("Processor function is required");

    const wrappedProcessor = async (serialized: string) => {
      try {
        const entry: WalEntry = JSON.parse(serialized);
        await processor(entry.data);
      } catch {
        // Legacy fallback
        await processor(serialized);
      }
    };

    const result = await this.durabilityManager.replay(
      eventNum,
      wrappedProcessor
    );
    if (!result.success) {
      throw new Error(
        `Replay failed: ${result.failedCount} events failed out of ${
          result.processedCount + result.failedCount
        }`
      );
    }
  }

  /**
   * Inspect the last N events from the WAL.
   *
   * @param numberOfEvents - Number of events to retrieve
   * @returns Array of user data strings (metadata stripped)
   */
  async inspect(numberOfEvents: number): Promise<string[]> {
    if (numberOfEvents < 0)
      throw new Error("Number of events must be non-negative");

    const content = await this.durabilityManager.read();
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    const lastN = numberOfEvents <= 0 ? [] : lines.slice(-numberOfEvents);

    return lastN.map((line) => {
      try {
        const entry: WalEntry = JSON.parse(line);
        return entry.data;
      } catch {
        return line;
      }
    });
  }
}
