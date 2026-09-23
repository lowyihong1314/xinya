import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Trash2, X } from "lucide-react";

import { ApiError } from "@/shared/api/errors";
import { useApiQuery } from "@/shared/api/useApiQuery";
import { cn } from "@/shared/lib/cn";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  LoadingState,
  useConfirm,
  useToast,
} from "@/shared/ui";
import {
  clearQueue,
  fetchQueue,
  musicKeys,
  removeFromQueue,
  reorderQueue,
} from "../api";
import type { Music } from "../types";

/**
 * 播放队列。
 *
 * ★ 移除按**下标**而不是 music_id —— 同一首歌可以在队列里出现多次
 *   （有人就是想连着听两遍），按 id 删会把特意加的第二遍也删掉。
 */
export function QueueDrawer({
  open,
  onOpenChange,
  onPlay,
  currentId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPlay: (music: Music) => void;
  currentId?: number | null;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const queue = useApiQuery(musicKeys.queue(), fetchQueue, { enabled: open });
  const invalidate = () => void qc.invalidateQueries({ queryKey: musicKeys.queue() });

  const remove = useMutation({
    mutationFn: (index: number) => removeFromQueue(index),
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "移除失败"),
  });

  const reorder = useMutation({
    mutationFn: (ids: number[]) => reorderQueue(ids),
    onSuccess: invalidate,
    onError: (e) =>
      // 409 = 队列在别处被改过。这时重拉而不是报错了事，用户看到的是最新队列。
      e instanceof ApiError && e.status === 409
        ? (toast.info("队列已更新，请重试"), invalidate())
        : toast.error(e instanceof ApiError ? e.message : "排序失败"),
  });

  const clear = useMutation({
    mutationFn: clearQueue,
    onSuccess: () => {
      toast.success("队列已清空");
      invalidate();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "操作失败"),
  });

  const items = queue.data?.items ?? [];

  /** 上/下移：本地算好新顺序整份发上去（后端只接受同一批 id）。 */
  function move(from: number, to: number) {
    if (to < 0 || to >= items.length) return;
    const ids = items.map((m) => m.id);
    const [moved] = ids.splice(from, 1);
    if (moved === undefined) return;
    ids.splice(to, 0, moved);
    reorder.mutate(ids);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2 pr-0">
            <span>播放队列{items.length ? ` · ${items.length}` : ""}</span>
            {items.length ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  if (await confirm({ title: "清空播放队列？", tone: "danger", confirmText: "清空" })) {
                    clear.mutate();
                  }
                }}
              >
                <Trash2 />
                清空
              </Button>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        {queue.isPending ? (
          <LoadingState />
        ) : items.length === 0 ? (
          <EmptyState title="队列是空的" description="在歌曲上点「加入队列」" className="min-h-32" />
        ) : (
          <ul className="-mx-1 max-h-[60svh] space-y-0.5 overflow-y-auto px-1">
            {items.map((music, index) => (
              <li
                key={`${music.id}-${index}`}
                className={cn(
                  "flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1.5",
                  music.id === currentId && "bg-primary-soft",
                )}
              >
                <button
                  type="button"
                  onClick={() => onPlay(music)}
                  className="min-w-0 flex-1 truncate text-left text-sm"
                >
                  {music.title}
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={index === 0 || reorder.isPending}
                  onClick={() => move(index, index - 1)}
                  aria-label="上移"
                >
                  <ChevronUp className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={index === items.length - 1 || reorder.isPending}
                  onClick={() => move(index, index + 1)}
                  aria-label="下移"
                >
                  <ChevronDown className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(index)}
                  aria-label={`把「${music.title}」移出队列`}
                >
                  <X className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
