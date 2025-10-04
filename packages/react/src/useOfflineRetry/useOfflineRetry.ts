import { useCallback, useState } from "react";
import { useOffline } from "../OfflineProvider/OfflineProvider";

type RetryOptions = {
  onRetry: (serializedRequest: string) => Promise<void>;
  onRetrySuccess?: (serializedRequest: string) => void | Promise<void>;
  onRetryError?: (
    error: Error,
    serializedRequest: string
  ) => void | Promise<void>;
};

export function useOfflineRetry({
  onRetry,
  onRetrySuccess,
  onRetryError,
}: RetryOptions) {
  const { retryFailedOperations, getFailedOperations } = useOffline();
  const [failedCount, setFailedCount] = useState<number>(0);

  const updateFailedCount = useCallback(async () => {
    const failedOperations = await getFailedOperations(Number.MAX_SAFE_INTEGER);
    console.debug(
      `useOfflineRetry:updateFailedCount: Updating the failed count to ${failedOperations.length}`
    );
    setFailedCount(failedOperations.length);
    return failedOperations.length;
  }, [getFailedOperations]);

  const retryFn = useCallback(
    async (serialized: string) => {
      try {
        console.info(
          `useOfflineRetry:retryFn:Attempting to retry ${serialized}`
        );
        await onRetry(serialized);
        console.debug(
          `useOfflineRetry:retryFn:Succesfully retried ${serialized}`
        );
        await onRetrySuccess?.(serialized);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error(`useOfflienRetry:retryfn:Failed to retry ${serialized}`);
        await onRetryError?.(error, serialized);
      }
    },
    [onRetry, onRetrySuccess, onRetryError]
  );

  const retryAll = useCallback(async () => {
    console.info(`useOfflineRetry:retryAll: Retrying the all failed operation`);
    await retryFailedOperations(Number.MAX_SAFE_INTEGER, retryFn);
    await updateFailedCount();
  }, [retryFailedOperations, retryFn, updateFailedCount]);

  const retryLast = useCallback(async () => {
    console.info(`useOfflineRetry:retryLast: Retrying the last operation`);
    await retryFailedOperations(1, retryFn);
    await updateFailedCount();
  }, [retryFailedOperations, retryFn, updateFailedCount]);

  const getFailedCount = useCallback(async () => {
    return await updateFailedCount();
  }, [updateFailedCount]);

  return { retryAll, retryLast, getFailedCount, failedCount };
}
