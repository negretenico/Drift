import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock DurableWal before importing service worker
const mockAppend = vi.fn().mockResolvedValue("test-id");
const mockReplay = vi.fn().mockResolvedValue(undefined);
const mockInspect = vi.fn().mockResolvedValue([]);

vi.mock("@negretenico/lib", () => ({
  DurableWal: vi.fn().mockImplementation(() => ({
    append: mockAppend,
    replay: mockReplay,
    inspect: mockInspect,
  })),
}));

describe("Service Worker", () => {
  let listeners: Record<string, Function[]>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Reset event listeners
    listeners = {};

    // Mock addEventListener
    (global as any).addEventListener = vi.fn(
      (event: string, handler: Function) => {
        if (!listeners[event]) {
          listeners[event] = [];
        }
        listeners[event].push(handler);
      }
    );

    // Mock self
    (global as any).self = global;

    // Mock skipWaiting
    (global as any).skipWaiting = vi.fn().mockResolvedValue(undefined);

    // Mock clients.claim
    (global as any).clients = {
      claim: vi.fn().mockResolvedValue(undefined),
    };

    // Mock registration
    (global as any).registration = {
      navigationPreload: {
        enable: vi.fn().mockResolvedValue(undefined),
      },
    };

    // Mock navigator.onLine
    Object.defineProperty(global.navigator, "onLine", {
      writable: true,
      value: true,
    });

    // Mock fetch
    (global as any).fetch = vi
      .fn()
      .mockResolvedValue(new Response("OK", { status: 200 }));

    // Import service worker to register listeners
    await import("./service-worker");
  });

  afterEach(() => {
    vi.resetModules();
  });

  const triggerEvent = async (eventName: string, event: any) => {
    const handlers = listeners[eventName] || [];
    for (const handler of handlers) {
      await handler(event);
    }
  };

  describe("Installation", () => {
    it("should install and skip waiting", async () => {
      const skipWaitingSpy = global.skipWaiting as any;

      await triggerEvent("install", new Event("install"));

      expect(skipWaitingSpy).toHaveBeenCalled();
    });
  });

  describe("Activation", () => {
    it("should activate and claim clients", async () => {
      const claimSpy = (global as any).clients.claim;

      const activateEvent = {
        waitUntil: vi.fn((promise: Promise<any>) => promise),
      };

      await triggerEvent("activate", activateEvent);

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(claimSpy).toHaveBeenCalled();
    });

    it("should initialize DurableWal on activation", async () => {
      const { DurableWal } = await import("@negretenico/lib");

      const activateEvent = {
        waitUntil: vi.fn((promise: Promise<any>) => promise),
      };

      await triggerEvent("activate", activateEvent);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(DurableWal).toHaveBeenCalledWith({
        durableConfig: expect.objectContaining({
          walFileName: "service-worker.log",
        }),
      });
    });
  });

  describe("Message Handling", () => {
    it("should respond to PING messages", async () => {
      const postMessageSpy = vi.fn();

      const messageEvent = {
        data: { type: "PING" },
        source: { postMessage: postMessageSpy },
      };

      await triggerEvent("message", messageEvent);

      expect(postMessageSpy).toHaveBeenCalledWith({ type: "PONG" });
    });

    it("should handle REPLAY_WAL messages", async () => {
      // First activate to initialize WAL
      const activateEvent = {
        waitUntil: vi.fn((promise: Promise<any>) => promise),
      };
      await triggerEvent("activate", activateEvent);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const postMessageSpy = vi.fn();
      const messageEvent = {
        data: { type: "REPLAY_WAL", payload: { count: 10 } },
        source: { postMessage: postMessageSpy },
      };

      await triggerEvent("message", messageEvent);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockReplay).toHaveBeenCalled();
      expect(postMessageSpy).toHaveBeenCalledWith({ type: "REPLAY_COMPLETE" });
    });

    it("should handle REPLAY_WAL error when WAL not initialized", async () => {
      const postMessageSpy = vi.fn();
      const messageEvent = {
        data: { type: "REPLAY_WAL" },
        source: { postMessage: postMessageSpy },
      };

      await triggerEvent("message", messageEvent);

      expect(postMessageSpy).toHaveBeenCalledWith({
        type: "REPLAY_ERROR",
        error: "WAL not initialized",
      });
    });
  });

  describe("Fetch Interception", () => {
    beforeEach(async () => {
      // Activate first to initialize WAL
      const activateEvent = {
        waitUntil: vi.fn((promise: Promise<any>) => promise),
      };
      await triggerEvent("activate", activateEvent);
      await new Promise((resolve) => setTimeout(resolve, 100));

      mockAppend.mockClear();
    });

    it("should capture 5xx server errors", async () => {
      (global.fetch as any).mockResolvedValueOnce(
        new Response("Server Error", { status: 500 })
      );

      const request = new Request("https://api.example.com/data");
      const fetchEvent = {
        request,
        respondWith: vi.fn(async (responsePromise: Promise<Response>) => {
          return await responsePromise;
        }),
      };

      await triggerEvent("fetch", fetchEvent);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockAppend).toHaveBeenCalled();
      const appendedData = JSON.parse(mockAppend.mock.calls[0][0]);
      expect(appendedData.url).toBe("https://api.example.com/data");
    });

    it("should capture 429 rate limit errors", async () => {
      (global.fetch as any).mockResolvedValueOnce(
        new Response("Too Many Requests", { status: 429 })
      );

      const request = new Request("https://api.example.com/data");
      const fetchEvent = {
        request,
        respondWith: vi.fn(async (responsePromise: Promise<Response>) => {
          return await responsePromise;
        }),
      };

      await triggerEvent("fetch", fetchEvent);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockAppend).toHaveBeenCalled();
    });

    it("should NOT capture 4xx client errors", async () => {
      (global.fetch as any).mockResolvedValueOnce(
        new Response("Not Found", { status: 404 })
      );

      const request = new Request("https://api.example.com/data");
      const fetchEvent = {
        request,
        respondWith: vi.fn(async (responsePromise: Promise<Response>) => {
          return await responsePromise;
        }),
      };

      await triggerEvent("fetch", fetchEvent);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockAppend).not.toHaveBeenCalled();
    });

    it("should capture network errors", async () => {
      (global.fetch as any).mockRejectedValueOnce(new Error("Network error"));

      const request = new Request("https://api.example.com/data");
      const fetchEvent = {
        request,
        respondWith: vi.fn(async (responsePromise: Promise<Response>) => {
          try {
            return await responsePromise;
          } catch (e) {
            // Catch error
            throw e;
          }
        }),
      };

      await triggerEvent("fetch", fetchEvent);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockAppend).toHaveBeenCalled();
    });
  });

  describe("Background Sync", () => {
    beforeEach(async () => {
      // Activate first to initialize WAL
      const activateEvent = {
        waitUntil: vi.fn((promise: Promise<any>) => promise),
      };
      await triggerEvent("activate", activateEvent);
      await new Promise((resolve) => setTimeout(resolve, 100));

      mockReplay.mockClear();
    });

    it("should not replay when offline", async () => {
      Object.defineProperty(navigator, "onLine", {
        writable: true,
        value: false,
      });

      const syncEvent = {
        tag: "negretenico-retry",
        waitUntil: vi.fn((promise: Promise<any>) => promise),
      };

      await triggerEvent("sync", syncEvent);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockReplay).not.toHaveBeenCalled();
    });

    it("should not replay for other sync tags", async () => {
      Object.defineProperty(navigator, "onLine", {
        writable: true,
        value: true,
      });

      const syncEvent = {
        tag: "other-sync-tag",
        waitUntil: vi.fn((promise: Promise<any>) => promise),
      };

      await triggerEvent("sync", syncEvent);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockReplay).not.toHaveBeenCalled();
    });
  });
});
