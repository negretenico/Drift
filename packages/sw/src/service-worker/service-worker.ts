// @ts-nocheck
import { WALClient, BrowserDurableWAL } from "@negretenico/lib";

let wal = null; // will hold an instance of DurableWalClient

self.addEventListener("install", (event) => {
  console.info("[Drift:SW] Installing…");
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      console.info("[Drift:SW] Activating…");

      // create the durability manager (implements IDurabilityManager)
      const durableManager = new BrowserDurableWAL({
        walFileName: "wal.log",
      });
      // IMPORTANT: pass the durableManager into the client constructor
      // Your library re-exports DurableWalClient as WALClient
      wal = new WALClient(durableManager);

      // claim clients so SW starts controlling pages
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
          error: "WAL not initialized",
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
          error: String(error),
        });
      }
      break;
  }
});

const serializeRequest = async (req) => {
  return {
    url: req.url,
    method: req.method,
    headers: Object.fromEntries(req.headers.entries()),
    body: req.clone
      ? await req
          .clone()
          .text()
          .catch(() => null)
      : null,
    mode: req.mode,
    credentials: req.credentials,
    cache: req.cache,
    redirect: req.redirect,
    referrer: req.referrer,
    referrerPolicy: req.referrerPolicy,
  };
};

async function deserializeRequest(data: any): Promise<Request> {
  // Only include body if method allows it and body is non-empty
  const method = (data.method || "GET").toUpperCase();
  const hasBody = data.body && !["GET", "HEAD"].includes(method);

  return new Request(data.url, {
    method,
    headers: data.headers,
    body: hasBody ? data.body : undefined,
    mode: data.mode,
    credentials: data.credentials,
    cache: data.cache,
    redirect: data.redirect,
    referrer: data.referrer,
    referrerPolicy: data.referrerPolicy,
  });
}

self.addEventListener("fetch", (e) => {
  e.respondWith(
    (async () => {
      // Defensively handle WAL not yet initialized
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
            throw e; // propagate so replay can mark the event as failed
          }
        });
      })()
    );
  }
});
