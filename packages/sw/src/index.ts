/**
 * Register the Drift service worker
 * By default, looks for the worker at /service-worker.js
 * Run `npx drift-sw <dir>` to copy the worker file to your public directory
 */
export async function registerDriftServiceWorker(
  scriptUrl: string = "/service-worker.js",
  options?: RegistrationOptions
): Promise<ServiceWorkerRegistration | undefined> {
  if (!("serviceWorker" in navigator)) {
    console.warn("Drift:SW: Service workers are not supported");
    return undefined;
  }

  try {
    const registration = await navigator.serviceWorker.register(scriptUrl, {
      scope: "./",
      ...options,
    });

    if (registration.installing) {
      console.info("Drift:SW: Service worker installing");
    } else if (registration.waiting) {
      console.info("Drift:SW: Service worker installed");
    } else if (registration.active) {
      console.info("Drift:SW: Service worker active");
    }

    // Register for background sync
    if ("sync" in registration) {
      // @ts-ignore
      await registration.sync.register("drift-retry");
    }

    return registration;
  } catch (err) {
    console.error("Drift:SW: Registration failed", err);
    throw err;
  }
}

/**
 * Send a message to the service worker
 */
export async function sendMessageToServiceWorker(message: any): Promise<any> {
  if (!navigator.serviceWorker.controller) {
    throw new Error("No active service worker controller");
  }

  return new Promise((resolve, reject) => {
    const messageChannel = new MessageChannel();

    messageChannel.port1.onmessage = (event) => {
      if (event.data.error) {
        reject(new Error(event.data.error));
      } else {
        resolve(event.data);
      }
    };
    // @ts-ignore
    navigator.serviceWorker.controller.postMessage(message, [
      messageChannel.port2,
    ]);

    // Timeout after 5 seconds
    setTimeout(() => reject(new Error("Message timeout")), 5000);
  });
}

/**
 * Trigger replay of failed requests
 */
export async function replayFailedRequests(count?: number): Promise<void> {
  return sendMessageToServiceWorker({
    type: "REPLAY_WAL",
    payload: { count: count || 50 },
  });
}

/**
 * Check if service worker is ready
 */
export async function isServiceWorkerReady(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) {
    return false;
  }
  const registration = await navigator.serviceWorker.ready;
  return !!registration.active;
}

/**
 * Unregister the Drift service worker
 */
export async function unregisterDriftServiceWorker(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) {
    return false;
  }

  const registration = await navigator.serviceWorker.getRegistration();
  if (registration) {
    return await registration.unregister();
  }
  return false;
}
