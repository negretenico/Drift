import { useState, useCallback } from "react";
import { useOffline } from "../OfflineProvider/OfflineProvider";

type RequestOptions<DataReturned, VariablesUsedToQueryForData> = {
  requestFn: (variables: VariablesUsedToQueryForData) => Promise<DataReturned>;
  onRequest?: (variables: VariablesUsedToQueryForData) => void | Promise<void>;
  onSuccess?: (
    data: DataReturned,
    variables: VariablesUsedToQueryForData
  ) => void | Promise<void>;
  onError?: (
    error: Error,
    variables: VariablesUsedToQueryForData
  ) => void | Promise<void>;
  captureOnFailure?: boolean; // Default: true
  shouldCapture?: (error: Error) => boolean; // Custom logic to determine if error should be captured
};

type RequestState<DataReturned> = {
  data: DataReturned | undefined;
  error: Error | null;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
};

/**
 * Default logic to determine if an error should be captured for retry
 * Only captures network errors and server errors (5xx), not client errors (4xx)
 * Default to catch to much, rather than not catching enough, why we return true
 */
function defaultShouldCapture(error: Error): boolean {
  // Network errors (no response)
  if (
    error.message.includes("network") ||
    error.message.includes("timeout") ||
    error.message.includes("ECONNREFUSED")
  ) {
    return true;
  }

  const errorObj = error as any;

  if (errorObj.response?.status) {
    const status = errorObj.response.status;
    return status >= 500 || status === 429;
  }

  if (errorObj.status) {
    const status = errorObj.status;
    return status >= 500 || status === 429;
  }
  return true;
}

export function useOfflineRequest<
  DataReturned = unknown,
  VariablesUsedToQueryForData = unknown
>({
  requestFn,
  onRequest,
  onSuccess,
  onError,
  captureOnFailure = true,
  shouldCapture = defaultShouldCapture,
}: RequestOptions<DataReturned, VariablesUsedToQueryForData>) {
  const { captureFailedOperation } = useOffline();

  const [state, setState] = useState<RequestState<DataReturned>>({
    data: undefined,
    error: null,
    isPending: false,
    isSuccess: false,
    isError: false,
  });

  const execute = useCallback(
    async (variables: VariablesUsedToQueryForData) => {
      setState({
        data: undefined,
        error: null,
        isPending: true,
        isSuccess: false,
        isError: false,
      });

      try {
        await onRequest?.(variables);
        console.info(
          `useOfflineRequest:execute:About to perform request ${JSON.stringify(
            requestFn
          )}`
        );
        const data = await requestFn(variables);

        setState({
          data,
          error: null,
          isPending: false,
          isSuccess: true,
          isError: false,
        });
        console.log(
          `useOfflineRequest:execute:Successfully performed request ${JSON.stringify(
            requestFn
          )}`
        );
        await onSuccess?.(data, variables);

        return data;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        setState({
          data: undefined,
          error: err,
          isPending: false,
          isSuccess: false,
          isError: true,
        });

        if (captureOnFailure && shouldCapture(err)) {
          const serialized = JSON.stringify({
            timestamp: Date.now(),
            variables,
            error: err.message,
            type: "request",
          });
          console.warn(
            `useOfflineRequest:execute:Appending failed request ${serialized}`
          );
          await captureFailedOperation(serialized);
        }
        console.error(`useOfflineRequest:execute:Failed to perform request`);
        await onError?.(err, variables);

        throw err;
      }
    },
    [
      requestFn,
      onRequest,
      onSuccess,
      onError,
      captureFailedOperation,
      captureOnFailure,
      shouldCapture,
    ]
  );

  const reset = useCallback(() => {
    setState({
      data: undefined,
      error: null,
      isPending: false,
      isSuccess: false,
      isError: false,
    });
  }, []);

  return {
    execute,
    reset,
    ...state,
  };
}
