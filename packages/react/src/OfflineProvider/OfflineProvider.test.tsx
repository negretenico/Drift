import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { OfflineProvider, useOffline } from "./OfflineProvider";
import { WALClient } from "@negretenico/lib";
let mockOfflineClient: {
  append: ReturnType<typeof vi.fn>;
  replay: ReturnType<typeof vi.fn>;
  inspect: ReturnType<typeof vi.fn>;
};

describe("OfflineProvider", () => {
  beforeEach(() => {
    mockOfflineClient = {
      append: vi.fn().mockResolvedValue("test-id-123"),
      replay: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue([]),
    };
  });
  describe("useOffline hook", () => {
    it("should throw error when used outside provider", () => {
      expect(() => {
        renderHook(() => useOffline());
      }).toThrow("useOffline must be used within an OfflineProvider");
    });
    it.each([
      "captureFailedOperation",
      "retryFailedOperations",
      "getFailedOperations",
    ])("should should have property", (property) => {
      const { result } = renderHook(() => useOffline(), {
        wrapper: ({ children }) => (
          <OfflineProvider offlineClient={mockOfflineClient as WALClient}>
            {children}
          </OfflineProvider>
        ),
      });
      expect(result.current).toHaveProperty(property);
    });
  });

  describe("Functionality", () => {
    it("should add to offline calls", async () => {
      const testOperation = JSON.stringify({
        url: "/api/test",
        method: "POST",
        data: { foo: "bar" },
      });

      const { result } = renderHook(() => useOffline(), {
        wrapper: ({ children }) => (
          <OfflineProvider offlineClient={mockOfflineClient as WALClient}>
            {children}
          </OfflineProvider>
        ),
      });

      await result.current.captureFailedOperation(testOperation);
      expect(mockOfflineClient.append).toHaveBeenCalledWith(testOperation);
    });

    it("should replay calls", async () => {
      const retryFn = vi.fn().mockResolvedValue(undefined);
      const count = 5;

      const { result } = renderHook(() => useOffline(), {
        wrapper: ({ children }) => (
          <OfflineProvider offlineClient={mockOfflineClient as WALClient}>
            {children}
          </OfflineProvider>
        ),
      });

      await result.current.retryFailedOperations(count, retryFn);

      expect(mockOfflineClient.replay).toHaveBeenCalledWith(count, retryFn);
    });

    it("should fetch latest calls that failed", async () => {
      const mockFailedCalls = [
        JSON.stringify({ id: 1, url: "/api/test1", timestamp: Date.now() }),
        JSON.stringify({ id: 2, url: "/api/test2", timestamp: Date.now() }),
        JSON.stringify({ id: 3, url: "/api/test3", timestamp: Date.now() }),
      ];
      mockOfflineClient.inspect.mockResolvedValue(mockFailedCalls);
      const count = 3;

      const { result } = renderHook(() => useOffline(), {
        wrapper: ({ children }) => (
          <OfflineProvider offlineClient={mockOfflineClient as WALClient}>
            {children}
          </OfflineProvider>
        ),
      });

      const failedOperations = await result.current.getFailedOperations(count);

      expect(mockOfflineClient.inspect).toHaveBeenCalledWith(count);
      expect(failedOperations).toEqual(mockFailedCalls);
    });

    it("should handle multiple captures sequentially", async () => {
      const operations = [
        JSON.stringify({ url: "/api/test1", method: "POST" }),
        JSON.stringify({ url: "/api/test2", method: "GET" }),
        JSON.stringify({ url: "/api/test3", method: "PUT" }),
      ];

      const { result } = renderHook(() => useOffline(), {
        wrapper: ({ children }) => (
          <OfflineProvider offlineClient={mockOfflineClient as WALClient}>
            {children}
          </OfflineProvider>
        ),
      });

      for (const operation of operations) {
        await result.current.captureFailedOperation(operation);
      }

      expect(mockOfflineClient.append).toHaveBeenCalledTimes(3);
      operations.forEach((operation) => {
        expect(mockOfflineClient.append).toHaveBeenCalledWith(operation);
      });
    });

    it("should call retry function for each replayed operation", async () => {
      const mockOperations = [
        JSON.stringify({ url: "/api/retry1" }),
        JSON.stringify({ url: "/api/retry2" }),
      ];

      // Mock replay to actually call the processor function
      mockOfflineClient.replay.mockImplementation(
        async (count: number, processor: (op: string) => Promise<void>) => {
          for (const op of mockOperations.slice(0, count)) {
            await processor(op);
          }
        }
      );

      const retryFn = vi.fn().mockResolvedValue(undefined);

      const { result } = renderHook(() => useOffline(), {
        wrapper: ({ children }) => (
          <OfflineProvider offlineClient={mockOfflineClient as WALClient}>
            {children}
          </OfflineProvider>
        ),
      });

      await result.current.retryFailedOperations(2, retryFn);

      expect(retryFn).toHaveBeenCalledTimes(2);
      expect(retryFn).toHaveBeenCalledWith(mockOperations[0]);
      expect(retryFn).toHaveBeenCalledWith(mockOperations[1]);
    });
  });
});
