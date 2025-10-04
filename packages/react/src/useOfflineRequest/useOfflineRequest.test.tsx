import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOfflineRequest } from "./useOfflineRequest";
import { useOffline } from "../OfflineProvider/OfflineProvider";

vi.mock("../OfflineProvider/OfflineProvider", () => ({
  useOffline: vi.fn(),
}));

describe("useOfflineRequest", () => {
  let mockCaptureFailedOperation: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockCaptureFailedOperation = vi.fn().mockResolvedValue(undefined);
    (useOffline as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      captureFailedOperation: mockCaptureFailedOperation,
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Functionality", () => {
    it("should start with initial state", () => {
      const { result } = renderHook(() =>
        useOfflineRequest({
          requestFn: vi.fn(),
        })
      );

      expect(result.current).toMatchObject({
        data: undefined,
        error: null,
        isPending: false,
        isSuccess: false,
        isError: false,
      });
    });

    it("should call reset to clear state", async () => {
      const requestFn = vi.fn().mockResolvedValue({ foo: "bar" });

      const { result } = renderHook(() =>
        useOfflineRequest({
          requestFn,
        })
      );

      await act(async () => {
        await result.current.execute({ id: 5 });
      });

      expect(result.current.isSuccess).toBeTruthy();

      act(() => {
        result.current.reset();
      });

      expect(result.current).toMatchObject({
        data: undefined,
        error: null,
        isPending: false,
        isSuccess: false,
        isError: false,
      });
    });

    describe("Success", () => {
      it("should handle successful request", async () => {
        const requestFn = vi.fn().mockResolvedValue({ foo: "bar" });
        const onRequest = vi.fn();
        const onSuccess = vi.fn();

        const { result } = renderHook(() =>
          useOfflineRequest({
            requestFn,
            onRequest,
            onSuccess,
          })
        );

        await act(async () => {
          const data = await result.current.execute({ id: 1 });
          expect(data).toEqual({ foo: "bar" });
        });

        expect(onRequest).toHaveBeenCalledWith({ id: 1 });
        expect(onSuccess).toHaveBeenCalledWith({ foo: "bar" }, { id: 1 });
        expect(result.current).toMatchObject({
          data: { foo: "bar" },
          isSuccess: true,
          isPending: false,
          isError: false,
        });
      });
    });

    describe("Failure", () => {
      describe("Offline Capturing", () => {
        it("should skip capturing if captureOnFailure is false", async () => {
          const error = new Error("server failure");
          const requestFn = vi.fn().mockRejectedValue(error);

          const { result } = renderHook(() =>
            useOfflineRequest({
              requestFn,
              captureOnFailure: false,
            })
          );

          await expect(
            act(() => result.current.execute({ id: 3 }))
          ).rejects.toThrow("server failure");

          // Wait for async side effects
          await Promise.resolve();

          expect(mockCaptureFailedOperation).not.toHaveBeenCalled();
        });

        it("should use custom shouldCapture logic", async () => {
          const error = new Error("custom error");
          const requestFn = vi.fn().mockRejectedValue(error);
          const shouldCapture = vi.fn().mockReturnValue(false);

          const { result } = renderHook(() =>
            useOfflineRequest({
              requestFn,
              shouldCapture,
            })
          );

          await expect(
            act(() => result.current.execute({ id: 4 }))
          ).rejects.toThrow("custom error");

          // Allow async hook effects to resolve
          await Promise.resolve();

          expect(shouldCapture).toHaveBeenCalledWith(error);
          expect(mockCaptureFailedOperation).not.toHaveBeenCalled();
        });
      });

      it("should handle request error and capture failed operation", async () => {
        const error = new Error("network failure");
        const requestFn = vi.fn().mockRejectedValue(error);
        const onError = vi.fn();

        const { result } = renderHook(() =>
          useOfflineRequest({
            requestFn,
            onError,
            captureOnFailure: true,
          })
        );

        await act(async () => {
          await expect(result.current.execute({ id: 2 })).rejects.toThrow(
            "network failure"
          );
        });

        // Give React a moment to process the state update
        await new Promise((r) => setTimeout(r, 0));

        expect(onError).toHaveBeenCalledWith(error, { id: 2 });
        expect(mockCaptureFailedOperation).toHaveBeenCalledTimes(1);

        expect(result.current).toMatchObject({
          data: undefined,
          isPending: false,
          isSuccess: false,
          isError: true,
          error,
        });
      });
    });
  });
});
