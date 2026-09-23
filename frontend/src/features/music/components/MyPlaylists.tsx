import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ListMusic, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/shared/api/errors";
import { useApiQuery } from "@/shared/api/useApiQuery";
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  useConfirm,
  useToast,
} from "@/shared/ui";
import {
  addToQueue,
  createPlaylist,
  deletePlaylist,
  fetchMusics,
  fetchPlaylist,
  fetchPlaylists,
  musicKeys,
} from "../api";
import type { Music } from "../types";

/** 「我的列表」：歌单一览 + 展开看曲目。 */
export function MyPlaylists({ onPlay }: { onPlay: (music: Music) => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);

  const playlists = useApiQuery(musicKeys.playlists(), fetchPlaylists);
  const invalidate = () => void qc.invalidateQueries({ queryKey: musicKeys.playlists() });

  const create = useMutation({
    mutationFn: (name: string) => createPlaylist(name.trim()),
    onSuccess: () => {
      toast.success("已新建歌单");
      setNewName("");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "新建失败"),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deletePlaylist(id),
    onSuccess: () => {
      toast.success("已删除");
      setOpenId(null);
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "删除失败"),
  });

  return (
    <div className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim()) create.mutate(newName);
        }}
      >
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="新建歌单，输入名称"
          aria-label="新歌单名称"
        />
        <Button type="submit" loading={create.isPending} disabled={!newName.trim()}>
          <Plus />
          新建
        </Button>
      </form>

      {playlists.isPending ? (
        <LoadingState />
      ) : playlists.isError ? (
        <ErrorState error={playlists.error} onRetry={() => void playlists.refetch()} />
      ) : playlists.data?.length ? (
        <ul className="space-y-2">
          {playlists.data.map((p) => (
            <li key={p.id}>
              <Card>
                <button
                  type="button"
                  onClick={() => setOpenId((v) => (v === p.id ? null : p.id))}
                  className="flex w-full items-center gap-3 p-4 text-left"
                >
                  <ListMusic className="size-5 shrink-0 text-primary" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {p.music_ids?.length ?? 0} 首
                    </span>
                  </span>
                </button>

                {openId === p.id ? (
                  <CardContent className="border-t border-border pt-4">
                    <PlaylistTracks playlistId={p.id} onPlay={onPlay} />
                    <div className="mt-3 flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          if (
                            await confirm({
                              title: `删除歌单「${p.name}」？`,
                              description: "歌单里的歌本身不会被删掉，只是解散这个列表。",
                              tone: "danger",
                              confirmText: "删除",
                            })
                          ) {
                            remove.mutate(p.id);
                          }
                        }}
                      >
                        <Trash2 />
                        删除歌单
                      </Button>
                    </div>
                  </CardContent>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="还没有歌单" description="在上面输入名称新建一个" />
      )}
    </div>
  );
}

/** 歌单里的曲目。歌单接口只给 music_ids，所以要另外拿曲目信息。 */
function PlaylistTracks({
  playlistId,
  onPlay,
}: {
  playlistId: number;
  onPlay: (music: Music) => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();

  const detail = useApiQuery(musicKeys.playlist(playlistId), () => fetchPlaylist(playlistId));

  // 歌单接口只回 music_ids。这里借「全部歌曲」的第一页做不到 ——
  // 歌单里的歌可能在任何一页。拉一份足够大的列表按 id 索引。
  // per_page 给 1000：库里 571 首，一次拿完比按 id 逐个查省得多。
  // ★ include_accompaniments=true：歌单里**可能**有伴奏（用户手动加的），
  //   用默认过滤会让那些条目显示不出来。
  const all = useApiQuery(musicKeys.list(1, "", true), () => fetchMusics(1, "", true));

  const enqueue = useMutation({
    mutationFn: (ids: number[]) => addToQueue(ids),
    onSuccess: () => {
      toast.success("已加入队列");
      void qc.invalidateQueries({ queryKey: musicKeys.queue() });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "加入失败"),
  });

  if (detail.isPending || all.isPending) return <LoadingState className="min-h-20" />;
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;

  const byId = new Map((all.data?.musics ?? []).map((m) => [m.id, m]));
  // 按歌单里的顺序还原（后端有 position 排序），跳过已被删掉的歌
  const tracks = (detail.data?.music_ids ?? [])
    .map((id) => byId.get(id))
    .filter((m): m is Music => Boolean(m));

  if (tracks.length === 0) {
    return <p className="text-sm text-muted-foreground">这个歌单还是空的</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => enqueue.mutate(tracks.map((t) => t.id))}>
          <Plus />
          全部加入队列
        </Button>
      </div>
      <ul className="space-y-0.5">
        {tracks.map((m, i) => (
          <li key={`${m.id}-${i}`} className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="size-7" onClick={() => onPlay(m)} aria-label={`播放 ${m.title}`}>
              <Play className="size-3.5" />
            </Button>
            <span className="min-w-0 flex-1 truncate text-sm">{m.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
