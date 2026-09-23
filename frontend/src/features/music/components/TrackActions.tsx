import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ListPlus, Plus } from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/shared/api/errors";
import { useApiQuery } from "@/shared/api/useApiQuery";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  LoadingState,
  useToast,
} from "@/shared/ui";
import {
  addToQueue,
  createPlaylist,
  fetchPlaylist,
  fetchPlaylists,
  musicKeys,
  savePlaylist,
} from "../api";
import type { Music } from "../types";

/** 一首歌的「加入队列 / 加入歌单」入口。 */
export function TrackActions({ music }: { music: Music }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);

  const queueAdd = useMutation({
    mutationFn: (position: "end" | "next") => addToQueue(music.id, position),
    onSuccess: (_d, position) => {
      toast.success(position === "next" ? "已插到下一首" : "已加入队列");
      void qc.invalidateQueries({ queryKey: musicKeys.queue() });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "加入失败"),
  });

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => queueAdd.mutate("end")}
        disabled={queueAdd.isPending}
        aria-label={`把「${music.title}」加入队列`}
        title="加入队列"
      >
        <Plus />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setPicking(true)}
        aria-label={`把「${music.title}」加入歌单`}
        title="加入歌单"
      >
        <ListPlus />
      </Button>

      <PlaylistPicker open={picking} onOpenChange={setPicking} music={music} />
    </>
  );
}

/** 选一个歌单加进去，或者当场新建一个。 */
function PlaylistPicker({
  open,
  onOpenChange,
  music,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  music: Music;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");

  const playlists = useApiQuery(musicKeys.playlists(), fetchPlaylists, { enabled: open });

  const done = (message: string) => {
    toast.success(message);
    onOpenChange(false);
    setNewName("");
    void qc.invalidateQueries({ queryKey: musicKeys.playlists() });
  };
  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "操作失败");

  const addTo = useMutation({
    // 后端的保存接口收的是**整份 music_ids**，所以要先拉当前歌单再追加。
    // 拉的是最新的那一份，避免用列表里可能过期的 music_ids 覆盖掉别人刚加的歌。
    mutationFn: async (playlistId: number) => {
      const fresh = await fetchPlaylist(playlistId);
      const ids = fresh.music_ids ?? [];
      if (ids.includes(music.id)) return { already: true };
      return savePlaylist(playlistId, { music_ids: [...ids, music.id] });
    },
    onSuccess: (r) =>
      done((r as { already?: boolean })?.already ? "这首歌已经在歌单里了" : "已加入歌单"),
    onError: fail,
  });

  const create = useMutation({
    mutationFn: (name: string) => createPlaylist(name.trim(), [music.id]),
    onSuccess: () => done("已新建歌单"),
    onError: fail,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>加入歌单</DialogTitle>
        </DialogHeader>

        {playlists.isPending ? (
          <LoadingState className="min-h-24" />
        ) : playlists.data?.length ? (
          <ul className="-mx-1 max-h-64 space-y-0.5 overflow-y-auto px-1">
            {playlists.data.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  disabled={addTo.isPending}
                  onClick={() => addTo.mutate(p.id)}
                  className="flex w-full items-center justify-between rounded-[var(--radius-sm)] px-2 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                >
                  <span className="min-w-0 truncate">{p.name}</span>
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                    {p.music_ids?.length ?? 0} 首
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="还没有歌单" description="在下面新建一个" className="min-h-20" />
        )}

        <form
          className="mt-2 space-y-2 border-t border-border pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) create.mutate(newName);
          }}
        >
          <Label htmlFor="new-playlist">新建歌单</Label>
          <div className="flex gap-2">
            <Input
              id="new-playlist"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="歌单名称"
            />
            <Button type="submit" loading={create.isPending} disabled={!newName.trim()}>
              新建
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
