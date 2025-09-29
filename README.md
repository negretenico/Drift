# Relay

**Relay** is an offline-first framework for React applications.
Its goal is simple but powerful: **make your app resilient to bad networks**.

Whether your users are on a plane, in a subway tunnel, or just dealing with flaky Wi-Fi, Relay ensures your app keeps working. All requests are safely queued into a **Write-Ahead Log (WAL)** and replayed once connectivity is restored — so your app stays usable and consistent no matter the conditions.

---

## 🎯 Project Goal

Modern applications often assume “always online.”
In reality, networks drop, time out, and fail at the worst moments. Relay provides a foundation for **resilient offline-first behavior**:

* **Never lose a user action.** Every mutation (create, update, delete) is logged locally.
* **Keep the UI responsive.** Updates apply optimistically while requests wait in the WAL.
* **Recover automatically.** When the connection comes back, Relay replays requests in order.
* **Stay consistent.** Conflict resolution strategies ensure data doesn’t drift out of sync.
* **Developer-first.** Simple React hooks and dev tools let you adopt offline-first patterns without rewriting your app.

In short: **Relay ensures your application remains stable and useful under any network conditions.**

---

## ✨ Core Concepts

* **Write-Ahead Log (WAL):** An append-only queue in IndexedDB that safely stores all outbound requests while offline.
* **Replay Engine:** Flushes WAL entries once online, with retry and backoff.
* **Adapters:** Plug in REST (fetch), GraphQL, or WebSocket transports.
* **React Integration:** Hooks like `useOfflineMutation` and `useOfflineQuery` make offline-first a one-line change.
* **Conflict Handling:** Choose between strategies (`lastWriteWins`, `clientWins`, or custom).
* **Developer Tools:** Inspect, replay, pause, and debug the WAL.

---

## 🛠 Example

```tsx
import { OfflineProvider, useOfflineMutation } from "@relay/react";

function AddTodo() {
  const { mutate, status } = useOfflineMutation({
    url: "/api/todos",
    method: "POST",
    optimisticUpdater: (cache, payload) => {
      cache.todos.push({ id: Date.now(), text: payload.text, completed: false });
    },
  });

  return (
    <div>
      <button onClick={() => mutate({ text: "Buy milk" })}>
        Add Todo
      </button>
      <span>{status}</span>
    </div>
  );
}

export default function App() {
  return (
    <OfflineProvider>
      <AddTodo />
    </OfflineProvider>
  );
}
```

Even if the network is down when the user clicks **Add Todo**, the UI updates instantly and the request is stored. When connectivity returns, Relay replays the action automatically.

---

## 📦 Packages

* **`@relay/core`** – WAL, replay engine, adapters.
* **`@relay/react`** – React provider, hooks, and dev tools.
* **`@relay/sw`** – Service Worker integration for background sync.

---

## 🚀 Why Relay?

* Apps shouldn’t break when the network does.
* Developers shouldn’t reinvent offline-first logic every time.
* Users should always trust that their actions are saved.

Relay makes **offline-first the default**, not the exception.

---

## 📖 License

MIT
