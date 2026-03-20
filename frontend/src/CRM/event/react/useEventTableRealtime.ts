import { useEffect } from "react";

export function useEventTableRealtime({
  enabled = false,
  onRefresh,
}: {
  enabled?: boolean;
  onRefresh: () => void;
}) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const channel = "crm:event-table";
    console.debug("[event-table-realtime] reserved channel", channel);

    return () => {
      console.debug("[event-table-realtime] unsubscribe", channel);
    };
  }, [enabled, onRefresh]);
}
