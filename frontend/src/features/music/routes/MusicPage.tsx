import { Music2, Pause, Play, Search } from "lucide-react";
import { useDeferredValue, useState } from "react";

import { useApiQuery } from "@/shared/api/useApiQuery";
import { cn } from "@/shared/lib/cn";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Skeleton,
} from "@/shared/ui";
import { usePlayer } from "../components/usePlayer";
import { fetchMusics, musicKeys } from "../api";

export function MusicPage() {
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const search = useDeferredValue(keyword);
  const player = usePlayer();

  const list = useApiQuery(musicKeys.list(page, search), () => fetchMusics(page, search), {
    placeholderData: (prev) => prev,
  });

  return (
    // pb-24：底部播放条是 fixed 的，不留出空间会盖住最后一首
    <div className="pb-24">
      <PageHeader title="音乐" description={list.data ? `共 ${list.data.total} 首` : undefined} />

      <div className="relative mb-4">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value);
            setPage(1);
          }}
          placeholder="搜索歌名"
          className="pl-9"
          aria-label="搜索歌名"
        />
      </div>

      {list.isPending ? (
        <div className="space-y-1.5">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data?.musics.length ? (
        <>
          <ul className="space-y-1.5">
            {list.data.musics.map((m) => {
              const active = player.current?.id === m.id;
              return (
                <li key={m.id}>
                  <Card
                    className={cn(
                      "flex items-center gap-3 p-3 transition-colors",
                      active && "border-primary/40 bg-primary-soft/40",
                    )}
                  >
                    <Button
                      variant={active && player.playing ? "primary" : "outline"}
                      size="icon"
                      onClick={() => player.play(m)}
                      aria-label={active && player.playing ? `暂停 ${m.title}` : `播放 ${m.title}`}
                    >
                      {active && player.playing ? <Pause /> : <Play />}
                    </Button>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{m.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {m.album?.name || "未分类"}
                        {m.play_minutes > 0 ? ` · 已播 ${m.play_minutes} 分钟` : ""}
                      </p>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>

          {list.data.total_pages > 1 ? (
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                上一页
              </Button>
              <span className="text-sm text-muted-foreground">
                {list.data.page} / {list.data.total_pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= list.data.total_pages}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState title={keyword ? "没有匹配的歌" : "音乐库是空的"} />
      )}

      {player.current ? <PlayerBar player={player} /> : null}
    </div>
  );
}

function PlayerBar({ player }: { player: ReturnType<typeof usePlayer> }) {
  const { current, playing, position, duration, toggle, seek } = player;
  if (!current) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-2.5">
        <Music2 className="size-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{current.title}</p>
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
        <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
          {fmt(position)} / {duration ? fmt(duration) : "--:--"}
        </span>
        <Button variant="primary" size="icon" onClick={toggle} aria-label={playing ? "暂停" : "播放"}>
          {playing ? <Pause /> : <Play />}
        </Button>
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
