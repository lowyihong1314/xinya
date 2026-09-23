import { Download, RefreshCw, SkipBack, SkipForward } from "lucide-react";
import { useMemo, useState } from "react";

import { useApiQuery } from "@/shared/api/useApiQuery";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from "@/shared/ui";
import { cctvKeys, fetchRecordings, recordingUrl } from "../api";
import { PlayerFrame } from "../components/PlayerFrame";
import { ViewSwitch } from "../components/ViewSwitch";
import type { Recording } from "../types";

export function CctvPlaybackPage() {
  const list = useApiQuery(cctvKeys.recordings(), fetchRecordings);
  // 只记住**文件名**，不记整条记录：刷新后拿到的是新对象，存对象会让选中的那条
  // 和列表里的那条不是同一个（时长会被重算），界面上就出现两份不一致的时间。
  const [selected, setSelected] = useState<string | null>(null);

  const items = list.data ?? [];
  // 找不到（没选过 / 选中的那段被清理任务删了）就退回最新一段，而不是变成空白。
  const index = Math.max(0, items.findIndex((r) => r.name === selected));
  const current = items[index] ?? null;
  // 列表最新在前：往后是更早的片段，往前是更晚的。
  const older = items[index + 1] ?? null;
  const newer = index > 0 ? items[index - 1] ?? null : null;

  const groups = useMemo(() => groupByDate(items), [items]);

  return (
    <div>
      <PageHeader
        title="监控回放"
        description={list.data ? `共 ${list.data.length} 段录像` : undefined}
        actions={<ViewSwitch current="playback" />}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div>
          <PlayerFrame
            badge={
              current ? (
                <Badge variant="neutral">{timeRangeLabel(current)}</Badge>
              ) : null
            }
            actions={
              current ? (
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="text-white hover:bg-white/15 hover:text-white"
                >
                  {/* 直链下载：这个地址是 nginx 在域名根上发的静态文件，不经过后端。 */}
                  <a href={recordingUrl(current)} download={current.name}>
                    <Download />
                    下载
                  </a>
                </Button>
              ) : null
            }
          >
            {current ? (
              <video
                // key 换了才会重新加载 src，否则切片段时画面停在上一段的最后一帧。
                key={current.name}
                src={recordingUrl(current)}
                className="absolute inset-0 size-full object-contain"
                controls
                autoPlay
                playsInline
                // 播完接着放更晚的一段，等于顺着时间轴往下看。
                onEnded={() => newer && setSelected(newer.name)}
              />
            ) : (
              <p className="absolute inset-x-6 top-1/2 -translate-y-1/2 text-center text-sm text-white">
                {list.isPending ? "加载录像…" : "还没有可播放的录像"}
              </p>
            )}
          </PlayerFrame>

          {current ? (
            <div className="mt-3 flex items-center justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!older}
                onClick={() => older && setSelected(older.name)}
              >
                <SkipBack />
                上一段
              </Button>
              <span className="truncate text-sm text-muted-foreground">
                {dateLabel(current.start)} · {formatSize(current.size)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!newer}
                onClick={() => newer && setSelected(newer.name)}
              >
                下一段
                <SkipForward />
              </Button>
            </div>
          ) : null}
        </div>

        <Card className="flex max-h-[32rem] flex-col overflow-hidden lg:max-h-[calc(100svh-12rem)]">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <span className="text-sm font-medium">录像片段</span>
            <Button
              variant="ghost"
              size="sm"
              loading={list.isFetching}
              onClick={() => void list.refetch()}
            >
              <RefreshCw />
              刷新
            </Button>
          </div>

          {list.isPending ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-11" />
              ))}
            </div>
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} className="py-10" />
          ) : groups.length === 0 ? (
            <EmptyState
              title="暂无录像"
              // 正在写入的那一段后端不给（moov 还没落盘，播不了），所以刚开始录时这里是空的。
              description="最新的一段正在录制，要等它写完才会出现"
              className="py-10"
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {groups.map((group) => (
                <div key={group.label}>
                  <p className="sticky top-0 z-10 bg-card px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    {group.label}
                  </p>
                  {group.rows.map((row) => (
                    <Button
                      key={row.name}
                      variant={row.name === current?.name ? "secondary" : "ghost"}
                      className="h-auto w-full justify-between gap-2 px-2 py-2 font-normal"
                      onClick={() => setSelected(row.name)}
                    >
                      <span className="font-mono text-xs">{timeRangeLabel(row)}</span>
                      <span className="text-xs text-muted-foreground">
                        {row.duration ? `${Math.round(row.duration / 60)} 分钟 · ` : ""}
                        {formatSize(row.size)}
                      </span>
                    </Button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ───────────────── 时间与大小的显示 ─────────────────
//
// 后端给的 start 带 UTC 时区标记，下面一律按**浏览器本地时区**显示 ——
// 看监控的人想的是「我这儿几点」，不是服务器几点。

function groupByDate(items: readonly Recording[]): { label: string; rows: Recording[] }[] {
  const out: { label: string; rows: Recording[] }[] = [];
  for (const row of items) {
    const label = dateLabel(row.start);
    const last = out[out.length - 1];
    // 列表已经按时间排好，相邻同一天的直接并进上一组，不用先建 Map 再排序。
    if (last && last.label === label) last.rows.push(row);
    else out.push({ label, rows: [row] });
  }
  return out;
}

function parseStart(start: string | null): Date | null {
  if (!start) return null;
  const d = new Date(start);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateLabel(start: string | null): string {
  const d = parseStart(start);
  if (!d) return "未知日期";
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return "今天";
  if (sameDay(d, yesterday)) return "昨天";
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** "15:20 – 15:35"；没有时长就只给开始时间；连开始时间都解析不出来就退回文件名。 */
function timeRangeLabel(row: Recording): string {
  const start = parseStart(row.start);
  if (!start) return row.name;
  const hhmm = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  if (!row.duration) return hhmm(start);
  return `${hhmm(start)} – ${hhmm(new Date(start.getTime() + row.duration * 1000))}`;
}

function formatSize(bytes: number): string {
  const gb = 1024 ** 3;
  if (bytes >= gb) return `${(bytes / gb).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}
