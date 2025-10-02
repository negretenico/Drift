import {
  DurabilityManager,
  DurabilityConfig,
} from "../durablity/DurabilityManager";
import { randomUUID } from "crypto";
import { WalClient, WalEntry } from "./interfaces";

interface DurableWalConfig {
  durableConfig: DurabilityConfig;
}

/**
 * DurableWal provides a high-level client interface for WAL operations
 *
 * Responsibilities:
 * - Entry ID generation and management
 * - Data serialization/deserialization (user data <-> WAL format)
 * - Delegates all WAL operations to DurabilityManager
 * - Clean API abstraction for clients
 *
 * Design principle: Single source of truth - DurabilityManager owns all WAL operations
 */
export class DurableWal implements WalClient {
  private durableManager: DurabilityManager;

  constructor({ durableConfig }: DurableWalConfig) {
    this.durableManager = new DurabilityManager(durableConfig);
  }

  /**
   * Append data to the WAL with metadata
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

    const serialized = JSON.stringify(entry);
    await this.durableManager.append(serialized);

    return entry.id;
  }

  /**
   * Replay the last N events from the WAL
   *
   * @param eventNum - Number of events to replay from the end
   * @param processor - Function to process each event's data
   */
  async replay(
    eventNum: number,
    processor: (event: string) => Promise<void>
  ): Promise<void> {
    if (eventNum < 0) {
      throw new Error("Event number must be non-negative");
    }

    if (!processor || typeof processor !== "function") {
      throw new Error("Processor function is required");
    }

    // Wrap the processor to deserialize WAL entries
    const wrappedProcessor = async (serialized: string) => {
      try {
        const entry: WalEntry = JSON.parse(serialized);
        await processor(entry.data);
      } catch (error) {
        // If JSON parsing fails, treat as legacy format (raw string)
        await processor(serialized);
      }
    };

    const result = await this.durableManager.replay(eventNum, wrappedProcessor);

    if (!result.success) {
      throw new Error(
        `Replay failed: ${result.failedCount} events failed out of ${
          result.processedCount + result.failedCount
        }`
      );
    }
  }

  /**
   * Inspect the last N events from the WAL
   *
   * @param numberOfEvents - Number of events to retrieve from the end
   * @returns Array of user data strings (metadata stripped)
   */
  async inspect(numberOfEvents: number): Promise<string[]> {
    if (numberOfEvents < 0) {
      throw new Error("Number of events must be non-negative");
    }

    const content = await this.durableManager.read();
    const lines = content.split("\n").filter((line) => line.trim().length > 0);

    // Get last N lines
    const lastN = numberOfEvents <= 0 ? [] : lines.slice(-numberOfEvents);

    // Deserialize and extract data
    return lastN.map((line) => {
      try {
        const entry: WalEntry = JSON.parse(line);
        return entry.data;
      } catch (error) {
        // If JSON parsing fails, treat as legacy format (raw string)
        return line;
      }
    });
  }

  /**
   * Get the total number of entries in the WAL
   */
  async getEntryCount(): Promise<number> {
    return this.durableManager.getEventCount();
  }
}
