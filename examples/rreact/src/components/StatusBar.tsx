import { useEffect, useState } from "react";
import { useOfflineRetry } from "@negretenico/react";

export default function StatusBar() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const { retryAll, retryLast, getFailedCount, failedCount } = useOfflineRetry({
    onRetry: async (serialized) => {
      console.log("[Retry] Processing:", serialized);
      const operation = JSON.parse(serialized);

      if (operation.type === "request" && operation.variables) {
        const { url, method, body } = operation.variables;

        const response = await fetch(url, {
          method: method || "GET",
          headers: body ? { "Content-Type": "application/json" } : {},
          body: body ? JSON.stringify(body) : undefined,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        console.log("[Retry] Success:", await response.text());
      }
    },
    onRetrySuccess: (serialized) => {
      console.log("[Retry] Successfully retried operation" + serialized);
    },
    onRetryError: (error, serialized) => {
      console.error("[Retry] Failed to retry:", error.message, serialized);
    },
  });

  useEffect(() => {
    const handleOnline = () => {
      console.log("[Status] Back online!");
      setIsOnline(true);
    };

    const handleOffline = () => {
      console.log("[Status] Went offline!");
      setIsOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    getFailedCount();

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [getFailedCount]);
  useEffect(() => {
    if (!isOnline) return;

    // Poll every 2 seconds when online
    const interval = setInterval(() => {
      getFailedCount();
    }, 2000);

    return () => clearInterval(interval);
  }, [isOnline, getFailedCount]);
  return (
    <div className="bg-white shadow-sm border-b border-gray-200">
      <div className="max-w-4xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <div
                className={`h-3 w-3 rounded-full ${
                  isOnline ? "bg-green-500" : "bg-red-500"
                }`}
              />
              <span className="text-sm font-medium text-gray-700">
                {isOnline ? "Online" : "Offline"}
              </span>
            </div>

            {failedCount > 0 && (
              <span className="px-2 py-1 text-xs font-medium text-red-700 bg-red-100 rounded-full">
                {failedCount} failed
              </span>
            )}
          </div>

          {failedCount > 0 && isOnline && (
            <div className="flex space-x-2">
              <button
                onClick={retryLast}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
              >
                Retry Last
              </button>
              <button
                onClick={retryAll}
                className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
              >
                Retry All ({failedCount})
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
