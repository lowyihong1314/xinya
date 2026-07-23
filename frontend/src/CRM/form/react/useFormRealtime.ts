import { useEffect } from "react";
import { io, type Socket } from "socket.io-client";

import { API_BASE } from "../../../js/apiBase";

type RealtimeOptions = {
  enabled?: boolean;
  formId?: number | null;
  onRefresh: () => void;
};

// 报名成员页实时刷新：后端 register/parental/fee/field 变更都会向房间
// `wait_register_{form_id}` 广播 socket 事件 `new_register`，收到即重新拉取详情。
export function useFormRealtime({ enabled = false, formId, onRefresh }: RealtimeOptions) {
  useEffect(() => {
    if (!enabled || !formId) {
      return;
    }

    const origin = API_BASE || (typeof window !== "undefined" ? window.location.origin : "");
    const room = `wait_register_${formId}`;
    const socket: Socket = io(origin, {
      withCredentials: true,
      transports: ["websocket", "polling"],
    });

    const join = () => socket.emit("join_room", { room });
    socket.on("connect", join);
    if (socket.connected) join();

    const handler = (payload: { form_id?: number; event?: string }) => {
      // 房间已经按 form_id 隔离；仍校验一次以防串号。
      if (payload?.form_id != null && Number(payload.form_id) !== Number(formId)) {
        return;
      }
      onRefresh();
    };
    socket.on("new_register", handler);

    return () => {
      socket.off("connect", join);
      socket.off("new_register", handler);
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, formId]);
}
