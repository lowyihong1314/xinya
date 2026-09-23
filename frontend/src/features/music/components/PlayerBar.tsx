import { ListMusic, Mic2, MicOff, Music2, Pause, Play } from "lucide-react";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui";
import { DevicePicker } from "./DevicePicker";
import type { useConnectedPlayer } from "./useConnectedPlayer";

/**
 * 底部播放条。fixed 定位，所以页面要留出底部空间（见各页面的 pb-24）。
 */
export function PlayerBar({
  player,
  queueCount,
  onOpenQueue,
}: {
  player: ReturnType<typeof useConnectedPlayer>;
  queueCount?: number;
  onOpenQueue?: () => void;
}) {
  const { current, playing, position, duration, accompanimentMode, toggle, seek, toggleAccompaniment } =
    player;
  const { devices, activeId, myConnectionId, isActive, nowPlaying, status, claim } = player.devices;

  // 本机没在放、但别的设备在放 —— 显示一条「正在 xx 上播放」，
  // 而不是一个空的播放条。没有这一条的话用户会以为音乐停了。
  const remote =
    !current && nowPlaying?.music_id != null
      ? devices.find((d) => d.connection_id === nowPlaying.connection_id) ?? null
      : null;

  if (!current && !remote) return null;

  const hasAccompaniment = current?.accompaniment_id != null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 py-2.5 sm:gap-3">
        <Music2 className="hidden size-5 shrink-0 text-primary sm:block" aria-hidden />

        {/* 本机没在放：只显示「正在 xx 上播放」+ 设备选择器，不给进度条和播放键
            —— 那些操作在本机做没有意义，先把播放权拿过来才行 */}
        {!current && remote ? (
          <>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{nowPlaying?.title || "正在播放"}</p>
              <p className="truncate text-xs text-muted-foreground">正在「{remote.name}」上播放</p>
            </div>
            <DevicePicker
              devices={devices}
              activeId={activeId}
              myConnectionId={myConnectionId}
              connected={status === "open"}
              onClaim={claim}
            />
          </>
        ) : null}

        {current ? (
        <>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-medium">
            <span className="truncate">{current.title}</span>
            {/* 正在放伴奏时必须有明确标识，否则用户会以为音频坏了（没人声） */}
            {accompanimentMode ? (
              <span className="shrink-0 rounded-full bg-primary-soft px-1.5 py-0.5 text-[10px] font-normal text-primary-strong">
                伴奏
              </span>
            ) : null}
          </p>
          <input
            type="range"
            min={0}
            // duration 可能是 0（元数据还没到 / 后端没给）。给 0 会让滑块卡在最左，
            // 用 position 兜底至少能跟着走。
            max={duration || position || 1}
            value={position}
            onChange={(e) => seek(Number(e.target.value))}
            className="mt-1 h-1 w-full accent-[var(--color-primary)]"
            aria-label="播放进度"
          />
        </div>

        <span className="hidden shrink-0 font-mono text-xs text-muted-foreground tabular-nums sm:inline">
          {fmt(position)} / {duration ? fmt(duration) : "--:--"}
        </span>

        {/* 只有这首歌**确实有伴奏**时才显示切换按钮 —— 显示一个点了没反应的按钮
            比不显示更糟 */}
        {hasAccompaniment ? (
          <Button
            variant={accompanimentMode ? "primary" : "ghost"}
            size="icon"
            onClick={toggleAccompaniment}
            aria-label={accompanimentMode ? "切回原曲" : "切到伴奏"}
            aria-pressed={accompanimentMode}
            title={accompanimentMode ? "切回原曲" : "切到伴奏"}
          >
            {accompanimentMode ? <MicOff /> : <Mic2 />}
          </Button>
        ) : null}

        {onOpenQueue ? (
          <Button variant="ghost" size="icon" onClick={onOpenQueue} aria-label="播放队列" className="relative">
            <ListMusic />
            {queueCount ? (
              <span className={cn(
                "absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-primary px-1",
                "text-[10px] leading-4 text-primary-foreground",
              )}>
                {queueCount}
              </span>
            ) : null}
          </Button>
        ) : null}

        <DevicePicker
          devices={devices}
          activeId={activeId}
          myConnectionId={myConnectionId}
          connected={status === "open"}
          onClaim={claim}
        />

        <Button
          variant="primary"
          size="icon"
          onClick={toggle}
          // 播放权不在本机时禁用：点了也会被上面那条 effect 立刻停掉，
          // 表现成「按钮闪一下就弹回去」，不如直接禁用并在设备选择器里给出路。
          disabled={!isActive}
          aria-label={playing ? "暂停" : "播放"}
          title={isActive ? undefined : "播放权在其他设备上"}
        >
          {playing ? <Pause /> : <Play />}
        </Button>
        </>
        ) : null}
      </div>
    </div>
  );
}

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds)) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
