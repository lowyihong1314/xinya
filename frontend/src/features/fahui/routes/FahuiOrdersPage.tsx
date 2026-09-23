import { ChevronDown, ChevronUp, ChevronsUpDown, Search, Wallet } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useApiQuery } from "@/shared/api/useApiQuery";
import { useAuth } from "@/shared/auth/AuthProvider";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui";
import { fahuiKeys, fetchOpenWindows, fetchVersions, searchOrders, type OrderSearchParams } from "../api";
import { OrderPaymentBadge } from "../components/PaymentBadges";
import {
  BOARD_STATUS_LABELS,
  DELETED_VERSION,
  defaultVersion,
  formatMoney,
  formatOrderTime,
  versionLabel,
} from "../format";
import type { FahuiOrderRow, OrderSortKey } from "../types";

const PER_PAGE = 20;

export function FahuiOrdersPage() {
  const { hasAny } = useAuth();
  const navigate = useNavigate();

  const [version, setVersion] = useState("");
  const [keyword, setKeyword] = useState("");
  const search = useDeferredValue(keyword);
  const [page, setPage] = useState(1);
  // sort 为 null = 用后端的默认排序（创建时间倒序），不是「按 id 升序」
  const [sort, setSort] = useState<OrderSortKey | null>(null);
  const [direction, setDirection] = useState<"asc" | "desc">("asc");

  const versions = useApiQuery(fahuiKeys.versions(), fetchVersions);
  // 版本没选过就跟着清单走（最新的一届），选过就听用户的 —— 派生值，不用 effect 去同步
  const activeVersion = version || defaultVersion(versions.data);

  const openWindows = useApiQuery(fahuiKeys.openWindows(), fetchOpenWindows);
  const ylpWindow = openWindows.data?.items.find((item) => item.fahui_key === "ylp");

  const params: OrderSearchParams = {
    version: activeVersion,
    search,
    page,
    perPage: PER_PAGE,
    sort: sort ?? undefined,
    direction: sort ? direction : undefined,
  };
  const list = useApiQuery(fahuiKeys.orders(params), () => searchOrders(params), {
    // 版本清单还没回来时不要空着 version 打过去 —— 后端会回 400「version is required」
    enabled: Boolean(activeVersion),
    placeholderData: (prev) => prev,
  });

  const toggleSort = (key: OrderSortKey) => {
    if (sort === key) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(key);
      setDirection("asc");
    }
    setPage(1);
  };

  const pagination = list.data?.pagination;
  // isPending 为 false 不等于一定有数据（查询被禁用时也是 false，见 useApiQuery）
  const rows = list.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="法会"
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {pagination ? <span>共 {pagination.total} 单</span> : null}
            {ylpWindow ? (
              <Badge variant={ylpWindow.is_open ? "success" : "neutral"}>
                {ylpWindow.is_open ? "登记开放中" : "登记已关闭"}
              </Badge>
            ) : null}
            {activeVersion === DELETED_VERSION ? (
              <Badge variant="danger">正在看已删除的单</Badge>
            ) : null}
          </span>
        }
        actions={
          hasAny(["account_read", "account_edit"]) ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/fahui/payments">
                <Wallet />
                收款审核
              </Link>
            </Button>
          ) : null
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Select
          value={activeVersion}
          onChange={(e) => {
            setVersion(e.target.value);
            setPage(1); // 换版本要回第一页，否则会停在一个空页上
          }}
          className="sm:w-48"
          aria-label="法会版本"
          disabled={versions.isPending}
        >
          {/* 版本清单里含 "DELETE"（软删除桶），照样列出来但换个说法 */}
          {(versions.data ?? []).map((v) => (
            <option key={v} value={v}>
              {versionLabel(v)}
            </option>
          ))}
        </Select>

        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
            placeholder="搜索单号、功德主、电话或牌位内容"
            className="pl-9"
            aria-label="搜索订单"
          />
        </div>
      </div>

      {versions.isError ? (
        <ErrorState error={versions.error} onRetry={() => void versions.refetch()} />
      ) : list.isPending ? (
        <div className="space-y-1.5">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={search ? "没有匹配的订单" : "这个版本还没有订单"} />
      ) : (
        <>
          <Card>
            <CardContent className="p-0 pt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHead label="单号" sortKey="id" sort={sort} direction={direction} onSort={toggleSort} />
                    <SortHead label="功德主" sortKey="customer" sort={sort} direction={direction} onSort={toggleSort} />
                    <SortHead label="电话" sortKey="phone" sort={sort} direction={direction} onSort={toggleSort} />
                    <SortHead
                      label="金额"
                      sortKey="total"
                      sort={sort}
                      direction={direction}
                      onSort={toggleSort}
                      className="text-right"
                    />
                    <SortHead label="付款" sortKey="status" sort={sort} direction={direction} onSort={toggleSort} />
                    <TableHead>牌位</TableHead>
                    <SortHead label="维护人" sortKey="maintainer" sort={sort} direction={direction} onSort={toggleSort} />
                    <SortHead label="创建" sortKey="created_at" sort={sort} direction={direction} onSort={toggleSort} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((order) => (
                    <TableRow
                      key={order.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/fahui/orders/${order.id}`)}
                    >
                      <TableCell className="whitespace-nowrap">
                        {/* 整行可点是给手机用的；这个链接是给键盘和「新标签页打开」用的 */}
                        <Link
                          to={`/fahui/orders/${order.id}`}
                          className="font-mono text-primary underline-offset-4 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          #{order.id}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-[12rem] truncate">
                        {order.customer_name || order.name || "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-muted-foreground">
                        {order.phone || "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                        {formatMoney(order.total_amount)}
                      </TableCell>
                      <TableCell>
                        <OrderPaymentBadge status={order.status} />
                      </TableCell>
                      <TableCell>
                        <BoardStatusCell board={order.board_status} />
                      </TableCell>
                      <TableCell className="max-w-[10rem] truncate text-muted-foreground">
                        {order.maintainer_name || "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatOrderTime(order.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {pagination && pagination.pages > 1 ? (
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={!pagination.has_prev}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <span className="text-sm text-muted-foreground">
                {pagination.page} / {pagination.pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={!pagination.has_next}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/** 可排序的表头。点同一列切换升降，点别的列从升序重来。 */
function SortHead({
  label,
  sortKey,
  sort,
  direction,
  onSort,
  className,
}: {
  label: string;
  sortKey: OrderSortKey;
  sort: OrderSortKey | null;
  direction: "asc" | "desc";
  onSort: (key: OrderSortKey) => void;
  className?: string;
}) {
  const active = sort === sortKey;
  return (
    <TableHead className={className}>
      <Button
        variant="ghost"
        size="sm"
        className="-mx-2 h-8 px-2 font-medium text-muted-foreground"
        onClick={() => onSort(sortKey)}
        aria-label={`按${label}排序`}
      >
        {label}
        {active ? (
          direction === "asc" ? (
            <ChevronUp />
          ) : (
            <ChevronDown />
          )
        ) : (
          <ChevronsUpDown className="opacity-40" />
        )}
      </Button>
    </TableHead>
  );
}

/**
 * 牌位进度。
 * ★ 分母 total **不含 D 开头的项目**（随缘供斋那类不出牌位），所以
 *   「2/2 已上板」的单里可能还有一笔乐捐 —— 这是对的，不是漏算。
 */
function BoardStatusCell({ board }: { board: FahuiOrderRow["board_status"] }) {
  const variant =
    board.status === "all"
      ? "success"
      : board.status === "partial"
        ? "warning"
        : board.status === "empty"
          ? "neutral"
          : "info";
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <Badge variant={variant}>{BOARD_STATUS_LABELS[board.status] ?? board.status}</Badge>
      {board.total > 0 ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          {board.placed}/{board.total}
        </span>
      ) : null}
    </span>
  );
}
