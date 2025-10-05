import { useEffect, useState } from "react";
import { OfflineProvider } from "@negretenico/react";
import RequestDemo from "./components/RequestDemo";
import StatusBar from "./components/StatusBar";
import { BrowserDurableWAL, WALClient } from "@negretenico/lib";

function App() {
  const [walClient, setWalClient] = useState<WALClient | null>(null);

  useEffect(() => {
    async function initWAL() {
      try {
        const durableManager = new BrowserDurableWAL({
          walFileName: "react-wal.log",
        });

        setWalClient(new WALClient(durableManager));
      } catch (error) {
        console.error("Failed to initialize WAL:", error);
      }
    }

    initWAL();
  }, []);

  if (!walClient) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Initializing offline support...</p>
        </div>
      </div>
    );
  }

  return (
    <OfflineProvider offlineClient={walClient}>
      <div className="min-h-screen bg-gray-50">
        <StatusBar />
        <RequestDemo />
      </div>
    </OfflineProvider>
  );
}

export default App;
