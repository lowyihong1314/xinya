import { useMemo, useState } from "react";

import { eventKeys, fetchEvents } from "@/features/events/api";
import type { EventItem } from "@/features/events/types";
import { useApiQuery } from "@/shared/api/useApiQuery";
import { Button, EmptyState, ErrorState, Skeleton } from "@/shared/ui";
import { EventCard } from "../components/EventCard";
import { PageHero } from "../components/PageHero";

const PAST_PAGE_SIZE = 8;

/**
 * 首页 = 活动相册。**公开页**，不要求登录 —— 与旧版一致
 * （旧路由表 NAV_ITEMS 里首页是 `auth: false`，整个路由表一层守卫都没有）。
 *
 * 这个站的大部分访客是从分享链接进来的、根本没有账号，
 * 一打开就被弹去登录页是最劝退的做法。
 *
 * 三段结构沿用旧版（src/album/react/HomeAlbumPage.tsx）：
 *   下一个活动 · 即将到来  → 一张大卡
 *   即将举行 · 近期活动预告 → 横排
 *   往期活动 · 回顾过去的法会与共修 → 网格 + 分页
 */
export function HomePage() {
  // 拉第一页就够首页用。后端按时间倒序，往期活动天然在前面。
  // per_page 给大一点，免得"即将举行"被往期挤出去。
  const list = useApiQuery(eventKeys.list({ page: 1 }), () => fetchEvents({ page: 1 }));

  const [pastPage, setPastPage] = useState(0);

  const { next, upcoming, past } = useMemo(
    () => splitByDate(list.data?.data ?? []),
    [list.data],
  );

  const pastPageCount = Math.max(1, Math.ceil(past.length / PAST_PAGE_SIZE));
  const safePage = Math.min(pastPage, pastPageCount - 1);
  const pagedPast = past.slice(safePage * PAST_PAGE_SIZE, (safePage + 1) * PAST_PAGE_SIZE);

  return (
    <div>
      <PageHero title="地南佛学会" subtitle="南 無 阿 彌 陀 佛" events={list.data?.data ?? []} />

      <div className="mx-auto w-full max-w-6xl">
        {list.isPending ? (
          <div className="space-y-8">
            <Skeleton className="h-64" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-56" />
              ))}
            </div>
          </div>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : !next && upcoming.length === 0 && past.length === 0 ? (
          <EmptyState title="还没有活动" description="活动发布后会出现在这里。" />
        ) : (
          <div className="space-y-10">
            {next ? (
              <Section title="下一个活动" subtitle="即将到来">
                <EventCard event={next} featured />
              </Section>
            ) : null}

            {upcoming.length > 0 ? (
              <Section title="即将举行" subtitle="近期活动预告">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {upcoming.map((e) => (
                    <EventCard key={e.id} event={e} />
                  ))}
                </div>
              </Section>
            ) : null}

            {past.length > 0 ? (
              <Section title="往期活动" subtitle="回顾过去的法会与共修">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {pagedPast.map((e) => (
                    <EventCard key={e.id} event={e} />
                  ))}
                </div>
                {pastPageCount > 1 ? (
                  <div className="mt-5 flex items-center justify-center gap-3">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={safePage <= 0}
                      onClick={() => setPastPage((p) => Math.max(0, p - 1))}
                    >
                      上一页
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      {safePage + 1} / {pastPageCount}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={safePage >= pastPageCount - 1}
                      onClick={() => setPastPage((p) => p + 1)}
                    >
                      下一页
                    </Button>
                  </div>
                ) : null}
              </Section>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="font-serif text-xl">{title}</h2>
        <span className="text-sm text-muted-foreground">{subtitle}</span>
      </div>
      {children}
    </section>
  );
}

/**
 * 按日期分成「下一个 / 即将举行 / 往期」。
 *
 * ★ 用**字符串比较**而不是 new Date()：后端给的是 "YYYY-MM-DD HH:MM:SS" 的
 *   裸时间（没有时区标记，见 backend 的 posted_at/created_at 说明），
 *   new Date() 会按浏览器本地时区再解释一次，跨时区的人看到的分组会差一天。
 *   "YYYY-MM-DD" 这种格式按字典序比较就是按时间比较。
 */
function splitByDate(events: EventItem[]): {
  next: EventItem | null;
  upcoming: EventItem[];
  past: EventItem[];
} {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;

  const withDate = events.filter((e) => e.datetime);
  // 结束日期 >= 今天算"还没过去"（多天活动进行到一半时仍该在"即将举行"里）
  const future = withDate
    .filter((e) => ((e.end_datetime ?? e.datetime) ?? "").slice(0, 10) >= todayKey)
    .sort((a, b) => (a.datetime ?? "").localeCompare(b.datetime ?? ""));
  const past = withDate
    .filter((e) => ((e.end_datetime ?? e.datetime) ?? "").slice(0, 10) < todayKey)
    .sort((a, b) => (b.datetime ?? "").localeCompare(a.datetime ?? ""));

  return { next: future[0] ?? null, upcoming: future.slice(1), past };
}
