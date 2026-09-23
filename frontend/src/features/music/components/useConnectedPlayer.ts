/**
 * 把播放器和「播放设备」接起来。
 *
 * 规则：**同一时刻只有一台设备能出声**，由后端裁决（active_connection_id），
 * 前端服从。这里做三件事：
 *   ① 失去播放权 → 立刻停下来
 *   ② 本机点播放 → 先把播放权抢过来，再放
 *   ③ 在放东西时把状态上报，让别的设备显示「正在 xx 上播放」
 */
import { useCallback, useEffect, useRef } from "react";

import { usePlaybackDevices } from "./usePlaybackDevices";
import { usePlayer } from "./usePlayer";
import type { Music } from "../types";

export function useConnectedPlayer() {
  const player = usePlayer();
  const devices = usePlaybackDevices();
  const { isActive, claim, reportState } = devices;

  // ① 失去播放权就停。
  //    这是整条规则的落点：别的设备接管后，服务端广播新的 active，
  //    本机收到后在这里自己停下来。**不靠服务端发"停止"指令** ——
  //    那样会多一条只有一个用途的事件，而且漏发就停不下来。
  const wasActive = useRef(isActive);
  useEffect(() => {
    if (wasActive.current && !isActive) player.pause();
    wasActive.current = isActive;
  }, [isActive, player]);

  // ③ 状态上报。只在**变化时**发，不跟着 position 每秒发 ——
  //    那会变成每秒一个 POST，纯浪费。别的设备只需要知道「在放什么、是否在放」。
  const lastReport = useRef("");
  useEffect(() => {
    if (!isActive || !player.current) return;
    const key = `${player.current.id}|${player.playing}|${player.accompanimentMode}`;
    if (key === lastReport.current) return;
    lastReport.current = key;
    reportState({
      music_id: player.current.id,
      title: player.current.title,
      playing: player.playing,
      position: Math.floor(player.position),
      accompaniment: player.accompanimentMode,
    });
  }, [isActive, player.current, player.playing, player.accompanimentMode, player.position, reportState]);

  // ② 本机点播放 → 先抢播放权。
  //    抢不到（网络失败）也照放：本地能出声比"什么都不发生"好，
  //    服务端的广播回来后如果发现自己不是 active，上面那条 effect 会把它停掉。
  const play = useCallback(
    (music: Music) => {
      if (!isActive) void claim().catch(() => {});
      player.play(music);
    },
    [isActive, claim, player],
  );

  return { ...player, play, devices };
}
