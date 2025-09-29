# Relay (WIP)

**Relay** is an offline-first framework for React applications.
It ensures that when your app goes offline, network requests are written to a durable Write-Ahead Log (WAL), then replayed automatically once connectivity is restored.

Build resilient apps that keep working — even when the network doesn’t.

---

## ✨ Features (planned)

* **Write-Ahead Log (WAL):** Durable queue of pending requests stored in IndexedDB.
* **Automatic Replay:** Requests are flushed in-order when the network comes back.
* **Adapters:** Start with REST (fetch), later extend to GraphQL and WebSockets.
* **React Hooks:** `useOfflineMutation`, `useOfflineQuery` with optimistic UI support.
* **Conflict Resolution:** Choose between strategies (`lastWriteWins`, `clientWins`, custom).
* **Dev Tools:** Inspect, pause, replay, and export the WAL.
* **Background Sync:** Service Worker integration for replay outside the active window.

---

## 📦 Packages

* **`@relay/core`** – WAL, replayer, adapters.
* **`@relay/react`** – React provider, hooks, dev tools.
* **`@relay/sw`** – Optional Service Worker integration.
* **`examples/`** – Sample apps (starting with Todo).

---

## 🗺 Roadmap

### Phase 0 – Foundations

* [ ] Choose persistence library (`idb` for IndexedDB).
* [ ] Define types: `LogEntry`, `Adapter`, `ConflictResolver`, `RetryPolicy`.
* [ ] Monorepo setup (`pnpm workspaces` or Turborepo).

### Phase 1 – Core WAL + Replay (Week 1–2)

* [ ] Implement WAL with append/read/delete.
* [ ] Add replayer: sequential send, retry/backoff, success/failure handling.
* [ ] Provide fetch adapter for REST APIs.
* [ ] JS API: `append()`, `replay()`, `inspect()`.

### Phase 2 – React Integration (Week 3–4)

* [ ] Add `OfflineProvider` for React context.
* [ ] Create `useOfflineMutation` (with optimistic updates).
* [ ] Create `useOfflineQuery` (offline caching + refetch).
* [ ] Build Todo example app with offline mutations.

### Phase 3 – Service Worker + Background Sync (Week 5–6)

* [ ] Service Worker for background WAL replay.
* [ ] Fetch interception for progressive offline support.
* [ ] Fallback replay loop when no SW support.

### Phase 4 – Conflict Handling + Dev Tools (Week 7–8)

* [ ] Implement conflict resolution strategies.
* [ ] Add `WALInspector` React component.
* [ ] Provide dev panel for queue control.

### Phase 5 – Extensions (Stretch Goals)

* [ ] GraphQL adapter.
* [ ] WebSocket adapter.
* [ ] CRDT-based conflict resolution.
* [ ] CLI inspector (`relay inspect`).
* [ ] Metrics exporter.

---

## 🚀 Milestones

* **MVP (end of Phase 2):** Todo app demo — create/edit offline, auto-sync online.
* **v1.0 (end of Phase 4):** Stable React hooks, WAL, background sync, conflict handling, and dev tools.

---

## 📖 License

MIT
