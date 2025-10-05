"use strict";
(() => {
  // ../lib/dist/index.mjs
  function randomUUID() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === "x" ? r : r & 3 | 8;
      return v.toString(16);
    });
  }
  var BrowserWALManager = class _BrowserWALManager {
    constructor() {
      this._dbName = "drift_wal_db";
      this._storeName = "wal_logs";
      this._logs = /* @__PURE__ */ new Map();
      this._pendingOps = /* @__PURE__ */ new Map();
      this._registering = /* @__PURE__ */ new Set();
      this.isReplaying = false;
      this._db = null;
    }
    static getInstance() {
      if (!this._instance) {
        this._instance = new _BrowserWALManager();
      }
      return this._instance;
    }
    async initDB() {
      if (this._db) return this._db;
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(this._dbName, 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          this._db = request.result;
          resolve(request.result);
        };
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(this._storeName)) {
            const store = db.createObjectStore(this._storeName, {
              keyPath: "id"
            });
            store.createIndex("fileName", "fileName", { unique: false });
          }
        };
      });
    }
    async register(wal2) {
      if (this._registering.has(wal2.fileName)) {
        throw new Error(`WAL ${wal2.fileName} is already being registered`);
      }
      if (this._logs.has(wal2.fileName)) {
        return;
      }
      this._registering.add(wal2.fileName);
      try {
        await this.initDB();
        this._logs.set(wal2.fileName, wal2);
      } finally {
        this._registering.delete(wal2.fileName);
      }
    }
    async append(fileName, data) {
      const wal2 = this._logs.get(fileName);
      if (!wal2) {
        throw new Error(`WAL ${fileName} is not registered`);
      }
      const previousOp = this._pendingOps.get(fileName) || Promise.resolve();
      const currentOp = previousOp.then(async () => {
        const db = await this.initDB();
        return new Promise((resolve, reject) => {
          const tx = db.transaction(this._storeName, "readwrite");
          const store = tx.objectStore(this._storeName);
          const entry = {
            id: randomUUID(),
            // ✅ ensure unique ID
            data,
            fileName,
            timestamp: Date.now()
          };
          const request = store.add(entry);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      });
      this._pendingOps.set(fileName, currentOp);
      try {
        await currentOp;
      } finally {
        if (this._pendingOps.get(fileName) === currentOp) {
          this._pendingOps.delete(fileName);
        }
      }
    }
    async read(fileName) {
      if (!fileName) {
        const [first] = this._logs.keys();
        if (!first) throw new Error("No WAL registered to read");
        fileName = first;
      }
      const wal2 = this._logs.get(fileName);
      if (!wal2) {
        throw new Error(`WAL ${fileName} is not registered`);
      }
      const pendingOp = this._pendingOps.get(fileName);
      if (pendingOp) await pendingOp;
      const db = await this.initDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this._storeName, "readonly");
        const store = tx.objectStore(this._storeName);
        const index = store.index("fileName");
        const request = index.getAll(fileName);
        request.onsuccess = () => {
          const entries = request.result;
          entries.sort((a, b) => a.timestamp - b.timestamp);
          const content = entries.map((e) => e.data).join("\n");
          resolve(content ? content + "\n" : "");
        };
        request.onerror = () => reject(request.error);
      });
    }
    async truncate(fileName) {
      const wal2 = this._logs.get(fileName);
      if (!wal2) {
        throw new Error(`WAL ${fileName} is not registered`);
      }
      const previousOp = this._pendingOps.get(fileName) || Promise.resolve();
      const currentOp = previousOp.then(async () => {
        const db = await this.initDB();
        return new Promise((resolve, reject) => {
          const tx = db.transaction(this._storeName, "readwrite");
          const store = tx.objectStore(this._storeName);
          const index = store.index("fileName");
          const request = index.openCursor(fileName);
          request.onsuccess = () => {
            const cursor = request.result;
            if (cursor) {
              cursor.delete();
              cursor.continue();
            } else {
              resolve();
            }
          };
          request.onerror = () => reject(request.error);
        });
      });
      this._pendingOps.set(fileName, currentOp);
      try {
        await currentOp;
      } finally {
        if (this._pendingOps.get(fileName) === currentOp) {
          this._pendingOps.delete(fileName);
        }
      }
    }
    async replay(fileName, count, processor) {
      if (this.isReplaying) {
        throw new Error("Replay already in progress");
      }
      this.isReplaying = true;
      try {
        const content = await this.read(fileName);
        const events = content.split("\n").filter((line) => line.trim().length > 0);
        const eventsToReplay = count <= 0 ? [] : events.slice(-count);
        const result = {
          success: true,
          processedCount: 0,
          failedCount: 0,
          errors: []
        };
        for (const event of eventsToReplay) {
          try {
            await processor(event);
            result.processedCount++;
          } catch (err) {
            result.failedCount++;
            result.success = false;
            result.errors.push(err instanceof Error ? err : new Error(err));
          }
        }
        return result;
      } finally {
        this.isReplaying = false;
      }
    }
    async getEventCount(fileName) {
      if (!fileName) {
        const [first] = this._logs.keys();
        if (!first) return 0;
        fileName = first;
      }
      const db = await this.initDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this._storeName, "readonly");
        const store = tx.objectStore(this._storeName);
        const index = store.index("fileName");
        const request = index.getAll(fileName);
        request.onsuccess = () => resolve(request.result.length);
        request.onerror = () => reject(request.error);
      });
    }
  };
  var WALManagerFactory = class {
    static create(type) {
      const map = {
        BROWSER: BrowserWALManager.getInstance()
      };
      return map[type] ?? BrowserWALManager.getInstance();
    }
  };
  var builderKey = Symbol("WALBuilder");
  var WAL = class {
    constructor(key, fileName) {
      if (key !== builderKey) {
        throw new Error(
          "WAL cannot be constructed directly. Use WAL.builder() instead."
        );
      }
      this._fileName = fileName;
    }
    get fileName() {
      return this._fileName;
    }
    static builder() {
      return new WALBuilder();
    }
  };
  var WALBuilder = class {
    file(fileName) {
      this._fileName = fileName;
      return this;
    }
    build() {
      if (!this._fileName) {
        throw new Error("fileName is required");
      }
      return new WAL(builderKey, this._fileName);
    }
  };
  var DEFAULT_RETRY_CONFIG = {
    maxRetries: 3,
    initialDelayMs: 100,
    maxDelayMs: 5e3,
    backoffMultiplier: 2
  };
  var BrowserDurableWAL = class {
    constructor(config) {
      this.isReplaying = false;
      this.walManager = WALManagerFactory.create("BROWSER");
      this.walFileName = config.walFileName;
      this.walManager.register(new WALBuilder().file(this.walFileName).build());
      this.retryConfig = config.retryConfig ?? DEFAULT_RETRY_CONFIG;
      this.onEventProcessed = config.onEventProcessed;
    }
    /**
     * Append data to the WAL
     */
    async append(content) {
      await this.walManager.append(this.walFileName, content);
    }
    /**
     * Read the full WAL contents
     */
    async read() {
      return await this.walManager.read(this.walFileName);
    }
    /**
     * Replay the last N events with retry + backoff logic
     */
    async replay(count, processor) {
      if (this.isReplaying) {
        throw new Error("Replay already in progress");
      }
      this.isReplaying = true;
      try {
        const content = await this.walManager.read(this.walFileName);
        const events = content.split("\n").filter((line) => line.trim().length > 0);
        const eventsToReplay = count <= 0 ? [] : events.slice(-count);
        const result = {
          success: true,
          processedCount: 0,
          failedCount: 0,
          errors: []
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
    async processEventWithRetry(event, processor) {
      let lastError = null;
      let attemptCount = 0;
      for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
        attemptCount++;
        try {
          await processor(event);
          return true;
        } catch (error) {
          lastError = error;
          if (attempt < this.retryConfig.maxRetries) {
            const delay = this.calculateBackoffDelay(attempt);
            await this.sleep(delay);
          }
        }
      }
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
    calculateBackoffDelay(attempt) {
      const exponentialDelay = this.retryConfig.initialDelayMs * Math.pow(this.retryConfig.backoffMultiplier, attempt);
      const cappedDelay = Math.min(exponentialDelay, this.retryConfig.maxDelayMs);
      const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1);
      return Math.floor(cappedDelay + jitter);
    }
    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
    /**
     * Get total number of events in the WAL
     */
    async getEventCount() {
      const content = await this.walManager.read(this.walFileName);
      return content.split("\n").filter((line) => line.trim().length > 0).length;
    }
    /**
     * Replay status
     */
    get isReplayInProgress() {
      return this.isReplaying;
    }
  };
  var DurableWalClient = class {
    constructor(durabilityManager) {
      this.durabilityManager = durabilityManager;
    }
    /**
     * Append user content to the WAL with metadata.
     *
     * @param content - User data to append
     * @returns Unique entry ID
     */
    async append(content) {
      if (!content || content.trim().length === 0) {
        throw new Error("Cannot append empty content");
      }
      const entry = {
        id: randomUUID(),
        timestamp: Date.now(),
        data: content
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
    async replay(eventNum, processor) {
      if (eventNum < 0) throw new Error("Event number must be non-negative");
      if (!processor || typeof processor !== "function")
        throw new Error("Processor function is required");
      const wrappedProcessor = async (serialized) => {
        try {
          const entry = JSON.parse(serialized);
          await processor(entry.data);
        } catch {
          await processor(serialized);
        }
      };
      const result = await this.durabilityManager.replay(
        eventNum,
        wrappedProcessor
      );
      if (!result.success) {
        throw new Error(
          `Replay failed: ${result.failedCount} events failed out of ${result.processedCount + result.failedCount}`
        );
      }
    }
    /**
     * Inspect the last N events from the WAL.
     *
     * @param numberOfEvents - Number of events to retrieve
     * @returns Array of user data strings (metadata stripped)
     */
    async inspect(numberOfEvents) {
      if (numberOfEvents < 0)
        throw new Error("Number of events must be non-negative");
      const content = await this.durabilityManager.read();
      const lines = content.split("\n").filter((l) => l.trim().length > 0);
      const lastN = numberOfEvents <= 0 ? [] : lines.slice(-numberOfEvents);
      return lastN.map((line) => {
        try {
          const entry = JSON.parse(line);
          return entry.data;
        } catch {
          return line;
        }
      });
    }
  };

  // src/service-worker/service-worker.ts
  var wal = null;
  self.addEventListener("install", (event) => {
    console.info("[Drift:SW] Installing\u2026");
    self.skipWaiting();
  });
  self.addEventListener("activate", (e) => {
    e.waitUntil(
      (async () => {
        console.info("[Drift:SW] Activating\u2026");
        const durableManager = new BrowserDurableWAL({
          walFileName: "wal.log"
        });
        wal = new DurableWalClient(durableManager);
        await self.clients.claim();
        console.info("[Drift:SW] WAL initialized");
      })()
    );
  });
  self.addEventListener("message", async (event) => {
    const { type, payload } = event.data || {};
    switch (type) {
      case "PING":
        event.source?.postMessage({ type: "PONG" });
        break;
      case "REPLAY_WAL":
        if (!wal) {
          event.source?.postMessage({
            type: "REPLAY_ERROR",
            error: "WAL not initialized"
          });
          return;
        }
        try {
          await wal.replay(payload?.count || 50, async (eventStr) => {
            const retryEvenet = JSON.parse(JSON.parse(eventStr).data);
            console.log("[Drift:SW] Replaying:", retryEvenet);
            const req = await deserializeRequest(retryEvenet);
            await fetch(req);
          });
          event.source?.postMessage({ type: "REPLAY_COMPLETE" });
        } catch (error) {
          event.source?.postMessage({
            type: "REPLAY_ERROR",
            error: String(error)
          });
        }
        break;
    }
  });
  var serializeRequest = async (req) => {
    return {
      url: req.url,
      method: req.method,
      headers: Object.fromEntries(req.headers.entries()),
      body: req.clone ? await req.clone().text().catch(() => null) : null,
      mode: req.mode,
      credentials: req.credentials,
      cache: req.cache,
      redirect: req.redirect,
      referrer: req.referrer,
      referrerPolicy: req.referrerPolicy
    };
  };
  async function deserializeRequest(data) {
    const method = (data.method || "GET").toUpperCase();
    const hasBody = data.body && !["GET", "HEAD"].includes(method);
    return new Request(data.url, {
      method,
      headers: data.headers,
      body: hasBody ? data.body : void 0,
      mode: data.mode,
      credentials: data.credentials,
      cache: data.cache,
      redirect: data.redirect,
      referrer: data.referrer,
      referrerPolicy: data.referrerPolicy
    });
  }
  self.addEventListener("fetch", (e) => {
    e.respondWith(
      (async () => {
        if (!wal) {
          console.warn("[Drift:SW] WAL not ready, performing normal fetch");
          return fetch(e.request);
        }
        try {
          const response = await fetch(e.request);
          if (response.status >= 500 || response.status === 429) {
            const serialized = JSON.stringify(await serializeRequest(e.request));
            await wal.append(serialized);
          }
          return response;
        } catch (error) {
          const serialized = JSON.stringify(await serializeRequest(e.request));
          await wal.append(serialized);
          throw error;
        }
      })()
    );
  });
  self.addEventListener("sync", (event) => {
    if (event.tag === "drift-retry") {
      event.waitUntil(
        (async () => {
          if (!navigator.onLine) {
            console.warn(`[Drift:SW] Not syncing, still offline`);
            return;
          }
          if (!wal) {
            console.warn(`[Drift:SW] WAL not initialized`);
            return;
          }
          console.info(`[Drift:SW] Retrying failed requests`);
          await wal.replay(50, async (req) => {
            const desReq = await deserializeRequest(JSON.parse(req));
            try {
              await fetch(desReq);
              console.info(`[Drift:SW] Retry successful: ${desReq.url}`);
            } catch (e) {
              console.error(`[Drift:SW] Retry failed: ${e}`);
              throw e;
            }
          });
        })()
      );
    }
  });
})();
