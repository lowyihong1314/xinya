import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { ApiError } from "@/shared/api/errors";
import { useApiQuery } from "@/shared/api/useApiQuery";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  useToast,
} from "@/shared/ui";
import { AlbumThumb } from "../components/AlbumThumb";
import { eventKeys, fetchEvent, toggleHeart } from "../api";
import type { AlbumFile, EventItem } from "../types";

export function EventDetailPage() {
  const { eventId } = useParams();
  const id = Number(eventId);
  const toast = useToast();
  const qc = useQueryClient();

  const event = useApiQuery(eventKeys.detail(id), () => fetchEvent(id), {
    enabled: Number.isFinite(id),
  });

  const heart = useMutation({
    mutationFn: (file: AlbumFile) => toggleHeart(file.id),
    // 乐观更新：点爱心必须立刻有反馈，等一个往返太慢，手感像没点上。
    onMutate: async (file) => {
      await qc.cancelQueries({ queryKey: eventKeys.detail(id) });
      const prev = qc.getQueryData<EventItem>(eventKeys.detail(id));
      qc.setQueryData<EventItem>(eventKeys.detail(id), (old) =>
        old
          ? {
              ...old,
              album_files: old.album_files.map((f) =>
                f.id === file.id
                  ? {
                      ...f,
                      hearted_by_me: !f.hearted_by_me,
                      heart_count: (f.heart_count ?? 0) + (f.hearted_by_me ? -1 : 1),
                    }
                  : f,
              ),
            }
          : old,
      );
      return { prev };
    },
    // 失败就回滚到快照，而不是重新拉一次 —— 重拉会让整个相册闪一下。
    onError: (err, _file, ctx) => {
      if (ctx?.prev) qc.setQueryData(eventKeys.detail(id), ctx.prev);
      toast.error(err instanceof ApiError ? err.message : "操作失败");
    },
  });

  if (event.isPending) return <LoadingState />;
  if (event.isError) return <ErrorState error={event.error} onRetry={() => void event.refetch()} />;
  // id 不是数字时查询被禁用（enabled:false），这里会走到 —— 渲染 404 而不是永久转圈
  if (!event.data) return <EmptyState title="找不到这个活动" description="链接可能已经失效。" />;

  const ev = event.data;
  // 爱心多的排前面，与旧版一致；数量相同按序号，保证顺序稳定（否则每次渲染会跳）。
  const photos = [...ev.album_files].sort(
    (a, b) => (b.heart_count ?? 0) - (a.heart_count ?? 0) || (a.no ?? 0) - (b.no ?? 0),
  );

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link to="/events">
          <ArrowLeft />
          活动
        </Link>
      </Button>

      <PageHeader
        title={ev.event_name}
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5" aria-hidden />
              {ev.datetime?.slice(0, 16).replace("T", " ") || "—"}
            </span>
            {ev.location ? (
              <span className="flex items-center gap-1.5">
                <MapPin className="size-3.5" aria-hidden />
                {ev.location_name || ev.location}
              </span>
            ) : null}
            {ev.is_public ? <Badge variant="primary">公开</Badge> : null}
          </span>
        }
        actions={
          <>
            {ev.prev_event_id ? (
              <Button asChild variant="outline" size="icon" aria-label="上一个活动">
                <Link to={`/events/${ev.prev_event_id}`}>
                  <ChevronLeft />
                </Link>
              </Button>
            ) : null}
            {ev.next_event_id ? (
              <Button asChild variant="outline" size="icon" aria-label="下一个活动">
                <Link to={`/events/${ev.next_event_id}`}>
                  <ChevronRight />
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {ev.purpose ? (
        <Card className="mb-6">
          <CardContent className="whitespace-pre-wrap pt-5 leading-7">{ev.purpose}</CardContent>
        </Card>
      ) : null}

      {ev.album && photos.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
            相册 · {photos.length} 张
          </h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {photos.map((file) => (
              <li key={file.id}>
                <AlbumThumb file={file} onToggleHeart={(f) => heart.mutate(f)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
