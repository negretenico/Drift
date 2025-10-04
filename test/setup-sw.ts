// packages/sw/vitest.setup.ts
import { vi } from "vitest";

// Basic service worker globals
(global as any).self = global;
(global as any).Request = class Request {
  constructor(public url: string, public init?: any) {
    this.method = init?.method || "GET";
    this.headers = new Map(Object.entries(init?.headers || {}));
    this.body = init?.body;
  }
  method: string;
  headers: Map<string, string>;
  body: any;
  clone() {
    return this;
  }
  text() {
    return Promise.resolve(this.body);
  }
};

(global as any).Response = class Response {
  constructor(public body: any, public init?: { status?: number }) {
    this.status = init?.status || 200;
  }
  status: number;
};

(global as any).Event = class Event {
  constructor(public type: string) {}
};
