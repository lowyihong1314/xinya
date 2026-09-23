import { cn } from "@/shared/lib/cn";
import {
  Badge,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui";

import type { QuizEntry, QuizStatus } from "../types";

/** 空榜的说法跟着状态走：没发布时"还没开始"，抢答中却没人则是"等第一个人"。 */
const EMPTY_HINT: Record<QuizStatus, string> = {
  draft: "发布之后现场的人才能抢",
  waiting: "倒数结束就能抢了",
  open: "等第一个人按下去",
  closed: "这一场没有人抢到",
};

export function QuizLeaderboard({
  entries,
  status,
  /** 我自己的 guest_id。传了就在榜上把我那一行标出来（抢答页用，主持台不传）。 */
  mineGuestId,
}: {
  entries: QuizEntry[];
  status: QuizStatus;
  mineGuestId?: string;
}) {
  if (entries.length === 0) {
    return <EmptyState title="还没有人抢答" description={EMPTY_HINT[status] ?? ""} className="py-10" />;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-14">名次</TableHead>
          <TableHead>名字</TableHead>
          <TableHead className="text-right">比截止晚</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => {
          const mine = Boolean(mineGuestId) && entry.guest_id === mineGuestId;
          return (
            <TableRow key={entry.guest_id} className={cn(mine && "bg-primary-soft")}>
              <TableCell>
                {/* 前三名给个实心标，现场大屏扫一眼就能看出来 */}
                <Badge variant={entry.rank <= 3 ? "primary" : "neutral"}>{entry.rank}</Badge>
              </TableCell>
              <TableCell className="max-w-[12rem] truncate font-medium">
                {entry.guest_name}
                {mine ? <span className="ml-2 text-xs text-muted-foreground">（我）</span> : null}
              </TableCell>
              {/* delta 是后端算的"比截止时刻晚了多少毫秒"，不是前端两个时间相减 —— 
                  前端两边的时钟本来就对不齐，自己算会算出负数。 */}
              <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                +{entry.delta_from_cutoff_ms}ms
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
