import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Radio } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ApiError } from "@/shared/api/errors";
import { useApiQuery } from "@/shared/api/useApiQuery";
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Input,
  Label,
  PageHeader,
  Skeleton,
  useToast,
} from "@/shared/ui";
import { changyouKeys, createRoom, fetchRooms } from "../api";

/**
 * 房间剩余时间。房间的 TTL 是 24 小时，过期就没了（Redis 自己回收），
 * 所以列表上必须让人看到「这个房间还能用多久」。
 */
function formatRemaining(expiresAt: number | null): string {
  if (!expiresAt) return "有效期未知";
  // expires_at 是**秒级** unix 时间戳，不是毫秒 —— 直接丢给 Date 会算到 1970 年。
  const seconds = expiresAt - Math.floor(Date.now() / 1000);
  if (seconds <= 0) return "已过期";
  const hours = Math.floor(seconds / 3600);
  if (hours >= 1) return `还剩 ${hours} 小时`;
  return `还剩 ${Math.max(1, Math.floor(seconds / 60))} 分钟`;
}

export function ChangyouRoomsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const list = useApiQuery(changyouKeys.rooms(), fetchRooms);

  const create = useMutation({
    mutationFn: createRoom,
    onSuccess: (room) => {
      toast.success("房间已创建");
      setCreating(false);
      void qc.invalidateQueries({ queryKey: changyouKeys.rooms() });
      // 建完直接进控制台 —— 建房的人下一步一定是推歌，不会想再回列表点一次。
      navigate(`/changyou/${room.room_id}`);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "创建房间失败"),
  });

  return (
    <div>
      <PageHeader
        title="唱游房间"
        description="建一个房间，把歌词投到现场的大屏上"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus />
            建房间
          </Button>
        }
      />

      {list.isPending ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data?.length ? (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {list.data.map((room) => (
            <li key={room.room_id}>
              <Card className="h-full transition-colors hover:border-primary/40">
                <Link to={`/changyou/${room.room_id}`} className="block h-full p-4">
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0 flex-1 truncate font-medium">{room.topic}</span>
                    {/* 房间号要能念给现场的人听、能手打进 URL，所以用等宽字体显示 */}
                    <Badge variant="neutral" className="font-mono">
                      {room.room_id}
                    </Badge>
                  </span>
                  <span className="mt-2 block text-sm text-muted-foreground">
                    {room.creator_name ? `${room.creator_name} 建的` : "创建者未知"}
                    {" · "}
                    {formatRemaining(room.expires_at)}
                  </span>
                  {room.song_entry_id ? (
                    <span className="mt-2 flex items-center gap-1.5 text-sm text-primary">
                      <Radio className="size-4" aria-hidden />
                      正在放歌
                    </span>
                  ) : null}
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="还没有房间"
          description="点右上角「建房间」开一个，24 小时后自动回收"
          className="py-12"
        />
      )}

      <CreateRoomDialog
        open={creating}
        onOpenChange={setCreating}
        onSubmit={(topic) => create.mutate(topic)}
        submitting={create.isPending}
      />
    </div>
  );
}

function CreateRoomDialog({
  open,
  onOpenChange,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (topic: string) => void;
  submitting: boolean;
}) {
  const [topic, setTopic] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit(topic);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>建一个房间</DialogTitle>
        </DialogHeader>
        {/* 「主题不能为空」这句话由后端说 —— 前端再写一套校验文案迟早和后端漂移，
            用户会在不同地方看到两种说法。这里只用 required 拦住空提交。 */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="topic">房间主题</Label>
            <Input
              id="topic"
              required
              autoFocus
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="例如：周六共修"
            />
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" loading={submitting}>
              建房间
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
