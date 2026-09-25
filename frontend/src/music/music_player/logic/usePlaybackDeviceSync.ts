import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

import { API_BASE } from "../../../js/apiBase";
import {
  fetchPlaybackChannel,
  releasePlayback,
  sendPlaybackCommand,
  sendPlaybackHeartbeat,
  transferPlayback,
} from "./api";
import type { PlaybackCommandAction, PlaybackCommandMessage, PlaybackDeviceState } from "./types";

const PRESENCE_MS = 15_000; // 没在播也定时报到，好让别的设备在选择器里看到自己
const ACTIVE_MS = 5_000; // 出声的设备播放中的上报频率

export type PlaybackDeviceSyncOptions = {
  enabled: boolean;
  deviceId: string | null;
  deviceName: string;
  kind: "web" | "android";
  isPlaying: boolean;
  currentMusicId: number | null;
  getPositionMs: () => number;
  getDurationMs: () => number;
  /** 别的设备成了出声设备：本机应暂停，转为遥控器。 */
  onRemoteTakeover: (state: PlaybackDeviceState) => void;
  /** 用户在别处选中了本机：本机接着 state 里的歌和进度播。 */
  onTransferredToMe: (state: PlaybackDeviceState) => void;
  /** 遥控指令送到本机（本机是出声设备）。 */
  onCommand: (action: PlaybackCommandAction, payload: Record<string, unknown>) => void;
  /** APK 用：抢占由原生服务完成，JS 不主动 claim。 */
  passive?: boolean;
};

export type RemotePlaybackView = {
  deviceId: string;
  deviceName: string;
  musicId: number | null;
  isPlaying: boolean;
  durationMs: number;
  /** 按最后一次收到状态的时间外推的当前进度。 */
  getPositionMs: () => number;
};

/**
 * Spotify Connect 式设备同步：
 * - 所有设备定时报到（在线列表）；出声的设备播放中每 5 秒上报进度。
 * - 本机开始播放 -> claim 成为出声设备；别的设备收到 transferred 后暂停并变成遥控器。
 * - 遥控器的按钮 -> HTTP command -> 服务端广播 -> 目标设备执行。
 */
