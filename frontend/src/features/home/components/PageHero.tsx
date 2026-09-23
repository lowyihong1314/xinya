import { useEffect, useMemo, useState } from "react";

import { cn } from "@/shared/lib/cn";
import { fetchMediaPath, mediaUrl } from "@/features/events/components/mediaUrl";
import type { EventItem } from "@/features/events/types";

const SLIDE_MS = 5200;

/**
 * 首页主视觉。**与旧版对齐**（原 src/components/PageHero.tsx）：
 * 活动封面图轮播作背景，上面压标题与副标题，副标题显示当前那张图的活动名。
 *
 * 图片地址要多问一次后端（见 events/components/mediaUrl.ts），所以这里
 * 预取前几张而不是全部 —— 首页不该为了背景发几十个请求。
 */
export function PageHero({
  title,
  subtitle,
  events,
}: {
  title: string;
  subtitle: string;
  events: EventItem[];
}) {
  // 只取有封面的前 8 场。再多没意义：轮播 5.2 秒一张，没人会看到第 9 张。
  const slides = useMemo(
    () => events.filter((e) => e.event_image).slice(0, 8),
    [events],
  );
  const [index, setIndex] = useState(0);
  const [urls, setUrls] = useState<Record<number, string>>({});

  useEffect(() => {
    if (slides.length <= 1) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % slides.length), SLIDE_MS);
    return () => window.clearInterval(timer);
  }, [slides.length]);

  // 逐张解析真实地址。失败的那张跳过（不阻塞其余）——
  // 首页背景挂了不该让整页空着。
  useEffect(() => {
    let cancelled = false;
    for (const ev of slides) {
      const fileId = (ev.event_image as { id?: number } | null)?.id;
      if (!fileId || urls[ev.id]) continue;
      void fetchMediaPath(fileId)
        .then((r) => {
          if (cancelled || !r.ready || !r.path) return;
          setUrls((prev) => ({ ...prev, [ev.id]: mediaUrl(r.path!) }));
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [slides, urls]);

  const current = slides[index];
  const currentUrl = current ? urls[current.id] : undefined;

  return (
    <section
      className={cn(
        "relative -mx-4 -mt-6 mb-8 flex h-[min(52svh,420px)] items-center justify-center overflow-hidden",
        "bg-[linear-gradient(135deg,var(--color-nav-start),var(--color-nav-end))]",
      )}
      aria-label={title}
    >
      {/* 背景图。每张单独一层做淡入淡出，比换 src 平滑（换 src 会闪一下白） */}
      {slides.map((ev, i) => {
        const url = urls[ev.id];
        if (!url) return null;
        return (
          <img
            key={ev.id}
            src={url}
            alt=""
            aria-hidden
            className={cn(
              "absolute inset-0 size-full object-cover transition-opacity duration-1000",
              i === index ? "opacity-100" : "opacity-0",
            )}
          />
        );
      })}

      {/* 压暗：不压的话浅色照片上的白字看不清 */}
      <div className="absolute inset-0 bg-black/35" aria-hidden />

      <div className="relative px-6 text-center text-white">
        <h1 className="font-serif text-3xl leading-tight tracking-wide drop-shadow sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 text-sm tracking-[0.3em] opacity-90 drop-shadow sm:text-base">
          {/* 副标题显示当前背景那场活动的名字，没有就回落到固定文案（与旧版一致） */}
          {currentUrl && current ? current.event_name : subtitle}
        </p>
      </div>
    </section>
  );
}
