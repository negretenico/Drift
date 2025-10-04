// src/hooks/useOfflineRetry.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOfflineRetry } from "./useOfflineRetry";
import { useOffline } from "../OfflineProvider/OfflineProvider";

vi.mock("../OfflineProvider/OfflineProvider", () => ({
  useOffline: vi.fn(),
}));

describe("useOfflineRetry", () => {
  let mockRetryFailedOperations: ReturnType<typeof vi.fn>;
  let mockGetFailedOperations: ReturnType<typeof vi.fn>;
  let onRetry: ReturnType<typeof vi.fn>;
  let onRetrySuccess: ReturnType<typeof vi.fn>;
  let onRetryError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRetryFailedOperations = vi.fn().mockResolvedValue(undefined);
    mockGetFailedOperations = vi.fn().mockResolvedValue(["req1", "req2"]);

    (useOffline as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      retryFailedOperations: mockRetryFailedOperations,
      getFailedOperations: mockGetFailedOperations,
    });

    onRetry = vi.fn().mockResolvedValue(undefined);
    onRetrySuccess = vi.fn();
    onRetryError = vi.fn();

    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Functionality", () => {
    describe("Fail Count", () => {
      it("should initialize with failedCount = 0", () => {
        const { result } = renderHook(() =>
          useOfflineRetry({ onRetry, onRetrySuccess, onRetryError })
        );
        expect(result.current.failedCount).toBe(0);
      });

      it("should fetch and update failed count", async () => {
        const { result } = renderHook(() =>
          useOfflineRetry({ onRetry, onRetrySuccess, onRetryError })
        );

        await act(async () => {
          const count = await result.current.getFailedCount();
          expect(count).toBe(2);
        });

        expect(mockGetFailedOperations).toHaveBeenCalledWith(
          Number.MAX_SAFE_INTEGER
        );
        expect(result.current.failedCount).toBe(2);
      });
    });
    describe("Retries", () => {
      it("should retry all failed operations", async () => {
        const { result } = renderHook(() =>
          useOfflineRetry({ onRetry, onRetrySuccess, onRetryError })
        );

        await act(async () => {
          await result.current.retryAll();
        });

        expect(mockRetryFailedOperations).toHaveBeenCalledWith(
          Number.MAX_SAFE_INTEGER,
          expect.any(Function)
        );
      });

      it("should retry only the last failed operation", async () => {
        const { result } = renderHook(() =>
          useOfflineRetry({ onRetry, onRetrySuccess, onRetryError })
        );

        await act(async () => {
          await result.current.retryLast();
        });

        expect(mockRetryFailedOperations).toHaveBeenCalledWith(
          1,
          expect.any(Function)
        );
      });
    });
    describe("User callbacks", () => {
      it("should call onRetry and onRetrySuccess when retry succeeds", async () => {
        mockRetryFailedOperations.mockImplementation(async (_, retryFn) => {
          await retryFn("serialized-request");
        });

        const { result } = renderHook(() =>
          useOfflineRetry({ onRetry, onRetrySuccess, onRetryError })
        );

        await act(async () => {
          await result.current.retryAll();
        });

        expect(onRetry).toHaveBeenCalledWith("serialized-request");
        expect(onRetrySuccess).toHaveBeenCalledWith("serialized-request");
        expect(onRetryError).not.toHaveBeenCalled();
      });

      it("should call onRetryError when retry fails", async () => {
        onRetry.mockRejectedValueOnce(new Error("Retry failed"));

        mockRetryFailedOperations.mockImplementation(async (_, retryFn) => {
          await retryFn("serialized-request");
        });

        const { result } = renderHook(() =>
          useOfflineRetry({ onRetry, onRetrySuccess, onRetryError })
        );

        await act(async () => {
          await result.current.retryAll();
        });

        expect(onRetryError).toHaveBeenCalledWith(
          expect.any(Error),
          "serialized-request"
        );
        expect(onRetrySuccess).not.toHaveBeenCalled();
      });
    });
  });
});
