import { describe, it, expect } from "vitest";
import { WAL, WALBuilder } from "./WAL";

describe("WAL", () => {
  describe("Builder", () => {
    it("should throw an error when I try to build without a file name", () => {
      const builder = new WALBuilder();
      expect(() => builder.build()).toThrow();
    });
    it("should give a file when builder is commplete", () => {
      expect(new WALBuilder().file("nico.txt").build()).toBeInstanceOf(WAL);
    });
  });
  describe("WAL", () => {
    it("should not allow none builders to create", () => {
      expect(() => new WAL(Symbol.iterator, "name")).toThrow();
    });
    it("should give back the file name", () => {
      const wal = new WALBuilder().file("nico.txt").build();
      expect(wal.fileName).toEqual("nico.txt");
    });
  });
});
