/**
 * 播放设备与播放权（Spotify Connect 那一套）。
 *
 * 一个用户可能同时开着电脑浏览器、手机浏览器、APK。
 * **同一时刻只有一个在放** —— 这条规则由后端裁决，前端服从。
 *
 * 数据流：
 *   SSE 连上（?device=名字&kind=web）
 *     → 服务端 on_connect 登记设备、第一台自动拿到播放权
 *     → snapshot 首帧带回设备表与 active_connection_id
 *     → 之后 music:devices / music:now_playing 两个事件增量更新
 *
 * ★ 重连即自愈：断线重连后 connection_id 会变，snapshot 会带回新的 active，
 *   所以不能把 connectionId 缓存在别处自己推断。
 */
import { useCallback, useRef, useState } from "react";

import { http } from "@/shared/api/client";
import { useAuth } from "@/shared/auth/AuthProvider";
import { useRealtime } from "@/shared/realtime";
import { currentDeviceKind, currentDeviceName } from "./deviceName";

export interface PlaybackDevice {
  connection_id: string;
  name: string;
  kind: string;
  since_ms: number | null;
  is_active: boolean;
}

export interface NowPlaying {
  music_id: number | null;
  title: string | null;
  playing: boolean;
  position: number | null;
  accompaniment: boolean;
  connection_id: string;
  at_ms: number;
}

interface DevicesFrame {
  devices: PlaybackDevice[];
  active_connection_id: string | null;
  now_playing?: NowPlaying | null;
}

export function usePlaybackDevices() {
  const { user } = useAuth();
  const [devices, setDevices] = useState<PlaybackDevice[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const [myConnectionId, setMyConnectionId] = useState<string | null>(null);

  const room = user ? String(user.id) : null;
  // 设备名算一次就固定：放进 useRealtime 的 params，params 变化会导致重连。
  const paramsRef = useRef({ device: currentDeviceName(), kind: currentDeviceKind() });

  const status = useRealtime(
    room ? "music" : null,
    room ? [room] : [],
    {
      "music:devices": (msg) => {
        const d = msg.data as DevicesFrame;
        setDevices(d.devices ?? []);
        setActiveId(d.active_connection_id ?? null);
      },
      "music:now_playing": (msg) => setNowPlaying(msg.data as NowPlaying),
      // snapshot 是首帧，也是重连后的自愈帧
      snapshot: (msg) => {
        const d = msg.data as DevicesFrame;
        setDevices(d.devices ?? []);
        setActiveId(d.active_connection_id ?? null);
        setNowPlaying(d.now_playing ?? null);
      },
    },
    {
      params: paramsRef.current,
      // ★ echo 要开：设备表的广播是**不带 sender** 的（服务端有意为之），
      //   因为发起接管的那台也必须知道自己已经没有播放权了。
      echo: true,
      onReady: (info) => setMyConnectionId(info.connectionId),
    },
  );

  /** 我是不是当前唯一能出声的那台。 */
  const isActive = myConnectionId != null && myConnectionId === activeId;

  /** 把播放权拿到某台设备上（不传就是拿到自己这台）。 */
  const claim = useCallback(
    async (connectionId?: string) => {
      const target = connectionId ?? myConnectionId;
      if (!target) return;
      await http.post("/music/playback/claim", { connection_id: target });
      // 不在这里 setActiveId —— 等服务端的 music:devices 广播回来。
      // 本地抢跑的话，服务端要是拒了（设备已离线）界面就和真相不一致了。
    },
    [myConnectionId],
  );

  /** 上报在放什么，让别的设备显示「正在 xx 上播放」。只有持权设备说得算。 */
  const reportState = useCallback(
    (state: { music_id: number | null; title?: string | null; playing: boolean; position?: number; accompaniment?: boolean }) => {
      if (!myConnectionId || !isActive) return;
      void http
        .post("/music/playback/state", { ...state, connection_id: myConnectionId })
        .catch(() => {
          /* 状态上报是锦上添花，失败不该打断播放 */
        });
    },
    [myConnectionId, isActive],
  );

  return {
    devices,
    activeId,
    myConnectionId,
    isActive,
    nowPlaying,
    /** SSE 连接状态，用来画「已连接」指示灯 */
    status,
    claim,
    reportState,
  };
}
