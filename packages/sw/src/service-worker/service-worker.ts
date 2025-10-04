// @ts-nocheck
import { DurableWal, DurableWalType } from "@negretenico/lib";

let wal: DurableWalType | undefined;

self.addEventListener("install", (event) => {
  console.info("[Drift:SW] Installing…");
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      console.info("[Drift:SW] Activating…");
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      wal = new DurableWal({
        durableConfig: {
          walFileName: "service-worker.log",
          retryConfig: {
            maxRetries: 5,
            initialDelayMs: 1000,
            maxDelayMs: 10_000,
            backoffMultiplier: 10,
          },
          onEventProcessed: (event, success) => {
            console.log(
              `[Drift:SW] Event processed: ${event}, success: ${success}`
            );
          },
        },
      });
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", async (event) => {
  const { type, payload } = event.data;
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
        await wal.replay(payload?.count || 50, async (eventStr: string) => {
          console.log("[Drift:SW] Replaying:", eventStr);
          const req = await deserializeRequest(JSON.parse(eventStr));
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

const serializeRequest = async (req: Request) => {
  return {
    url: req.url,
    method: req.method,
    headers: Object.fromEntries(req.headers.entries()),
    body: req.body ? await req.clone().text() : null,
    mode: req.mode,
    credentials: req.credentials,
    cache: req.cache,
    redirect: req.redirect,
    referrer: req.referrer,
    referrerPolicy: req.referrerPolicy,
  };
};

async function deserializeRequest(
  data: Awaited<ReturnType<typeof serializeRequest>>
) {
  return new Request(data.url, {
    method: data.method,
    headers: data.headers,
    body: data.body,
    mode: data.mode,
    credentials: data.credentials,
    cache: data.cache,
    redirect: data.redirect,
    referrer: data.referrer,
    referrerPolicy: data.referrerPolicy,
  });
}

// Check response status, not request status
self.addEventListener("fetch", (event: FetchEvent) => {
  console.debug("[Drift:SW] Intercepted:", event.request.url);

  event.respondWith(
    (async () => {
      try {
        const response = await fetch(event.request);

        // Check if response failed with retriable error
        if (response.status >= 500 || response.status === 429) {
          console.debug(
            `[Drift:SW] Adding failed request to WAL: ${event.request.url}`
          );
          if (wal) {
            const serialized = await serializeRequest(event.request);
            await wal.append(JSON.stringify(serialized));
          }
        }

        return response;
      } catch (error) {
        // Network error - definitely should retry
        console.warn(
          `[Drift:SW] Network error, adding to WAL: ${event.request.url}`
        );
        if (wal) {
          const serialized = await serializeRequest(event.request);
          await wal.append(JSON.stringify(serialized));
        }
        throw error;
      }
    })()
  );
});

// Background Sync API
self.addEventListener("sync", (event: any) => {
  if (event.tag === "drift-retry") {
    event.waitUntil(
      (async () => {
        if (!self.navigator.onLine) {
          console.warn(`[Drift:SW] Not syncing, still offline`);
          return;
        }

        if (!wal) {
          console.warn(`[Drift:SW] WAL not initialized`);
          return;
        }

        console.info(`[Drift:SW] Retrying failed requests`);
        await wal.replay(50, async (req: string) => {
          const desReq = await deserializeRequest(JSON.parse(req));
          try {
            await fetch(desReq);
            console.info(`[Drift:SW] Retry successful: ${desReq.url}`);
          } catch (e) {
            console.error(`[Drift:SW] Retry failed: ${e}`);
            throw e; // Re-throw so WAL knows it failed
          }
        });
      })()
    );
  }
});
