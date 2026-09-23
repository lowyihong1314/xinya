import { CalendarDays, MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { fetchMediaPath, mediaUrl } from "@/features/events/components/mediaUrl";
import type { EventItem } from "@/features/events/types";
import { cn } from "@/shared/lib/cn";
import { Skeleton } from "@/shared/ui";

/** 首页的活动卡片：封面 + 日期 + 名称 + 地点。 */
export function EventCard({ event, featured = false }: { event: EventItem; featured?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const fileId = (event.event_image as { id?: number } | null)?.id ?? null;

  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    void fetchMediaPath(fileId)
      .then((r) => {
        if (!cancelled && r.ready && r.path) setUrl(mediaUrl(r.path));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  return (
    <Link
      to={`/events/${event.id}`}
      className={cn(
        "group flex h-full flex-col overflow-hidden rounded-[var(--radius-md)] border border-border",
        "bg-card transition-colors hover:border-primary/40",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]",
      )}
    >
      <div className={cn("relative w-full overflow-hidden bg-muted", featured ? "aspect-[16/7]" : "aspect-[4/3]")}>
        {url ? (
          <img
            src={url}
            alt=""
            aria-hidden
            loading="lazy"
            decoding="async"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : fileId ? (
          <Skeleton className="size-full rounded-none" />
        ) : (
          // 没有封面时用渐变占位，而不是留一块灰 —— 往期活动里有不少没配图的
          <div className="size-full bg-[linear-gradient(135deg,var(--color-nav-start),var(--color-nav-end))] opacity-20" />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 p-4">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarDays className="size-3.5 shrink-0" aria-hidden />
          {formatRange(event.datetime, event.end_datetime)}
        </p>
        <h3 className={cn("min-w-0 font-medium leading-snug", featured ? "text-lg" : "text-sm")}>
          {event.event_name}
        </h3>
        {event.location || event.location_name ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{event.location_name || event.location}</span>
          </p>
        ) : null}
      </div>
    </Link>
  );
}

/**
 * "2026/07/26" 或 "2026/07/26 – 07/28"。
 * 后端给的是 "YYYY-MM-DD HH:MM:SS" 的裸字符串（没有时区标记），
 * 所以按字符串裁剪而不是 new Date() —— 后者会按本地时区再解释一次。
 */
function formatRange(start: string | null, end: string | null): string {
  const s = (start ?? "").slice(0, 10);
  if (!s) return "—";
  const e = (end ?? "").slice(0, 10);
  const fmt = (d: string) => d.replace(/-/g, "/");
  if (!e || e === s) return fmt(s);
  // 同年同月只显示尾部的「月/日」，省得一行塞两个完整日期
  return s.slice(0, 7) === e.slice(0, 7) ? `${fmt(s)} – ${e.slice(8)}` : `${fmt(s)} – ${fmt(e)}`;
}
