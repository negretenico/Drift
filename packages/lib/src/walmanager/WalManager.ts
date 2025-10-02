import { WAL } from "../wal/WAL";
import * as path from "path";
import { mkdir, readFile, appendFile, access, writeFile } from "fs/promises"; // Use promises API
import * as fs from "fs";

export class WALManager {
  private static _instance: WALManager;
  private readonly _baseDir: string;
  private readonly _logs = new Map<string, WAL>();

  // Track pending operations per file to prevent concurrent writes
  private readonly _pendingOps = new Map<string, Promise<void>>();

  // Track if registration is in progress
  private readonly _registering = new Set<string>();

  private constructor(baseDir?: string) {
    this._baseDir = baseDir ?? path.resolve(process.cwd(), "wal_logs");
  }

  static getInstance(): WALManager {
    if (!this._instance) {
      this._instance = new WALManager();
    }
    return this._instance;
  }

  private async ensureBaseDir(): Promise<void> {
    await mkdir(this._baseDir, { recursive: true });
  }

  /**
   * Register wal, and create directories if the wal does not exist
   * Prevents concurrent registration of the same WAL
   * @param wal wal we wish to track
   */
  async register(wal: WAL): Promise<void> {
    // Prevent concurrent registration of the same file
    if (this._registering.has(wal.fileName)) {
      throw new Error(`WAL ${wal.fileName} is already being registered`);
    }

    if (this._logs.has(wal.fileName)) {
      return; // Already registered
    }

    this._registering.add(wal.fileName);

    try {
      await this.ensureBaseDir();

      const filePath = path.join(this._baseDir, wal.fileName);
      this._logs.set(wal.fileName, wal);

      try {
        await access(filePath, fs.constants.F_OK);
      } catch {
        // File doesn't exist, create it
        await writeFile(filePath, "", { encoding: "utf-8" });
      }
    } finally {
      this._registering.delete(wal.fileName);
    }
  }

  /**
   * Append to existing wal with write serialization
   * Ensures writes happen in order without interleaving
   * @param fileName
   * @param data
   */
  async append(fileName: string, data: string): Promise<void> {
    const wal = this._logs.get(fileName);
    if (!wal) {
      throw new Error(`WAL ${fileName} is not registered`);
    }

    const filePath = path.join(this._baseDir, wal.fileName);

    // Chain this write operation after any pending operations
    const previousOp = this._pendingOps.get(fileName) || Promise.resolve();

    const currentOp = previousOp.then(async () => {
      await appendFile(filePath, data + "\n", { encoding: "utf-8" });
    });

    this._pendingOps.set(fileName, currentOp);

    try {
      await currentOp;
    } finally {
      // Clean up if this was the last operation
      if (this._pendingOps.get(fileName) === currentOp) {
        this._pendingOps.delete(fileName);
      }
    }
  }

  /**
   * Return current contents of file
   * Uses async readFile instead of blocking readFileSync
   * @param fileName
   * @returns
   */
  async read(fileName: string): Promise<string> {
    const wal = this._logs.get(fileName);
    if (!wal) {
      throw new Error(`WAL ${fileName} is not registered`);
    }

    const filePath = path.join(this._baseDir, wal.fileName);

    // Wait for any pending writes to complete before reading
    const pendingOp = this._pendingOps.get(fileName);
    if (pendingOp) {
      await pendingOp;
    }

    return readFile(filePath, "utf-8");
  }

  /**
   * Truncate/clear a WAL file
   * @param fileName
   */
  async truncate(fileName: string): Promise<void> {
    const wal = this._logs.get(fileName);
    if (!wal) {
      throw new Error(`WAL ${fileName} is not registered`);
    }

    const filePath = path.join(this._baseDir, wal.fileName);

    // Serialize truncate with other operations
    const previousOp = this._pendingOps.get(fileName) || Promise.resolve();

    const currentOp = previousOp.then(async () => {
      await writeFile(filePath, "", { encoding: "utf-8" });
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
}
