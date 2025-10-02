import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { DurabilityManager } from "./DurabilityManager";
import { WALManager } from "../walmanager/WalManager";

// Mock the WALManager module
vi.mock("../walmanager/WalManager", () => {
  return {
    WALManager: {
      getInstance: vi.fn(),
    },
  };
});

describe("DurabilityManager", () => {
  let durabilityManager: DurabilityManager;
  let mockWALManager: {
    read: ReturnType<typeof vi.fn>;
    append: ReturnType<typeof vi.fn>;
    register: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Create mock WALManager instance
    mockWALManager = {
      read: vi.fn(),
      append: vi.fn(),
      register: vi.fn(),
    };

    // Setup the mock to return our mock instance
    vi.mocked(WALManager.getInstance).mockReturnValue(mockWALManager as any);

    durabilityManager = new DurabilityManager({
      walFileName: "test.wal",
      retryConfig: {
        maxRetries: 3,
        initialDelayMs: 10,
        maxDelayMs: 100,
        backoffMultiplier: 2,
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Functionality", () => {
    describe("Replay", () => {
      it("should replay the last event", async () => {
        // Mock WAL content with 3 events
        mockWALManager.read.mockResolvedValue("event1\nevent2\nevent3\n");

        const processedEvents: string[] = [];
        const processor = async (event: string) => {
          processedEvents.push(event);
        };

        const result = await durabilityManager.replay(1, processor);

        expect(result.success).toBe(true);
        expect(result.processedCount).toBe(1);
        expect(result.failedCount).toBe(0);
        expect(processedEvents).toEqual(["event3"]);
        expect(mockWALManager.read).toHaveBeenCalledWith("test.wal");
      });

      it("should replay the last 5 events", async () => {
        // Mock WAL content with 10 events
        const events =
          Array.from({ length: 10 }, (_, i) => `event${i}`).join("\n") + "\n";
        mockWALManager.read.mockResolvedValue(events);

        const processedEvents: string[] = [];
        const processor = async (event: string) => {
          processedEvents.push(event);
        };

        const result = await durabilityManager.replay(5, processor);

        expect(result.success).toBe(true);
        expect(result.processedCount).toBe(5);
        expect(result.failedCount).toBe(0);
        expect(processedEvents).toEqual([
          "event5",
          "event6",
          "event7",
          "event8",
          "event9",
        ]);
      });

      it("should handle replaying more events than exist", async () => {
        mockWALManager.read.mockResolvedValue("event1\nevent2\n");

        const processedEvents: string[] = [];
        const processor = async (event: string) => {
          processedEvents.push(event);
        };

        const result = await durabilityManager.replay(10, processor);

        expect(result.success).toBe(true);
        expect(result.processedCount).toBe(2);
        expect(processedEvents).toEqual(["event1", "event2"]);
      });

      it("should process events sequentially in order", async () => {
        mockWALManager.read.mockResolvedValue("event1\nevent2\nevent3\n");

        const processingOrder: string[] = [];
        let currentlyProcessing: string | null = null;
        const concurrencyViolations: string[] = [];

        const processor = async (event: string) => {
          // Check if another event is being processed (would indicate parallel execution)
          if (currentlyProcessing !== null) {
            concurrencyViolations.push(
              `${currentlyProcessing} and ${event} processed concurrently`
            );
          }

          currentlyProcessing = event;
          processingOrder.push(event);

          // Simulate async work
          await new Promise((resolve) => setTimeout(resolve, 10));

          currentlyProcessing = null;
        };

        await durabilityManager.replay(3, processor);

        // Verify correct order
        expect(processingOrder).toEqual(["event1", "event2", "event3"]);

        // Verify no concurrent processing
        expect(concurrencyViolations).toEqual([]);
      });

      it("should handle empty lines in WAL", async () => {
        mockWALManager.read.mockResolvedValue("event1\n\nevent2\n\n\nevent3\n");

        const processedEvents: string[] = [];
        const processor = async (event: string) => {
          processedEvents.push(event);
        };

        const result = await durabilityManager.replay(3, processor);

        expect(result.success).toBe(true);
        expect(result.processedCount).toBe(3);
        expect(processedEvents).toEqual(["event1", "event2", "event3"]);
      });
    });

    describe("Sequential", () => {
      it("should prevent concurrent replays", async () => {
        mockWALManager.read.mockResolvedValue("event1\nevent2\n");

        const processor = async (event: string) => {
          await new Promise((resolve) => setTimeout(resolve, 50));
        };

        // Start first replay (don't await)
        const replay1 = durabilityManager.replay(2, processor);

        // Try to start second replay while first is running
        await expect(durabilityManager.replay(2, processor)).rejects.toThrow(
          "Replay already in progress"
        );

        await replay1; // Clean up
      });

      it("should allow replay after previous one completes", async () => {
        mockWALManager.read.mockResolvedValue("event1\n");

        const processor = async (event: string) => {};

        await durabilityManager.replay(1, processor);

        // This should not throw
        await expect(
          durabilityManager.replay(1, processor)
        ).resolves.toBeDefined();

        // Verify read was called twice
        expect(mockWALManager.read).toHaveBeenCalledTimes(2);
      });

      it("should expose replay status", async () => {
        mockWALManager.read.mockResolvedValue("event1\n");

        expect(durabilityManager.isReplayInProgress).toBe(false);

        const processor = async (event: string) => {
          await new Promise((resolve) => setTimeout(resolve, 50));
        };

        const replay = durabilityManager.replay(1, processor);

        // Should be true during replay
        expect(durabilityManager.isReplayInProgress).toBe(true);

        await replay;

        // Should be false after replay
        expect(durabilityManager.isReplayInProgress).toBe(false);
      });
    });

    describe("Retry", () => {
      it("should retry if latest attempt fails", async () => {
        mockWALManager.read.mockResolvedValue("event1\n");

        let attemptCount = 0;
        const processor = async (event: string) => {
          attemptCount++;
          if (attemptCount < 3) {
            throw new Error("Simulated failure");
          }
          // Success on 3rd attempt
        };

        const result = await durabilityManager.replay(1, processor);

        expect(result.success).toBe(true);
        expect(result.processedCount).toBe(1);
        expect(attemptCount).toBe(3); // Initial + 2 retries
      });

      it("should fail after exhausting all retries", async () => {
        mockWALManager.read.mockResolvedValue("event1\n");

        // Suppress console.error for this test
        const consoleErrorSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});

        let attemptCount = 0;
        const processor = async (event: string) => {
          attemptCount++;
          throw new Error("Always fails");
        };

        const result = await durabilityManager.replay(1, processor);

        expect(result.success).toBe(false);
        expect(result.processedCount).toBe(0);
        expect(result.failedCount).toBe(1);
        expect(attemptCount).toBe(4); // Initial + 3 retries (maxRetries=3)

        consoleErrorSpy.mockRestore();
      });

      it("should continue processing other events after a failure", async () => {
        mockWALManager.read.mockResolvedValue("event1\nevent2\nevent3\n");

        // Suppress console.error for this test
        const consoleErrorSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});

        const processedEvents: string[] = [];
        const processor = async (event: string) => {
          if (event === "event2") {
            throw new Error("Event2 always fails");
          }
          processedEvents.push(event);
        };

        const result = await durabilityManager.replay(3, processor);

        expect(result.success).toBe(false); // Overall failure due to one failure
        expect(result.processedCount).toBe(2);
        expect(result.failedCount).toBe(1);
        expect(processedEvents).toEqual(["event1", "event3"]);

        consoleErrorSpy.mockRestore();
      });

      it("should not retry on successful processing", async () => {
        mockWALManager.read.mockResolvedValue("event1\n");

        let attemptCount = 0;
        const processor = async (event: string) => {
          attemptCount++;
          // Always succeeds
        };

        const result = await durabilityManager.replay(1, processor);

        expect(result.success).toBe(true);
        expect(attemptCount).toBe(1); // No retries needed
      });
    });

    describe("Backoff", () => {
      it("should not overwhelm the system when given 3 failures", async () => {
        mockWALManager.read.mockResolvedValue("event1\n");

        // Suppress console.error for this test
        const consoleErrorSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});

        const attemptTimestamps: number[] = [];
        const processor = async (event: string) => {
          attemptTimestamps.push(Date.now());
          throw new Error("Always fails");
        };

        const startTime = Date.now();
        await durabilityManager.replay(1, processor);
        const endTime = Date.now();

        expect(attemptTimestamps.length).toBe(4); // Initial + 3 retries

        // Verify exponential backoff delays
        const delay1 = attemptTimestamps[1] - attemptTimestamps[0];
        const delay2 = attemptTimestamps[2] - attemptTimestamps[1];
        const delay3 = attemptTimestamps[3] - attemptTimestamps[2];

        // With jitter, delays should be approximately exponential
        expect(delay1).toBeGreaterThanOrEqual(5); // ~10ms with jitter
        expect(delay2).toBeGreaterThan(delay1); // Should increase
        expect(delay3).toBeGreaterThan(delay2); // Should increase more

        // Total time should reflect backoff (not immediate retries)
        const totalDuration = endTime - startTime;
        expect(totalDuration).toBeGreaterThanOrEqual(50); // Sum of delays

        consoleErrorSpy.mockRestore();
      });

      it("should cap delay at maxDelayMs", async () => {
        // Create separate mock for this manager
        const separateMockWALManager = {
          read: vi.fn().mockResolvedValue("event1\n"),
          append: vi.fn(),
          register: vi.fn(),
        };

        vi.mocked(WALManager.getInstance).mockReturnValue(
          separateMockWALManager as any
        );

        // Create manager with low maxDelay for testing
        const manager = new DurabilityManager({
          walFileName: "test.wal",
          retryConfig: {
            maxRetries: 5,
            initialDelayMs: 100,
            maxDelayMs: 150, // Cap at 150ms
            backoffMultiplier: 10, // Aggressive multiplier
          },
        });

        // Suppress console.error for this test
        const consoleErrorSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});

        const attemptTimestamps: number[] = [];
        const processor = async (event: string) => {
          attemptTimestamps.push(Date.now());
          throw new Error("Always fails");
        };

        await manager.replay(1, processor);

        // Later retries should not exceed maxDelayMs
        for (let i = 2; i < attemptTimestamps.length; i++) {
          const delay = attemptTimestamps[i] - attemptTimestamps[i - 1];
          // With jitter (±25%), max delay should be ~187ms
          expect(delay).toBeLessThan(200);
        }

        consoleErrorSpy.mockRestore();
      });

      it("should apply jitter to prevent thundering herd", async () => {
        mockWALManager.read.mockResolvedValue("event1\n");

        // Suppress console.error for this test
        const consoleErrorSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});

        const delays: number[] = [];

        // Run multiple times to see jitter variation
        for (let run = 0; run < 5; run++) {
          const timestamps: number[] = [];
          const processor = async (event: string) => {
            timestamps.push(Date.now());
            throw new Error("Fail");
          };

          await durabilityManager.replay(1, processor);

          // Capture first retry delay
          if (timestamps.length >= 2) {
            delays.push(timestamps[1] - timestamps[0]);
          }
        }

        // Delays should vary due to jitter (not all the same)
        const uniqueDelays = new Set(delays);
        expect(uniqueDelays.size).toBeGreaterThan(1);

        consoleErrorSpy.mockRestore();
      });
    });

    describe("Result Handling", () => {
      it("should return success when all actions succeed", async () => {
        mockWALManager.read.mockResolvedValue("event1\nevent2\nevent3\n");

        const processor = async (event: string) => {
          // All succeed
        };

        const result = await durabilityManager.replay(3, processor);

        expect(result.success).toBe(true);
        expect(result.processedCount).toBe(3);
        expect(result.failedCount).toBe(0);
        expect(result.errors).toHaveLength(0);
      });

      it("should return failure when an error happens", async () => {
        mockWALManager.read.mockResolvedValue("event1\nevent2\n");

        // Suppress console.error for this test
        const consoleErrorSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});

        const processor = async (event: string) => {
          if (event === "event2") {
            throw new Error("Event2 failed");
          }
        };

        const result = await durabilityManager.replay(2, processor);

        expect(result.success).toBe(false);
        expect(result.processedCount).toBe(1);
        expect(result.failedCount).toBe(1);

        consoleErrorSpy.mockRestore();
      });

      it("should track callback for processed events", async () => {
        // Create separate mock for this manager
        const separateMockWALManager = {
          read: vi.fn().mockResolvedValue("event1\nevent2\n"),
          append: vi.fn(),
          register: vi.fn(),
        };

        vi.mocked(WALManager.getInstance).mockReturnValue(
          separateMockWALManager as any
        );

        const callbacks: Array<{ event: string; success: boolean }> = [];

        const managerWithCallback = new DurabilityManager({
          walFileName: "test.wal",
          onEventProcessed: (event, success) => {
            callbacks.push({ event, success });
          },
        });

        // Suppress console.error for this test
        const consoleErrorSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});

        const processor = async (event: string) => {
          if (event === "event2") {
            throw new Error("Fail");
          }
        };

        await managerWithCallback.replay(2, processor);

        expect(callbacks).toHaveLength(2);
        expect(callbacks[0]).toEqual({ event: "event1", success: true });
        expect(callbacks[1]).toEqual({ event: "event2", success: false });

        consoleErrorSpy.mockRestore();
      });

      it("should provide detailed error information", async () => {
        mockWALManager.read.mockResolvedValue("event1\n");

        // Suppress console.error for this test
        const consoleErrorSpy = vi
          .spyOn(console, "error")
          .mockImplementation(() => {});

        const processor = async (event: string) => {
          throw new Error("Processing failed");
        };

        const result = await durabilityManager.replay(1, processor);

        expect(result.success).toBe(false);
        expect(result.failedCount).toBe(1);

        consoleErrorSpy.mockRestore();
      });
    });

    describe("Edge Cases", () => {
      it("should handle empty WAL", async () => {
        mockWALManager.read.mockResolvedValue("");

        const processor = async (event: string) => {};
        const result = await durabilityManager.replay(10, processor);

        expect(result.success).toBe(true);
        expect(result.processedCount).toBe(0);
        expect(result.failedCount).toBe(0);
      });

      it("should handle WAL with only newlines", async () => {
        mockWALManager.read.mockResolvedValue("\n\n\n\n");

        const processor = async (event: string) => {};
        const result = await durabilityManager.replay(10, processor);

        expect(result.success).toBe(true);
        expect(result.processedCount).toBe(0);
      });

      it("should report event count", async () => {
        mockWALManager.read.mockResolvedValue("event1\nevent2\nevent3\n");

        const count = await durabilityManager.getEventCount();
        expect(count).toBe(3);
      });

      it("should handle replaying zero events", async () => {
        mockWALManager.read.mockResolvedValue("event1\nevent2\n");

        const processor = vi.fn();
        const result = await durabilityManager.replay(0, processor);

        expect(result.success).toBe(true);
        expect(result.processedCount).toBe(0);
        expect(processor).not.toHaveBeenCalled();
      });

      it("should handle WAL read errors gracefully", async () => {
        mockWALManager.read.mockRejectedValue(new Error("File read error"));

        const processor = async (event: string) => {};

        await expect(durabilityManager.replay(1, processor)).rejects.toThrow(
          "File read error"
        );

        // Should reset replay flag even on error
        expect(durabilityManager.isReplayInProgress).toBe(false);
      });
    });
  });
});
