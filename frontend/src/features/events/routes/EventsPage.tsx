import { CalendarDays, MapPin, Search } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Link } from "react-router-dom";

import { useApiQuery } from "@/shared/api/useApiQuery";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Skeleton,
} from "@/shared/ui";
import { eventKeys, fetchEvents } from "../api";

export function EventsPage() {
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const search = useDeferredValue(keyword);

  const list = useApiQuery(
    eventKeys.list({ page, search }),
    () => fetchEvents({ page, search }),
    { placeholderData: (prev) => prev },
  );

  return (
    <div>
      <PageHeader
        title="活动"
        description={list.data ? `共 ${list.data.total} 场` : undefined}
      />

      <div className="relative mb-4">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value);
            setPage(1); // 换关键词要回第一页，否则会停在一个空页上
          }}
          placeholder="搜索活动名称"
          className="pl-9"
          aria-label="搜索活动"
        />
      </div>

      {list.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data?.data.length ? (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.data.data.map((ev) => (
              <li key={ev.id}>
                <Card className="h-full transition-colors hover:border-primary/40">
                  <Link to={`/events/${ev.id}`} className="block h-full p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="min-w-0 font-medium leading-snug">{ev.event_name}</h3>
                      {ev.is_public ? <Badge variant="primary">公开</Badge> : null}
                    </div>
                    <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                      <CalendarDays className="size-3.5 shrink-0" aria-hidden />
                      {formatDate(ev.datetime)}
                    </p>
                    {ev.location ? (
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                        <MapPin className="size-3.5 shrink-0" aria-hidden />
                        <span className="truncate">{ev.location_name || ev.location}</span>
                      </p>
                    ) : null}
                  </Link>
                </Card>
              </li>
            ))}
          </ul>

          {list.data.total_pages > 1 ? (
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={!list.data.has_prev}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <span className="text-sm text-muted-foreground">
                {list.data.page_num} / {list.data.total_pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!list.data.has_next}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState title={keyword ? "没有匹配的活动" : "还没有活动"} />
      )}
    </div>
  );
}

/** 后端给的是 "YYYY-MM-DD HH:MM:SS"。只取日期部分，时间在详情页显示。 */
function formatDate(value: string | null): string {
  if (!value) return "—";
  return value.slice(0, 10).replace(/-/g, "/");
}
