import { Mic2, Pause, Play, Search } from "lucide-react";
import { useDeferredValue, useState } from "react";

import { useApiQuery } from "@/shared/api/useApiQuery";
import { cn } from "@/shared/lib/cn";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/shared/ui";
import { PlayerBar } from "../components/PlayerBar";
import { QueueDrawer } from "../components/QueueDrawer";
import { TrackActions } from "../components/TrackActions";
import { usePlayer } from "../components/usePlayer";
import { fetchMusics, fetchQueue, musicKeys } from "../api";
import { MyPlaylists } from "../components/MyPlaylists";

export function MusicPage() {
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const search = useDeferredValue(keyword);
  const [queueOpen, setQueueOpen] = useState(false);
  const player = usePlayer();

  // ★ 列表默认**不含伴奏** —— 伴奏不是独立作品，混进来会凭空多出一批重复歌名。
  //   要听伴奏是在播放器里切，不是从列表里单独找一条。
  const list = useApiQuery(
    musicKeys.list(page, search, false),
    () => fetchMusics(page, search, false),
    { placeholderData: (prev) => prev },
  );

  // 只为了在播放条上显示队列数量，所以很轻
  const queue = useApiQuery(musicKeys.queue(), fetchQueue);

  return (
    // pb-24：底部播放条是 fixed 的，不留出空间会盖住最后一首
    <div className="pb-24">
      <PageHeader title="音乐" />

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">全部歌曲</TabsTrigger>
          <TabsTrigger value="mine">我的列表</TabsTrigger>
        </TabsList>

        <TabsContent value="all">
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
              <p className="mb-2 text-xs text-muted-foreground">共 {list.data.total} 首（不含伴奏）</p>
              <ul className="space-y-1.5">
                {list.data.musics.map((m) => {
                  const active = player.current?.id === m.id;
                  return (
                    <li key={m.id}>
                      <Card
                        className={cn(
                          "flex items-center gap-2 p-3 transition-colors",
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
                          <p className="flex items-center gap-1.5 truncate font-medium">
                            <span className="truncate">{m.title}</span>
                            {/* 有伴奏的歌在列表里就标出来，用户不用点进去才发现 */}
                            {m.accompaniment_id != null ? (
                              <Badge variant="primary" className="shrink-0 gap-1 px-1.5 py-0">
                                <Mic2 className="size-2.5" />
                                伴奏
                              </Badge>
                            ) : null}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {m.album?.name || "未分类"}
                            {m.play_minutes > 0 ? ` · 已播 ${Math.round(m.play_minutes)} 分钟` : ""}
                          </p>
                        </div>
                        <TrackActions music={m} />
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
        </TabsContent>

        <TabsContent value="mine">
          <MyPlaylists onPlay={player.play} />
        </TabsContent>
      </Tabs>

      <PlayerBar
        player={player}
        queueCount={queue.data?.items.length}
        onOpenQueue={() => setQueueOpen(true)}
      />
      <QueueDrawer
        open={queueOpen}
        onOpenChange={setQueueOpen}
        onPlay={player.play}
        currentId={player.current?.id}
      />
    </div>
  );
}
