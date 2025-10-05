import { WALClient } from "@negretenico/lib";
import { PropsWithChildren, createContext, useContext, useMemo } from "react";

type OfflineContextValue = {
  captureFailedOperation: (operation: string) => Promise<void>;
  retryFailedOperations: (
    count: number,
    retryFn: (op: string) => Promise<void>
  ) => Promise<void>;
  getFailedOperations: (count: number) => Promise<string[]>;
};

const Context = createContext<OfflineContextValue | null>(null);

export function OfflineProvider({
  children,
  offlineClient,
}: Readonly<PropsWithChildren> & { offlineClient: WALClient }) {
  const contextValue = useMemo<OfflineContextValue>(
    () => ({
      captureFailedOperation: async (operation: string) => {
        console.info(
          `OfflineProvider:captureFailedOperation: Adding opertion ${operation}`
        );
        await offlineClient.append(operation);
      },

      retryFailedOperations: async (
        count: number,
        retryFn: (op: string) => Promise<void>
      ) => {
        console.info(
          `OfflineProvider:retryFailedOperations: Retrying the ${count} operations`
        );
        await offlineClient.replay(count, retryFn);
      },

      getFailedOperations: async (count: number) => {
        console.info(
          `OfflineProvider:getFailedOperations: Gettting the ${count} failed operations`
        );
        return await offlineClient.inspect(count);
      },
    }),
    [offlineClient]
  );

  return <Context.Provider value={contextValue}>{children}</Context.Provider>;
}

export function useOffline() {
  const context = useContext(Context);
  if (!context) {
    throw new Error("useOffline must be used within an OfflineProvider");
  }
  return context;
}
