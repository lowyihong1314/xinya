import { useEffect } from "react";

type RealtimeOptions = {
  enabled?: boolean;
  formId?: number | null;
  onRefresh: () => void;
};

export function useFormRealtime({ enabled = false, formId, onRefresh }: RealtimeOptions) {
  useEffect(() => {
    if (!enabled || !formId) {
      return;
    }

    const channel = `form:${formId}`;

    // Socket integration is intentionally deferred.
    // This hook is the single place where future socket subscription should be attached.
    console.debug("[form-realtime] reserved channel", channel);

    return () => {
      console.debug("[form-realtime] unsubscribe", channel);
    };
  }, [enabled, formId, onRefresh]);
}
