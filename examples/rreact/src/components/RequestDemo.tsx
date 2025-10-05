import { useState } from "react";
import { useOfflineRequest } from "@negretenico/react";

interface RequestLog {
  id: string;
  timestamp: number;
  url: string;
  method: string;
  status: "success" | "error" | "pending";
  message: string;
}

export default function RequestDemo() {
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [customUrl, setCustomUrl] = useState(
    "https://jsonplaceholder.typicode.com/posts/1"
  );

  const addLog = (log: Omit<RequestLog, "id" | "timestamp">) => {
    setLogs((prev) =>
      [
        {
          id: `${Date.now()}-${Math.random()}`,
          timestamp: Date.now(),
          ...log,
        },
        ...prev,
      ].slice(0, 20)
    ); // Keep last 20 logs
  };

  // GET Request
  const getRequest = useOfflineRequest<string, { url: string; method: string }>(
    {
      requestFn: async ({ url, method }) => {
        const response = await fetch(url, { method });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.text();
      },
      onRequest: ({ url, method }) => {
        addLog({
          url,
          method,
          status: "pending",
          message: "Sending request...",
        });
      },
      onSuccess: (data, { url, method }) => {
        addLog({
          url,
          method,
          status: "success",
          message: `Success! Received ${data.length} bytes`,
        });
      },
      onError: (error, { url, method }) => {
        addLog({
          url,
          method,
          status: "error",
          message: `Failed: ${error.message}`,
        });
      },
      captureOnFailure: true,
    }
  );

  // POST Request
  const postRequest = useOfflineRequest<
    string,
    { url: string; method: string; body: any }
  >({
    requestFn: async ({ url, method, body }) => {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return await response.text();
    },
    onRequest: ({ url, method }) => {
      addLog({ url, method, status: "pending", message: "Sending request..." });
    },
    onSuccess: (data, { url, method }) => {
      addLog({
        url,
        method,
        status: "success",
        message: `Success! Received ${data.length} bytes`,
      });
    },
    onError: (error, { url, method }) => {
      addLog({
        url,
        method,
        status: "error",
        message: `Failed: ${error.message}. Will retry when online.`,
      });
    },
    captureOnFailure: true,
  });

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            Offline Request Demo
          </h1>
          <p className="mt-2 text-gray-600">
            Make HTTP requests that automatically retry when you're back online.
            Try going offline (DevTools → Network → Offline) and making
            requests!
          </p>
        </div>

        {/* Request Controls */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              URL to Request
            </label>
            <input
              type="text"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="https://example.com"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() =>
                getRequest.execute({ url: customUrl, method: "GET" })
              }
              disabled={getRequest.isPending}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {getRequest.isPending ? "Sending..." : "GET Request"}
            </button>

            <button
              onClick={() =>
                postRequest.execute({
                  url: customUrl,
                  method: "POST",
                  body: {
                    message: "Hello from offline demo!",
                    timestamp: Date.now(),
                  },
                })
              }
              disabled={postRequest.isPending}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {postRequest.isPending ? "Sending..." : "POST Request"}
            </button>

            <button
              onClick={() =>
                getRequest.execute({
                  url: "https://httpstat.us/500",
                  method: "GET",
                })
              }
              disabled={getRequest.isPending}
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Trigger 500 Error
            </button>

            <button
              onClick={() => setLogs([])}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
            >
              Clear Logs
            </button>
          </div>
        </div>

        {/* Request Logs */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Request Log</h2>
          </div>
          <div className="divide-y divide-gray-200">
            {logs.length === 0 ? (
              <div className="px-6 py-8 text-center text-gray-500">
                No requests yet. Make a request to see it logged here.
              </div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="px-6 py-4 hover:bg-gray-50">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <span
                          className={`px-2 py-0.5 text-xs font-medium rounded ${
                            log.method === "GET"
                              ? "bg-blue-100 text-blue-700"
                              : log.method === "POST"
                              ? "bg-green-100 text-green-700"
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {log.method}
                        </span>
                        <span
                          className={`px-2 py-0.5 text-xs font-medium rounded ${
                            log.status === "success"
                              ? "bg-green-100 text-green-700"
                              : log.status === "error"
                              ? "bg-red-100 text-red-700"
                              : "bg-yellow-100 text-yellow-700"
                          }`}
                        >
                          {log.status}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-gray-900 font-mono">
                        {log.url}
                      </div>
                      <div className="mt-1 text-sm text-gray-600">
                        {log.message}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Instructions */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-blue-900 mb-2">
            How to Test Offline Behavior
          </h3>
          <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
            <li>Open DevTools (F12)</li>
            <li>Go to Network tab</li>
            <li>Set throttling to "Offline"</li>
            <li>Click "GET Request" or "POST Request"</li>
            <li>See the request fail and get added to failed queue</li>
            <li>Go back "Online" in DevTools</li>
            <li>Click "Retry All" in the status bar above</li>
            <li>Watch the failed requests get retried automatically</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
