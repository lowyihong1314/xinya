/**
 * 音频播放器状态。
 *
 * 用**一个**全局 <audio> 元素而不是每首歌一个：
 *   · 多个 audio 同时存在时，iOS 只允许其中一个播放，切歌会随机失效；
 *   · 浏览器对同域名的媒体连接数有限制，几十个 audio 会把连接占满。
 *
 * 播放时长上报：每满 60 秒调一次 /music/add_one_minute。用**累计播放时间**而不是
 * setInterval 的次数 —— 暂停、切后台、拖进度条都不该算进去。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { musicStreamUrl, reportOneMinute } from "../api";
import type { Music } from "../types";

export interface PlayerState {
  current: Music | null;
  playing: boolean;
  /** 秒。duration 为 0 表示还不知道（元数据没加载完，或后端没给）。 */
  position: number;
  duration: number;
}

export function usePlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<PlayerState>({
    current: null,
    playing: false,
    position: 0,
    duration: 0,
  });

  // 本首歌已累计播放的秒数（跨暂停累计，拖进度条不计）。满 60 就上报并归零。
  const playedRef = useRef(0);
  const lastTickRef = useRef(0);

  // 懒建 audio 元素：构造函数在 SSR / 测试环境里没有，放 effect 里安全。
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    audioRef.current = audio;

    const onTime = () => {
      const now = audio.currentTime;
      const delta = now - lastTickRef.current;
      // 只累计**正向且小步**的推进。拖进度条会产生大跳（或负数），不该计入播放时长。
      if (delta > 0 && delta < 2) {
        playedRef.current += delta;
        if (playedRef.current >= 60) {
          playedRef.current -= 60;
          const id = Number(audio.dataset.musicId);
          // 上报失败不影响播放，静默吞掉 —— 这是统计，不是业务。
          if (Number.isFinite(id)) void reportOneMinute(id).catch(() => {});
        }
      }
      lastTickRef.current = now;
      setState((s) => ({ ...s, position: now }));
    };
    const onMeta = () => setState((s) => ({ ...s, duration: audio.duration || 0 }));
    const onPlay = () => setState((s) => ({ ...s, playing: true }));
    const onPause = () => setState((s) => ({ ...s, playing: false }));
    const onEnded = () => setState((s) => ({ ...s, playing: false, position: 0 }));

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audioRef.current = null;
    };
  }, []);

  const play = useCallback((music: Music) => {
    const audio = audioRef.current;
    if (!audio) return;
    // 同一首：切播放/暂停，不重新加载（重载会从头开始，用户以为点错了）。
    if (audio.dataset.musicId === String(music.id)) {
      if (audio.paused) void audio.play().catch(() => {});
      else audio.pause();
      return;
    }
    audio.dataset.musicId = String(music.id);
    audio.src = musicStreamUrl(music.id);
    playedRef.current = 0;
    lastTickRef.current = 0;
    setState({ current: music, playing: false, position: 0, duration: music.duration ?? 0 });
    void audio.play().catch(() => {});
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audio.src) return;
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
  }, []);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    lastTickRef.current = seconds; // 防止这一跳被当成播放时长
  }, []);

  return { ...state, play, toggle, seek };
}
