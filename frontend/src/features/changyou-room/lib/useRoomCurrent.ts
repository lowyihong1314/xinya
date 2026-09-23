/**
 * 房间当前状态：HTTP 取一次 + SSE 增量 + 断线时回落轮询。
 *
 * 控制台和播放端**共用这一个 hook** —— 两边显示的必须是同一份数据，
 * 各写各的取数逻辑迟早会出现「控制台说在投第 3 页、大屏还停在第 2 页」。
 *
 * ── ★ 现在轮询不是保险，是唯一能用的通道 ──────────────────────────────
 * 后端还没有 `core.realtime.register(RealtimeApp("changyou_room", ...))`，
 * GET /changyou_room/realtime 一律 404（已实测）。EventSource 收到 404 会
 * **永久放弃且不报错**，好在 shared/realtime 的助手接管了重连并把失败次数
 * 暴露出来 —— 这里据此把 refetchInterval 打开。
 * 等后端补上注册，status 会变成 "open"，轮询自动停掉，不用改这里。
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { useApiQuery } from "@/shared/api/useApiQuery";
import { useRealtime } from "@/shared/realtime";
import {
  CHANGYOU_REALTIME_APP,
  ROOM_NOTIFICATION_EVENT,
  ROOM_UPDATE_EVENT,
  changyouKeys,
  fetchRoomCurrent,
} from "../api";
import type { RoomCurrent, RoomNotification } from "../types";

/** 没有实时通道时的轮询间隔。演出现场翻页的节奏大概是十几秒一次，3 秒够跟。 */
const POLL_MS = 3000;

export function useRoomCurrent(roomId: string) {
  const qc = useQueryClient();
  // 通知是**纯广播、不落 Redis** 的，只能从 SSE 拿 —— 所以它必须是组件状态，
  // 不能塞进 query 缓存（下一次 refetch 会把它冲掉）。
  const [notification, setNotification] = useState<RoomNotification | null>(null);

  const realtimeStatus = useRealtime(
    roomId ? CHANGYOU_REALTIME_APP : null,
    roomId ? [roomId] : [],
    {
      // 服务端推的 data 就是 build_room_current_payload 的结果，和 /current 同一个
      // 函数拼的 —— 所以可以直接写进缓存，不用再回源一次。
      [ROOM_UPDATE_EVENT]: (msg) => {
        qc.setQueryData(changyouKeys.current(roomId), msg.data as RoomCurrent);
      },
      [ROOM_NOTIFICATION_EVENT]: (msg) => {
        const payload = msg.data as { notification?: RoomNotification } | null;
        if (!payload?.notification?.content) return;
        setNotification(payload.notification);
      },
    },
  );

  const query = useApiQuery(
    changyouKeys.current(roomId),
    () => fetchRoomCurrent(roomId),
    {
      enabled: Boolean(roomId),
      // 实时通道活着就不轮询；否则每 POLL_MS 拉一次。
      refetchInterval: realtimeStatus === "open" ? false : POLL_MS,
    },
  );

  const dismissNotification = useCallback(() => setNotification(null), []);

  return { query, realtimeStatus, notification, dismissNotification };
}
