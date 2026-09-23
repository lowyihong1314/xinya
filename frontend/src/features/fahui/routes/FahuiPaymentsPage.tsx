import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Paperclip, RotateCcw, Search, Trash2, X } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/shared/api/errors";
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
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useConfirm,
  useToast,
} from "@/shared/ui";
import {
  approvePayment,
  deletePayment,
  fahuiKeys,
  fetchReviewPayments,
  paymentDocumentUrl,
  revokePayment,
  withdrawPayment,
} from "../api";
import { PaymentStatusBadge } from "../components/PaymentBadges";
import { formatMoney, formatTimestamp, paymentModeLabel, paymentTypeLabel } from "../format";
import type { PaymentRecordStatus, ReviewPayment } from "../types";

type StatusFilter = PaymentRecordStatus | "all";
type ReviewAction = "approve" | "revoke" | "withdraw";

const TABS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: "pending", label: "待审核" },
  { value: "approved", label: "已批准" },
  { value: "rejected", label: "已拒绝" },
  { value: "all", label: "全部" },
];

export function FahuiPaymentsPage() {
  const { has } = useAuth();
  // 读列表只要 account_read，**改**状态要 account_edit —— 后端两条路由的权限不同
  const canEdit = has("account_edit");
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const [tab, setTab] = useState<StatusFilter>("pending");
  const [keyword, setKeyword] = useState("");
  const search = useDeferredValue(keyword);

  const list = useApiQuery(fahuiKeys.reviewPayments(), fetchReviewPayments);

  // 审核会联动订单状态（revoke / approve 都会重算 orders.status），所以订单列表和
  // 订单详情也要跟着失效。整个 ["fahui"] 前缀一把刷最省心，版本清单那几条本来就很轻。
  const invalidate = () => void qc.invalidateQueries({ queryKey: fahuiKeys.all });

  const review = useMutation({
    mutationFn: ({ id, action }: { id: number; action: ReviewAction }) => {
      if (action === "approve") return approvePayment(id);
      if (action === "revoke") return revokePayment(id);
      return withdrawPayment(id);
    },
    onSuccess: () => {
      toast.success("已更新审核状态");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "操作失败"),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deletePayment(id),
    onSuccess: () => {
      toast.success("已删除这笔付款");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "删除失败"),
  });

  const all = list.data ?? [];
  const counts: Record<StatusFilter, number> = {
    all: all.length,
    pending: all.filter((p) => p.status === "pending").length,
    approved: all.filter((p) => p.status === "approved").length,
    rejected: all.filter((p) => p.status === "rejected").length,
  };
  // 后端一次把全部付款发下来（不分页、不过滤），所以筛选和搜索都在前端做
  const rows = all.filter((p) => (tab === "all" || p.status === tab) && matches(p, search));

  const askDelete = async (payment: ReviewPayment) => {
    const ok = await confirm({
      title: "删除这笔付款？",
      description: `${payment.payer_name || "付款人"} · RM ${formatMoney(payment.amount)}。上传的凭证文件会一起删掉，这一步不可撤销。`,
      tone: "danger",
      confirmText: "删除",
    });
    if (ok) remove.mutate(payment.id);
  };

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link to="/fahui">
          <ArrowLeft />
          法会
        </Link>
      </Button>

      <PageHeader
        title="收款审核"
        description={
          canEdit ? "牌位与点灯的付款凭证都在这里审核" : "只读：审核需要 account_edit 权限"
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as StatusFilter)}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
              {counts[t.value] > 0 ? (
                <span className="ml-1.5 text-xs tabular-nums opacity-70">{counts[t.value]}</span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* 四个页签共用同一份数据和同一张表，内容由上面的 rows 决定 */}
        <TabsContent value={tab}>
          <div className="relative mb-4">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索付款人、电话或单号"
              className="pl-9"
              aria-label="搜索付款"
            />
          </div>

          {list.isPending ? (
            <div className="space-y-1.5">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState title={search ? "没有匹配的付款" : "这里是空的"} />
          ) : (
            <Card>
              <CardContent className="p-0 pt-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>付款人</TableHead>
                      <TableHead>订单</TableHead>
                      <TableHead className="text-right">金额</TableHead>
                      <TableHead>方式</TableHead>
                      <TableHead>提交时间</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>凭证</TableHead>
                      {canEdit ? <TableHead /> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell className="max-w-[12rem]">
                          <p className="truncate">{payment.payer_name || "—"}</p>
                          {payment.phone ? (
                            <p className="truncate font-mono text-xs text-muted-foreground">
                              {payment.phone}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className="flex items-center gap-1.5">
                            <Badge variant={payment.type === "lamp" ? "info" : "primary"}>
                              {paymentTypeLabel(payment.type)}
                            </Badge>
                            {/* 合并付款没有 order_id（一笔钱盖多张单），只能靠 note 说明 */}
                            {payment.order_id ? (
                              <Link
                                to={`/fahui/orders/${payment.order_id}`}
                                className="font-mono text-primary underline-offset-4 hover:underline"
                              >
                                #{payment.order_id}
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                          {formatMoney(payment.amount)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {paymentModeLabel(payment.payment_mode)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatTimestamp(payment.created_at)}
                        </TableCell>
                        <TableCell>
                          <span className="flex flex-col gap-0.5">
                            <PaymentStatusBadge status={payment.status} />
                            {payment.valid_by ? (
                              <span className="text-xs text-muted-foreground">
                                {payment.valid_by}
                              </span>
                            ) : null}
                          </span>
                        </TableCell>
                        <TableCell>
                          {payment.document ? (
                            <Button asChild variant="ghost" size="sm">
                              <a
                                href={paymentDocumentUrl(payment.id)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <Paperclip />
                                查看
                              </a>
                            </Button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        {canEdit ? (
                          <TableCell>
                            <div className="flex gap-1">
                              {payment.status !== "approved" ? (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label="通过"
                                  disabled={review.isPending}
                                  onClick={() => review.mutate({ id: payment.id, action: "approve" })}
                                >
                                  <Check className="text-success" />
                                </Button>
                              ) : null}
                              {payment.status !== "rejected" ? (
                                // ★ 撤回：只把这条付款标成「已拒绝」，**订单状态不动**。
                                //   和下面的「退回待审」不是同一件事，后端也是两条路由。
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label="撤回（标为已拒绝）"
                                  disabled={review.isPending}
                                  onClick={() => review.mutate({ id: payment.id, action: "withdraw" })}
                                >
                                  <X className="text-destructive" />
                                </Button>
                              ) : null}
                              {payment.status !== "pending" ? (
                                // 退回待审：会联动订单状态一起重算
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label="退回待审核"
                                  disabled={review.isPending}
                                  onClick={() => review.mutate({ id: payment.id, action: "revoke" })}
                                >
                                  <RotateCcw />
                                </Button>
                              ) : null}
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label="删除"
                                disabled={remove.isPending}
                                onClick={() => void askDelete(payment)}
                              >
                                <Trash2 className="text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** 前端搜索：付款人、电话、单号、备注。空关键词一律通过。 */
function matches(payment: ReviewPayment, keyword: string): boolean {
  const q = keyword.trim().toLowerCase();
  if (!q) return true;
  return [
    payment.payer_name,
    payment.phone,
    payment.note,
    payment.order?.customer_name,
    payment.order_id != null ? String(payment.order_id) : null,
  ].some((value) => value?.toLowerCase().includes(q));
}
