import { useEffect, useRef } from "react";

type PendingAutosave<TId, TPatch> = {
  entityId: TId;
  patch: TPatch;
} | null;

export function useDebouncedAutosave<TId, TPatch>({
  debounceMs,
  mergePatch,
  persist,
  onError,
}: {
  debounceMs: number;
  mergePatch: (current: TPatch, next: TPatch) => TPatch;
  persist: (entityId: TId, patch: TPatch) => Promise<void>;
  onError?: (error: unknown) => void;
}) {
  const pendingRef = useRef<PendingAutosave<TId, TPatch>>(null);
  const timerRef = useRef<number | null>(null);
  const mergePatchRef = useRef(mergePatch);
  const persistRef = useRef(persist);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    mergePatchRef.current = mergePatch;
    persistRef.current = persist;
    onErrorRef.current = onError;
  }, [mergePatch, persist, onError]);

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function clearPending(entityId?: TId) {
    if (!pendingRef.current) {
      clearTimer();
      return;
    }
    if (entityId === undefined || Object.is(pendingRef.current.entityId, entityId)) {
      pendingRef.current = null;
      clearTimer();
    }
  }

  async function flush() {
    const pending = pendingRef.current;
    if (!pending) {
      return;
    }

    pendingRef.current = null;
    clearTimer();

    try {
      await persistRef.current(pending.entityId, pending.patch);
    } catch (error) {
      onErrorRef.current?.(error);
    }
  }

  function schedule(entityId: TId, patch: TPatch) {
    pendingRef.current =
      pendingRef.current && Object.is(pendingRef.current.entityId, entityId)
        ? {
            entityId,
            patch: mergePatchRef.current(pendingRef.current.patch, patch),
          }
        : { entityId, patch };

    clearTimer();
    timerRef.current = window.setTimeout(() => {
      void flush();
    }, debounceMs);
  }

  function hasPending(entityId?: TId) {
    if (!pendingRef.current) {
      return false;
    }
    if (entityId === undefined) {
      return true;
    }
    return Object.is(pendingRef.current.entityId, entityId);
  }

  useEffect(
    () => () => {
      clearTimer();
    },
    [],
  );

  return {
    schedule,
    flush,
    clearPending,
    hasPending,
  };
}
