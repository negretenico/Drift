const builderKey = Symbol("WALBuilder");

export class WAL {
  private readonly _fileName: string;

  constructor(key: symbol, fileName: string) {
    if (key !== builderKey) {
      throw new Error(
        "WAL cannot be constructed directly. Use WAL.builder() instead."
      );
    }
    this._fileName = fileName;
  }

  get fileName(): string {
    return this._fileName;
  }

  static builder(): WALBuilder {
    return new WALBuilder();
  }
}

export class WALBuilder {
  private _fileName?: string;

  file(fileName: string): this {
    this._fileName = fileName;
    return this;
  }

  build(): WAL {
    if (!this._fileName) {
      throw new Error("fileName is required");
    }
    // WALBuilder has access to the symbol key
    return new WAL(builderKey, this._fileName);
  }
}
