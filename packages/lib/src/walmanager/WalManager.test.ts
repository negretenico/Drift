import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WAL } from "../wal/WAL";
import * as path from "path";
import * as fs from "fs/promises";
import { existsSync } from "fs";
import { WALManager } from "./WalManager";

describe("WALManager", () => {
  let walManager: WALManager;
  let testDir: string;

  beforeEach(async () => {
    // Create a unique test directory for each test
    testDir = path.join(process.cwd(), `test_wal_${Date.now()}`);
    walManager = new (WALManager as any)(testDir); // Bypass singleton for testing
  });

  afterEach(async () => {
    // Clean up test directory
    if (existsSync(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  describe("Functionality", () => {
    describe("Register", () => {
      it("should register a new WAL and create the file", async () => {
        const wal = WAL.builder().file("test.wal").build();

        await walManager.register(wal);

        const filePath = path.join(testDir, "test.wal");
        expect(existsSync(filePath)).toBe(true);
      });

      it("should not create duplicate files when registering the same WAL twice", async () => {
        const wal = WAL.builder().file("test.wal").build();

        await walManager.register(wal);
        await walManager.register(wal);

        const filePath = path.join(testDir, "test.wal");
        expect(existsSync(filePath)).toBe(true);
      });

      it("should create the base directory if it doesn't exist", async () => {
        expect(existsSync(testDir)).toBe(false);

        const wal = WAL.builder().file("test.wal").build();
        await walManager.register(wal);

        expect(existsSync(testDir)).toBe(true);
      });
    });

    describe("Read", () => {
      it("should read the file when it exists", async () => {
        const wal = WAL.builder().file("test.wal").build();
        await walManager.register(wal);

        const filePath = path.join(testDir, "test.wal");
        await fs.writeFile(filePath, "line1\nline2\nline3\n", "utf-8");

        const content = await walManager.read("test.wal");
        expect(content).toBe("line1\nline2\nline3\n");
      });

      it("should read empty file content", async () => {
        const wal = WAL.builder().file("empty.wal").build();
        await walManager.register(wal);

        const content = await walManager.read("empty.wal");
        expect(content).toBe("");
      });

      it("should throw error when trying to read from a nonexistent file", async () => {
        await expect(walManager.read("nonexistent.wal")).rejects.toThrow(
          "WAL nonexistent.wal is not registered"
        );
      });

      it("should read after write consistency", async () => {
        const wal = WAL.builder().file("test.wal").build();
        await walManager.register(wal);

        await walManager.append("test.wal", "data1");
        await walManager.append("test.wal", "data2");

        const content = await walManager.read("test.wal");
        expect(content).toBe("data1\ndata2\n");
      });
    });

    describe("Append", () => {
      it("should append to the existing file", async () => {
        const wal = WAL.builder().file("test.wal").build();
        await walManager.register(wal);

        await walManager.append("test.wal", "first line");
        await walManager.append("test.wal", "second line");

        const content = await walManager.read("test.wal");
        expect(content).toBe("first line\nsecond line\n");
      });

      it("should append multiple times in sequence", async () => {
        const wal = WAL.builder().file("test.wal").build();
        await walManager.register(wal);

        for (let i = 0; i < 5; i++) {
          await walManager.append("test.wal", `line ${i}`);
        }

        const content = await walManager.read("test.wal");
        expect(content).toBe("line 0\nline 1\nline 2\nline 3\nline 4\n");
      });

      it("should throw error when trying to append to a file that is nonexistent", async () => {
        await expect(
          walManager.append("nonexistent.wal", "data")
        ).rejects.toThrow("WAL nonexistent.wal is not registered");
      });

      it("should handle concurrent appends correctly", async () => {
        const wal = WAL.builder().file("concurrent.wal").build();
        await walManager.register(wal);

        // Fire off 10 concurrent appends
        const promises = [];
        for (let i = 0; i < 10; i++) {
          promises.push(walManager.append("concurrent.wal", `line ${i}`));
        }

        await Promise.all(promises);

        const content = await walManager.read("concurrent.wal");
        const lines = content.trim().split("\n");

        // All 10 lines should be present
        expect(lines.length).toBe(10);

        // Each line should appear exactly once (no corruption/interleaving)
        for (let i = 0; i < 10; i++) {
          expect(lines).toContain(`line ${i}`);
        }
      });
    });

    describe("Truncate", () => {
      it("should clear the file contents", async () => {
        const wal = WAL.builder().file("test.wal").build();
        await walManager.register(wal);

        await walManager.append("test.wal", "line1");
        await walManager.append("test.wal", "line2");

        await walManager.truncate("test.wal");

        const content = await walManager.read("test.wal");
        expect(content).toBe("");
      });

      it("should throw error when trying to truncate unregistered file", async () => {
        await expect(walManager.truncate("nonexistent.wal")).rejects.toThrow(
          "WAL nonexistent.wal is not registered"
        );
      });
    });

    describe("Concurrency Safety", () => {
      it("should handle mixed concurrent operations", async () => {
        const wal = WAL.builder().file("mixed.wal").build();
        await walManager.register(wal);

        // Mix of appends and reads
        const operations = [
          walManager.append("mixed.wal", "data1"),
          walManager.append("mixed.wal", "data2"),
          walManager.read("mixed.wal"),
          walManager.append("mixed.wal", "data3"),
          walManager.read("mixed.wal"),
        ];

        await Promise.all(operations);

        const finalContent = await walManager.read("mixed.wal");
        expect(finalContent).toBe("data1\ndata2\ndata3\n");
      });

      it("should serialize writes and truncates", async () => {
        const wal = WAL.builder().file("serialize.wal").build();
        await walManager.register(wal);

        await walManager.append("serialize.wal", "data1");

        const operations = [
          walManager.append("serialize.wal", "data2"),
          walManager.truncate("serialize.wal"),
          walManager.append("serialize.wal", "data3"),
        ];

        await Promise.all(operations);

        const content = await walManager.read("serialize.wal");
        // Due to serialization, final state should be deterministic
        // Either empty (if truncate was last) or contains data3 (if append was last)
        expect(content.includes("data1")).toBe(false); // data1 should be gone after truncate
      });
    });
  });
});
