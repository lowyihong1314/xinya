import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  FileDown,
  History,
  Paperclip,
  Receipt,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { useApiQuery } from "@/shared/api/useApiQuery";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui";
import {
  fahuiKeys,
  fetchOrder,
  fetchOrderLogs,
  fetchOrderPayments,
  orderQuotationUrl,
  orderReceiptImageUrl,
  paymentDocumentUrl,
} from "../api";
import { OrderPaymentBadge, PaymentStatusBadge } from "../components/PaymentBadges";
import {
  fieldLabel,
  formatMoney,
  formatOrderTime,
  formatTimestamp,
  paymentModeLabel,
} from "../format";
import type { FahuiOrderItem } from "../types";

export function FahuiOrderDetailPage() {
  const { orderId } = useParams();
  const id = Number(orderId);
  const enabled = Number.isFinite(id);

  const order = useApiQuery(fahuiKeys.order(id), () => fetchOrder(id), { enabled });
  // 收款与日志各自独立取：其中一条挂了（比如没有收款记录）不该把整页拖成错误态
  const payments = useApiQuery(fahuiKeys.orderPayments(id), () => fetchOrderPayments(id), { enabled });
  const logs = useApiQuery(fahuiKeys.orderLogs(id), () => fetchOrderLogs(id), { enabled });

  if (order.isPending) return <LoadingState />;
  if (order.isError) return <ErrorState error={order.error} onRetry={() => void order.refetch()} />;
  // isPending 为 false 不等于一定有数据（查询被禁用时也是 false，见 useApiQuery）
  if (!order.data) return <EmptyState title="找不到这张订单" description="链接里的单号不正确。" />;

  const data = order.data;
  const paid = data.status === "paid";
  // 这两条是页面里的次要区块，各自独立取数；拿不到就当空的，不该把整页拖成错误态
  const paymentRows = payments.data ?? [];
  const logRows = logs.data ?? [];

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link to="/fahui">
          <ArrowLeft />
          法会
        </Link>
      </Button>

      <PageHeader
        title={`订单 #${data.id}`}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{data.customer_name || data.name || "—"}</span>
            {data.phone ? <span className="font-mono">{data.phone}</span> : null}
            {data.version ? <Badge variant="neutral">{data.version}</Badge> : null}
            <OrderPaymentBadge status={data.status} />
            <span className="text-muted-foreground">{formatOrderTime(data.created_at)}</span>
          </span>
        }
        actions={
          <>
            {/* 报价单 / 收据是二进制附件，走直链交给浏览器下载（见 api.ts 的说明） */}
            <Button asChild variant="outline" size="sm">
              <a href={orderQuotationUrl(data.id)} target="_blank" rel="noreferrer">
                <FileDown />
                报价单
              </a>
            </Button>
            {/* 后端要求「已有审核通过的付款」才给收据，没到这一步就不显示按钮 */}
            {paid ? (
              <Button asChild variant="outline" size="sm">
                <a href={orderReceiptImageUrl(data.id)} target="_blank" rel="noreferrer">
                  <Receipt />
                  收据
                </a>
              </Button>
            ) : null}
            {data.prev_id ? (
              <Button asChild variant="outline" size="icon" aria-label="上一张单">
                <Link to={`/fahui/orders/${data.prev_id}`}>
                  <ChevronLeft />
                </Link>
              </Button>
            ) : null}
            {data.next_id ? (
              <Button asChild variant="outline" size="icon" aria-label="下一张单">
                <Link to={`/fahui/orders/${data.next_id}`}>
                  <ChevronRight />
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>订单资料</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Field label="功德主" value={data.customer_name} />
              <Field label="联络人" value={data.name} />
              <Field label="电话" value={data.phone} mono />
              <Field label="Email" value={data.email} />
              <Field label="维护人" value={data.maintainer_name} />
              {/* order_status 是订单**流程**状态（自由字符串），空值按 Draft 算 —— 和付款状态无关 */}
              <Field label="订单状态" value={data.order_status || "Draft"} />
              <Field label="牌位数" value={String(data.order_items.length)} />
              <Field label="总德金" value={formatMoney(data.total_amount)} mono />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>牌位明细</CardTitle>
          </CardHeader>
          <CardContent>
            {data.order_items.length === 0 ? (
              <EmptyState title="这张单还没有牌位" className="min-h-24" />
            ) : (
              <ul className="space-y-2">
                {data.order_items.map((item) => (
                  <OrderItemCard key={item.id} item={item} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>收款记录</CardTitle>
          </CardHeader>
          <CardContent className="p-0 pt-0">
            {payments.isPending ? (
              <div className="space-y-1.5 p-4">
                {Array.from({ length: 2 }, (_, i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : payments.isError ? (
              <ErrorState error={payments.error} onRetry={() => void payments.refetch()} />
            ) : paymentRows.length === 0 ? (
              <EmptyState title="还没有收款记录" className="min-h-24" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">金额</TableHead>
                    <TableHead>方式</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>提交时间</TableHead>
                    <TableHead>审核</TableHead>
                    <TableHead>凭证</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paymentRows.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                        {formatMoney(payment.total_price)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {paymentModeLabel(payment.payment_mode)}
                        {/* order_id 为 null = 合并付款，这一笔同时盖了好几张单 */}
                        {payment.grouped_order_ids.length > 1 ? (
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            合并 {payment.grouped_order_ids.length} 单
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <PaymentStatusBadge status={payment.status} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatTimestamp(payment.created_at)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {payment.valid_by || "—"}
                      </TableCell>
                      <TableCell>
                        {payment.document ? (
                          <Button asChild variant="ghost" size="sm">
                            <a href={paymentDocumentUrl(payment.id)} target="_blank" rel="noreferrer">
                              <Paperclip />
                              查看
                            </a>
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="size-4 text-muted-foreground" aria-hidden />
              改动记录
            </CardTitle>
          </CardHeader>
          <CardContent>
            {logs.isPending ? (
              <Skeleton className="h-20" />
            ) : logs.isError ? (
              <ErrorState error={logs.error} onRetry={() => void logs.refetch()} />
            ) : logRows.length === 0 ? (
              // 旧数据没有日志，这是正常的，不是出错
              <EmptyState title="没有改动记录" className="min-h-24" />
            ) : (
              <ol className="space-y-2 text-sm">
                {logRows.map((log) => (
                  <li key={log.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                      {formatTimestamp(log.created_at)}
                    </span>
                    <span className="whitespace-nowrap font-medium">{log.actor}</span>
                    {/* summary 是后端写好的一句人话，优先用它；没有才退回「字段：旧 → 新」 */}
                    <span className="min-w-0">
                      {log.summary || `${fieldLabel(log.field ?? "")}：${log.old_value ?? "空"} → ${log.new_value ?? "空"}`}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={mono ? "min-w-0 font-mono" : "min-w-0"}>{value || "—"}</dd>
    </div>
  );
}

/**
 * 一条牌位。
 * ★ `item_form_data` 在详情里是**对象**（field_name → [{val, val_id}]），
 *   不是数组 —— 列表那套序列化才是数组。详见 types.ts 的注释。
 */
function OrderItemCard({ item }: { item: FahuiOrderItem }) {
  const fields = Object.entries(item.item_form_data);
  // 一条牌位可能被印在多张打印页上，每张页又可能贴在不同的板 —— 摊平成一串位置
  const positions = item.item_location.flatMap((loc) =>
    loc.boards.map((board) =>
      [board.board_name, board.position_label].filter(Boolean).join(" ") || `#${board.board_id}`,
    ),
  );

  return (
    <li className="rounded-[var(--radius-sm)] border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 font-medium">
          {item.item_name || item.code || "—"}
          {item.code ? (
            <span className="ml-1.5 font-mono text-xs text-muted-foreground">{item.code}</span>
          ) : null}
        </p>
        <span className="shrink-0 font-mono tabular-nums">{formatMoney(item.price)}</span>
      </div>

      {fields.length > 0 ? (
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {fields.map(([name, values]) => (
            <div key={name} className="flex gap-2">
              <dt className="shrink-0 text-muted-foreground">{fieldLabel(name)}</dt>
              <dd className="min-w-0">{values.map((v) => v.val).filter(Boolean).join("、") || "—"}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {positions.length > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">板位：{positions.join("、")}</p>
      ) : null}
    </li>
  );
}
