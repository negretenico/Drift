import { IWALManager, ReplayResult, WalEntry } from "../types/types";
import { WAL } from "../wal/WAL";
import { randomUUID } from "./randomUUID";

export class BrowserWALManager implements IWALManager {
  private static _instance: BrowserWALManager;
  private readonly _dbName = "drift_wal_db";
  private readonly _storeName = "wal_logs";
  private readonly _logs = new Map<string, WAL>();
  private readonly _pendingOps = new Map<string, Promise<void>>();
  private readonly _registering = new Set<string>();
  private isReplaying = false;
  private _db: IDBDatabase | null = null;

  private constructor() {}

  static getInstance(): BrowserWALManager {
    if (!this._instance) {
      this._instance = new BrowserWALManager();
    }
    return this._instance;
  }

  async initDB(): Promise<IDBDatabase> {
    if (this._db) return this._db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this._dbName, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this._db = request.result;
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this._storeName)) {
          const store = db.createObjectStore(this._storeName, {
            keyPath: "id",
          });
          store.createIndex("fileName", "fileName", { unique: false });
        }
      };
    });
  }

  async register(wal: WAL): Promise<void> {
    if (this._registering.has(wal.fileName)) {
      throw new Error(`WAL ${wal.fileName} is already being registered`);
    }

    if (this._logs.has(wal.fileName)) {
      return;
    }

    this._registering.add(wal.fileName);

    try {
      await this.initDB();
      this._logs.set(wal.fileName, wal);
    } finally {
      this._registering.delete(wal.fileName);
    }
  }

  async append(fileName: string, data: string): Promise<void> {
    const wal = this._logs.get(fileName);
    if (!wal) {
      throw new Error(`WAL ${fileName} is not registered`);
    }

    const previousOp = this._pendingOps.get(fileName) || Promise.resolve();

    const currentOp = previousOp.then(async () => {
      const db = await this.initDB();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(this._storeName, "readwrite");
        const store = tx.objectStore(this._storeName);

        const entry: WalEntry & { fileName: string } = {
          id: randomUUID(), // ✅ ensure unique ID
          data,
          fileName,
          timestamp: Date.now(),
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

  async read(fileName?: string): Promise<string> {
    if (!fileName) {
      // Allow reading the first registered file if none provided
      const [first] = this._logs.keys();
      if (!first) throw new Error("No WAL registered to read");
      fileName = first;
    }

    const wal = this._logs.get(fileName);
    if (!wal) {
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
        const entries = request.result as WalEntry[];
        entries.sort((a, b) => a.timestamp - b.timestamp);
        const content = entries.map((e) => e.data).join("\n");
        resolve(content ? content + "\n" : "");
      };

      request.onerror = () => reject(request.error);
    });
  }

  async truncate(fileName: string): Promise<void> {
    const wal = this._logs.get(fileName);
    if (!wal) {
      throw new Error(`WAL ${fileName} is not registered`);
    }

    const previousOp = this._pendingOps.get(fileName) || Promise.resolve();

    const currentOp = previousOp.then(async () => {
      const db = await this.initDB();
      return new Promise<void>((resolve, reject) => {
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

  async replay(
    fileName: string,
    count: number,
    processor: (event: string) => Promise<void>
  ): Promise<ReplayResult> {
    if (this.isReplaying) {
      throw new Error("Replay already in progress");
    }

    this.isReplaying = true;

    try {
      const content = await this.read(fileName);
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

  async getEventCount(fileName?: string): Promise<number> {
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
}
