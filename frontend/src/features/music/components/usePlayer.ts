/**
 * 音频播放器状态（含伴奏切换、队列播放）。
 *
 * 用**一个**全局 <audio> 元素而不是每首歌一个：
 *   · 多个 audio 同时存在时 iOS 只允许其中一个播放，切歌会随机失效；
 *   · 浏览器对同域名的媒体连接数有限制，几十个 audio 会把连接占满。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { musicStreamUrl, reportOneMinute } from "../api";
import type { Music } from "../types";

export interface PlayerState {
  /** 当前曲目（**原曲**，即使正在放伴奏也是它）。 */
  current: Music | null;
  playing: boolean;
  /** 秒。duration 为 0 表示还不知道（元数据没加载完，或后端没给）。 */
  position: number;
  duration: number;
  /** 是否正在放伴奏。只有 current.accompaniment_id 非空时才可能为 true。 */
  accompanimentMode: boolean;
}

export function usePlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<PlayerState>({
    current: null,
    playing: false,
    position: 0,
    duration: 0,
    accompanimentMode: false,
  });

  // 本首歌已累计播放的秒数（跨暂停累计，拖进度条不计）。满 60 就上报并归零。
  const playedRef = useRef(0);
  const lastTickRef = useRef(0);
  // 上报用的是**原曲 id**：放伴奏也算听了这首歌，统计不该分成两条。
  const reportIdRef = useRef<number | null>(null);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    audioRef.current = audio;

    const onTime = () => {
      const now = audio.currentTime;
      const delta = now - lastTickRef.current;
      // 只累计**正向且小步**的推进。拖进度条会产生大跳（或负数），不该计入。
      if (delta > 0 && delta < 2) {
        playedRef.current += delta;
        if (playedRef.current >= 60) {
          playedRef.current -= 60;
          const id = reportIdRef.current;
          // 上报失败不影响播放，静默吞掉 —— 这是统计，不是业务。
          if (id != null) void reportOneMinute(id).catch(() => {});
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

  /** 载入某个音频文件并播放。resumeAt 用于伴奏切换时保住进度。 */
  const load = useCallback((fileId: number, resumeAt = 0) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.src = musicStreamUrl(fileId);
    lastTickRef.current = resumeAt;
    if (resumeAt > 0) {
      // 元数据到位之前设 currentTime 会被忽略，所以等 loadedmetadata 再设。
      const seek = () => {
        audio.currentTime = resumeAt;
        audio.removeEventListener("loadedmetadata", seek);
      };
      audio.addEventListener("loadedmetadata", seek);
    }
    void audio.play().catch(() => {});
  }, []);

  const play = useCallback(
    (music: Music) => {
      const audio = audioRef.current;
      if (!audio) return;
      // 同一首：切播放/暂停，不重新加载（重载会从头开始，用户以为点错了）。
      if (state.current?.id === music.id) {
        if (audio.paused) void audio.play().catch(() => {});
        else audio.pause();
        return;
      }
      playedRef.current = 0;
      reportIdRef.current = music.id;
      setState({
        current: music,
        playing: false,
        position: 0,
        duration: music.duration ?? 0,
        accompanimentMode: false, // 换歌一律回到原曲
      });
      load(music.id, 0);
    },
    [state.current?.id, load],
  );

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

  /**
   * 切换伴奏 / 原曲。
   *
   * **保住播放进度**：伴奏和原曲是同一首歌的两个录音，长度基本一致，
   * 从头开始会让人失去「刚唱到哪」的位置感。切不过去（没有伴奏）时什么都不做。
   */
  const toggleAccompaniment = useCallback(() => {
    const audio = audioRef.current;
    const music = state.current;
    if (!audio || !music) return;
    const accId = music.accompaniment_id;
    if (accId == null) return;

    const at = audio.currentTime;
    const next = !state.accompanimentMode;
    setState((s) => ({ ...s, accompanimentMode: next }));
    load(next ? accId : music.id, at);
  }, [state.current, state.accompanimentMode, load]);

  return { ...state, play, toggle, seek, toggleAccompaniment };
}
