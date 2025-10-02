import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { DurableWal } from "./DurableWal";
import { DurabilityManager } from "../durablity/DurabilityManager";

// Mock only DurabilityManager - no WALManager or WAL mocks needed
vi.mock("../durablity/DurabilityManager");

describe("DurableWal", () => {
  let durableWal: DurableWal;
  let mockDurabilityManager: {
    append: ReturnType<typeof vi.fn>;
    read: ReturnType<typeof vi.fn>;
    replay: ReturnType<typeof vi.fn>;
    getEventCount: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Setup mock DurabilityManager
    mockDurabilityManager = {
      append: vi.fn().mockResolvedValue(undefined),
      read: vi.fn().mockResolvedValue(""),
      replay: vi.fn().mockResolvedValue({
        success: true,
        processedCount: 0,
        failedCount: 0,
        errors: [],
      }),
      getEventCount: vi.fn().mockResolvedValue(0),
    };

    // Mock DurabilityManager constructor
    vi.mocked(DurabilityManager).mockImplementation(
      () => mockDurabilityManager as any
    );

    durableWal = new DurableWal({
      durableConfig: {
        walFileName: "test.wal",
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });
  describe("Functionality", () => {
    describe("Append", () => {
      it("should write to the WAL with generated ID and timestamp", async () => {
        const content = "test event data";
        const entryId = await durableWal.append(content);

        expect(mockDurabilityManager.append).toHaveBeenCalledTimes(1);

        const appendedData = mockDurabilityManager.append.mock.calls[0][0];
        const parsed = JSON.parse(appendedData);
        expect(parsed.data).toBe(content);
        expect(entryId).toBe(parsed.id);
        expect(entryId.length).toBeGreaterThan(0);
      });

      it("should generate unique IDs for multiple appends", async () => {
        const id1 = await durableWal.append("event1");
        const id2 = await durableWal.append("event2");
        const id3 = await durableWal.append("event3");

        expect(id1).not.toBe(id2);
        expect(id2).not.toBe(id3);
        expect(id1).not.toBe(id3);
      });

      it("should include timestamp in milliseconds", async () => {
        const beforeTimestamp = Date.now();
        await durableWal.append("test");
        const afterTimestamp = Date.now();

        const appendedData = mockDurabilityManager.append.mock.calls[0][0];
        const parsed = JSON.parse(appendedData);

        expect(parsed.timestamp).toBeGreaterThanOrEqual(beforeTimestamp);
        expect(parsed.timestamp).toBeLessThanOrEqual(afterTimestamp);
      });
      it.each(["", "      "])(
        "should throw error when appending empty content",
        async (content: string) => {
          await expect(durableWal.append(content)).rejects.toThrow(
            "Cannot append empty content"
          );
        }
      );

      it("should handle append failures from DurabilityManager", async () => {
        mockDurabilityManager.append.mockRejectedValue(new Error("Disk full"));

        await expect(durableWal.append("test")).rejects.toThrow("Disk full");
      });

      it("should serialize complex data correctly", async () => {
        const complexData = JSON.stringify({
          nested: { data: "value" },
          array: [1, 2, 3],
        });

        await durableWal.append(complexData);

        const appendedData = mockDurabilityManager.append.mock.calls[0][0];
        const parsed = JSON.parse(appendedData);

        expect(parsed.data).toBe(complexData);
      });
    });

    describe("Replay", () => {
      it("should replay the last 5 events", async () => {
        const events = Array.from({ length: 10 }, (_, i) => ({
          id: `id-${i}`,
          timestamp: Date.now(),
          data: `event${i}`,
        }));

        mockDurabilityManager.replay.mockImplementation(
          async (count: number, processor: any) => {
            const eventsToProcess = events.slice(-count);
            for (const event of eventsToProcess) {
              await processor(JSON.stringify(event));
            }
            return {
              success: true,
              processedCount: eventsToProcess.length,
              failedCount: 0,
              errors: [],
            };
          }
        );

        const processedEvents: string[] = [];
        const processor = async (data: string) => {
          processedEvents.push(data);
        };

        await durableWal.replay(5, processor);

        expect(mockDurabilityManager.replay).toHaveBeenCalledTimes(1);
        expect(mockDurabilityManager.replay).toHaveBeenCalledWith(
          5,
          expect.any(Function)
        );
        expect(processedEvents).toHaveLength(5);
        expect(processedEvents).toEqual([
          "event5",
          "event6",
          "event7",
          "event8",
          "event9",
        ]);
      });

      it("should deserialize entries and pass only data to processor", async () => {
        const entry = {
          id: "test-id",
          timestamp: 1234567890,
          data: "test data",
        };

        mockDurabilityManager.replay.mockImplementation(
          async (_count: number, processor: any) => {
            await processor(JSON.stringify(entry));
            return {
              success: true,
              processedCount: 1,
              failedCount: 0,
              errors: [],
            };
          }
        );

        const processedData: string[] = [];
        await durableWal.replay(1, async (data) => {
          processedData.push(data);
        });

        expect(processedData).toEqual(["test data"]);
      });

      it("should handle legacy format (raw strings without JSON)", async () => {
        mockDurabilityManager.replay.mockImplementation(
          async (_count: number, processor: any) => {
            await processor("raw legacy data");
            return {
              success: true,
              processedCount: 1,
              failedCount: 0,
              errors: [],
            };
          }
        );

        const processedData: string[] = [];
        await durableWal.replay(1, async (data) => {
          processedData.push(data);
        });

        expect(processedData).toEqual(["raw legacy data"]);
      });

      it.each([
        { payload: [5, null as any], errmsg: "Processor function is required" },
        {
          payload: [5, undefined as any],
          errmsg: "Processor function is required",
        },
        {
          payload: [-1, async () => {}],
          errmsg: "Event number must be non-negative",
        },
      ])(
        "should throw error",
        async ({ payload, errmsg }: { payload: any[]; errmsg: string }) => {
          await expect(
            durableWal.replay(payload[0], payload[1])
          ).rejects.toThrow(errmsg);
        }
      );

      it("should throw error when replay fails", async () => {
        mockDurabilityManager.replay.mockResolvedValue({
          success: false,
          processedCount: 2,
          failedCount: 3,
          errors: [],
        });

        await expect(durableWal.replay(5, async () => {})).rejects.toThrow(
          "Replay failed: 3 events failed out of 5"
        );
      });

      it("should handle processor errors gracefully", async () => {
        mockDurabilityManager.replay.mockImplementation(
          async (_count: number, processor: any) => {
            try {
              await processor(
                JSON.stringify({
                  id: "1",
                  timestamp: Date.now(),
                  data: "test",
                })
              );
            } catch (error) {
              // Processor threw, but we still return result
            }
            return {
              success: false,
              processedCount: 0,
              failedCount: 1,
              errors: [],
            };
          }
        );

        const errorProcessor = async () => {
          throw new Error("Processing failed");
        };

        await expect(durableWal.replay(1, errorProcessor)).rejects.toThrow(
          "Replay failed"
        );
      });

      it("should replay all events when eventNum is 0", async () => {
        mockDurabilityManager.replay.mockResolvedValue({
          success: true,
          processedCount: 0,
          failedCount: 0,
          errors: [],
        });

        const processor = vi.fn();
        await durableWal.replay(0, processor);

        expect(mockDurabilityManager.replay).toHaveBeenCalledWith(
          0,
          expect.any(Function)
        );
      });

      it("should only call DurabilityManager.replay (not WALManager)", async () => {
        const processor = vi.fn();
        await durableWal.replay(1, processor);

        expect(mockDurabilityManager.replay).toHaveBeenCalledTimes(1);
        // Verify append and read were not called
        expect(mockDurabilityManager.append).not.toHaveBeenCalled();
        expect(mockDurabilityManager.read).not.toHaveBeenCalled();
      });
    });

    describe("Inspect", () => {
      it("should return the latest 5 records", async () => {
        const entries = Array.from({ length: 10 }, (_, i) => ({
          id: `id-${i}`,
          timestamp: Date.now(),
          data: `event${i}`,
        }));

        const walContent =
          entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
        mockDurabilityManager.read.mockResolvedValue(walContent);

        const result = await durableWal.inspect(5);

        expect(result).toHaveLength(5);
        expect(result).toEqual([
          "event5",
          "event6",
          "event7",
          "event8",
          "event9",
        ]);
      });

      it("should strip metadata and return only data", async () => {
        const entry = {
          id: "test-id-123",
          timestamp: 1234567890,
          data: "user data here",
        };

        mockDurabilityManager.read.mockResolvedValue(
          JSON.stringify(entry) + "\n"
        );

        const result = await durableWal.inspect(1);

        expect(result).toEqual(["user data here"]);
      });

      it("should handle empty WAL", async () => {
        mockDurabilityManager.read.mockResolvedValue("");

        const result = await durableWal.inspect(10);

        expect(result).toEqual([]);
      });

      it("should handle WAL with only newlines", async () => {
        mockDurabilityManager.read.mockResolvedValue("\n\n\n");

        const result = await durableWal.inspect(10);

        expect(result).toEqual([]);
      });

      it("should handle legacy format (raw strings)", async () => {
        mockDurabilityManager.read.mockResolvedValue("raw1\nraw2\nraw3\n");

        const result = await durableWal.inspect(3);

        expect(result).toEqual(["raw1", "raw2", "raw3"]);
      });

      it("should handle mixed format (JSON and raw)", async () => {
        const jsonEntry = JSON.stringify({
          id: "1",
          timestamp: Date.now(),
          data: "json data",
        });

        mockDurabilityManager.read.mockResolvedValue(
          `${jsonEntry}\nraw data\n`
        );

        const result = await durableWal.inspect(2);

        expect(result).toEqual(["json data", "raw data"]);
      });

      it("should throw error when numberOfEvents is negative", async () => {
        await expect(durableWal.inspect(-1)).rejects.toThrow(
          "Number of events must be non-negative"
        );
      });

      it("should return empty array when numberOfEvents is 0", async () => {
        mockDurabilityManager.read.mockResolvedValue("event1\nevent2\n");

        const result = await durableWal.inspect(0);

        expect(result).toEqual([]);
      });

      it("should handle more events requested than available", async () => {
        const entries = Array.from({ length: 3 }, (_, i) => ({
          id: `id-${i}`,
          timestamp: Date.now(),
          data: `event${i}`,
        }));

        const walContent =
          entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
        mockDurabilityManager.read.mockResolvedValue(walContent);

        const result = await durableWal.inspect(10);

        expect(result).toHaveLength(3);
        expect(result).toEqual(["event0", "event1", "event2"]);
      });

      it("should handle read errors from DurabilityManager", async () => {
        mockDurabilityManager.read.mockRejectedValue(
          new Error("WAL file not found")
        );

        await expect(durableWal.inspect(5)).rejects.toThrow(
          "WAL file not found"
        );
      });

      it("should only call DurabilityManager.read (not WALManager)", async () => {
        mockDurabilityManager.read.mockResolvedValue("event1\n");

        await durableWal.inspect(1);

        expect(mockDurabilityManager.read).toHaveBeenCalledTimes(1);
        // Verify other methods were not called
        expect(mockDurabilityManager.append).not.toHaveBeenCalled();
        expect(mockDurabilityManager.replay).not.toHaveBeenCalled();
      });
    });
    describe("Error Handling", () => {
      it("should propagate errors from DurabilityManager", async () => {
        mockDurabilityManager.append.mockRejectedValue(
          new Error("Write failed")
        );

        await expect(durableWal.append("test")).rejects.toThrow("Write failed");
      });

      it("should handle corrupted JSON in WAL gracefully", async () => {
        mockDurabilityManager.read.mockResolvedValue(
          '{"id":"1","invalid json\n'
        );

        // Should treat as raw string rather than throwing
        const result = await durableWal.inspect(1);

        expect(result).toHaveLength(1);
        expect(result[0]).toContain("invalid json");
      });
    });
  });
});