export function usePlaybackDeviceSync(options: PlaybackDeviceSyncOptions) {
  const { enabled, deviceId, isPlaying, currentMusicId } = options;
  const [state, setState] = useState<PlaybackDeviceState | null>(null);
  const [connected, setConnected] = useState(false);
  const receivedAtRef = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const claimedRef = useRef(false);
  const lastImmediateRef = useRef(0);

  const isActiveDevice = useMemo(() => {
    if (!state || !state.active_device_id || state.stale) return true;
    return state.active_device_id === deviceId;
  }, [state, deviceId]);

  const applyState = useCallback((next: PlaybackDeviceState, event: "state" | "transferred") => {
    receivedAtRef.current = performance.now();
    setState(next);
    const current = optionsRef.current;
    const mine = next.active_device_id === current.deviceId;
    if (mine) {
      if (event === "transferred" && !claimedRef.current) {
        // 别处选中了本机
        claimedRef.current = true;
        current.onTransferredToMe(next);
      }
      return;
    }
    if (next.active_device_id && !next.stale) {
      const wasClaimed = claimedRef.current;
      claimedRef.current = false;
      if (event === "transferred" || wasClaimed || current.isPlaying) {
        current.onRemoteTakeover(next);
      }
    }
  }, []);

  // socket 订阅
  useEffect(() => {
    if (!enabled || !deviceId) {
      setState(null);
      return;
    }
    let cancelled = false;
    let socket: Socket | null = null;
    let channelKey: string | null = null;
    const subscribe = () => {
      if (socket && channelKey) socket.emit("playback:subscribe", { channel_key: channelKey });
    };

    void fetchPlaybackChannel(deviceId)
      .then((payload) => {
        if (cancelled) return;
        channelKey = payload.channel_key;
        if (payload.state) applyState(payload.state, "state");
        const origin = API_BASE || (typeof window !== "undefined" ? window.location.origin : "");
        socket = io(origin, { withCredentials: !API_BASE, transports: ["websocket", "polling"] });
        socket.on("connect", () => {
          setConnected(true);
          subscribe();
        });
        socket.on("disconnect", () => setConnected(false));
        socket.on("playback:state", (next: PlaybackDeviceState) => applyState(next, "state"));
        socket.on("playback:transferred", (next: PlaybackDeviceState) => applyState(next, "transferred"));
        socket.on("playback:command", (message: PlaybackCommandMessage) => {
          const current = optionsRef.current;
          if (!message || message.target_device_id !== current.deviceId) return;
          current.onCommand(message.action, message.payload || {});
        });
        if (socket.connected) subscribe();
      })
      .catch((error) => {
        console.warn("playback channel unavailable", error);
      });

    return () => {
      cancelled = true;
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
      }
      setConnected(false);
    };
  }, [enabled, deviceId, applyState]);

  const heartbeat = useCallback(
    async (claim: boolean) => {
      const current = optionsRef.current;
      if (!current.enabled || !current.deviceId) return null;
      try {
        const next = await sendPlaybackHeartbeat({
          device_id: current.deviceId,
          device_name: current.deviceName,
          kind: current.kind,
          music_id: current.currentMusicId,
          position_ms: Math.max(0, Math.round(current.getPositionMs() || 0)),
          duration_ms: Math.max(0, Math.round(current.getDurationMs() || 0)),
          is_playing: current.isPlaying,
          claim,
        });
        if (next.is_active) claimedRef.current = true;
        applyState(next, "state");
        return next;
      } catch (error) {
        console.warn("playback heartbeat failed", error);
        return null;
      }
    },
    [applyState],
  );

  const claim = useCallback(() => heartbeat(true), [heartbeat]);

  // 定时上报：在线登记 15 秒一次；本机出声且播放中 5 秒一次。
  useEffect(() => {
    if (!enabled || !deviceId) return;
    const active = claimedRef.current && isPlaying;
    const timer = window.setInterval(() => {
      void heartbeat(false);
    }, active ? ACTIVE_MS : PRESENCE_MS);
    return () => window.clearInterval(timer);
  }, [enabled, deviceId, isPlaying, heartbeat, state?.active_device_id]);

  // 开始播放：抢占（passive 模式交给原生）；播放/暂停/切歌变化立刻上报一次，让遥控器马上刷新。
  useEffect(() => {
    if (!enabled || !deviceId) return;
    if (isPlaying && !claimedRef.current && !options.passive) {
      void heartbeat(true);
      return;
    }
    if (!claimedRef.current) return;
    const now = performance.now();
    if (now - lastImmediateRef.current < 400) return;
    lastImmediateRef.current = now;
    void heartbeat(false);
  }, [enabled, deviceId, isPlaying, currentMusicId, heartbeat, options.passive]);

  /** 本机拖了进度：立刻同步给遥控器。 */
  const reportSeek = useCallback(() => {
    if (!claimedRef.current) return;
    void heartbeat(false);
  }, [heartbeat]);

  const release = useCallback(async () => {
    const current = optionsRef.current;
    if (!current.enabled || !current.deviceId) return;
    claimedRef.current = false;
    try {
      const next = await releasePlayback(current.deviceId);
      applyState(next, "state");
    } catch {
      // ignore
    }
  }, [applyState]);

  const transferTo = useCallback(
    async (targetDeviceId: string) => {
      const current = optionsRef.current;
      if (!current.enabled || !current.deviceId) return null;
      try {
        const next = await transferPlayback(targetDeviceId, current.deviceId);
        applyState(next, "transferred");
        return next;
      } catch (error) {
        console.warn("playback transfer failed", error);
        return null;
      }
    },
    [applyState],
  );

  const sendCommand = useCallback(
    async (action: PlaybackCommandAction, payload: Record<string, unknown> = {}) => {
      const current = optionsRef.current;
      if (!current.enabled || !current.deviceId || !state?.active_device_id) return;
      try {
        await sendPlaybackCommand({
          target_device_id: state.active_device_id,
          action,
          payload,
          requested_by: current.deviceId,
        });
      } catch (error) {
        console.warn("playback command failed", error);
      }
    },
    [state?.active_device_id],
  );

  const remote: RemotePlaybackView | null = useMemo(() => {
    if (!state || isActiveDevice || !state.active_device_id) return null;
    return {
      deviceId: state.active_device_id,
      deviceName: state.active_device_name || "其他设备",
      musicId: state.music_id ?? null,
      isPlaying: state.is_playing,
      durationMs: state.duration_ms || 0,
      getPositionMs: () => {
        const base = state.position_ms || 0;
        if (!state.is_playing) return base;
        const elapsed = performance.now() - receivedAtRef.current;
        const duration = state.duration_ms || 0;
        const next = base + elapsed;
        return duration > 0 ? Math.min(next, duration) : next;
      },
    };
  }, [state, isActiveDevice]);

  return {
    state,
    connected,
    devices: state?.devices || [],
    activeDeviceId: state?.active_device_id ?? null,
    isActiveDevice,
    remote,
    remoteDeviceName: remote?.deviceName ?? null,
    claim,
    release,
    heartbeat,
    reportSeek,
    transferTo,
    sendCommand,
  };
}
