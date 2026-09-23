import { Search } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Link } from "react-router-dom";

import { useApiQuery } from "@/shared/api/useApiQuery";
import { useAuth } from "@/shared/auth/AuthProvider";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Skeleton,
} from "@/shared/ui";
import { fetchSongs, songbookKeys } from "../api";

export function SongbookPage() {
  const { has } = useAuth();
  const canEdit = has("music_edit");

  const [keyword, setKeyword] = useState("");
  // 输入时不要每敲一个字就发一次请求。useDeferredValue 让输入框保持跟手，
  // 查询用滞后的值 —— 比 debounce 好在不用管定时器的清理。
  const deferred = useDeferredValue(keyword);

  const list = useApiQuery(
    songbookKeys.list({ q: deferred, includeUnpublished: canEdit }),
    () => fetchSongs({ q: deferred, includeUnpublished: canEdit }),
    { placeholderData: (prev) => prev },  // 换关键词时保留上一批，避免列表闪空
  );

  return (
    <div>
      <PageHeader
        title="歌本"
        description={list.data ? `共 ${list.data.entries.length} 首` : undefined}
      />

      <div className="relative mb-4">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索歌名"
          className="pl-9"
          aria-label="搜索歌名"
        />
      </div>

      {list.isPending ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data?.entries.length ? (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {list.data.entries.map((song) => (
            <li key={song.id}>
              <Card className="h-full transition-colors hover:border-primary/40">
                <Link
                  to={`/music/songbook/${song.id}`}
                  className="flex h-full items-start gap-3 p-4"
                >
                  <span className="mt-0.5 w-8 shrink-0 text-right font-mono text-sm text-muted-foreground">
                    {song.song_number ?? "—"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{song.title}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      {song.variant ? <Badge variant="neutral">{song.variant}</Badge> : null}
                      {song.selected_key ? (
                        <Badge variant="primary">{song.selected_key}</Badge>
                      ) : null}
                      {/* 只有自己改过的人看得到这个标记，提示"你看到的和别人不同" */}
                      {song.has_user_override ? <Badge variant="info">我的版本</Badge> : null}
                      {!song.published ? <Badge variant="warning">未发布</Badge> : null}
                    </span>
                  </span>
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title={keyword ? "没有匹配的歌" : "歌本还是空的"}
          description={keyword ? `试试别的关键词` : undefined}
        />
      )}
    </div>
  );
}
