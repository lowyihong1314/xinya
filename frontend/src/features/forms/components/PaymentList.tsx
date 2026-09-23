import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Trash2 } from "lucide-react";

import { ApiError } from "@/shared/api/errors";
import { useAuth } from "@/shared/auth/AuthProvider";
import { Badge, Button, Select, useConfirm, useToast } from "@/shared/ui";
import { deletePayment, formKeys, paymentProofUrl, updatePaymentStatus } from "../api";
import type { FormPayment, PaymentStatus } from "../types";
import { PAYMENT_STATUS, formatAmount } from "./memberFields";

const STATUS_ORDER: readonly PaymentStatus[] = ["process", "checked", "fail"];

/**
 * 缴费记录。成员明细和「费用与缴费」两处都用它。
 *
 * ★ 改状态只认 **account_edit**（财政），form_edit 改不了 —— 后端有意的不对称：
 *   报名表管理员不能自己把自己的付款点成「已确认」。没这个权限时这里是只读的。
 */
export function PaymentList({
  formId,
  payments,
  showPayer = false,
}: {
  formId: number;
  payments: FormPayment[];
  /** 「费用与缴费」里一次看全表的付款，要显示是谁付的；成员明细里就不用了。 */
  showPayer?: boolean;
}) {
  const { has } = useAuth();
  const canSettle = has("account_edit");
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: formKeys.detail(formId) });
  };

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: PaymentStatus }) =>
      updatePaymentStatus(id, status),
    onSuccess: () => {
      toast.success("缴费状态已更新");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "更新失败"),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deletePayment(id),
    onSuccess: () => {
      toast.success("付款记录已移除");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "移除失败"),
  });

  if (payments.length === 0) {
    return <p className="text-sm text-muted-foreground">还没有缴费记录。</p>;
  }

  return (
    <ul className="space-y-2">
      {payments.map((payment) => (
        <li
          key={payment.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-sm)] border border-border bg-card px-3 py-2"
        >
          <span className="font-mono text-sm">{formatAmount(payment.amount)}</span>
          <span className="text-xs text-muted-foreground">{payment.payment_mode || "—"}</span>
          {showPayer ? (
            <span className="min-w-0 flex-1 truncate text-sm">{payment.name || "—"}</span>
          ) : (
            <span className="flex-1" />
          )}
          <span className="text-xs text-muted-foreground">{payment.date?.slice(0, 10) ?? "—"}</span>

          {/* 只改窄度不改字号：输入类控件小于 16px 时 iOS Safari 会放大页面且缩不回去 */}
          {canSettle ? (
            <Select
              className="h-9 w-28"
              aria-label={`缴费状态（${formatAmount(payment.amount)}）`}
              value={payment.status}
              disabled={setStatus.isPending}
              onChange={(e) =>
                setStatus.mutate({ id: payment.id, status: e.target.value as PaymentStatus })
              }
            >
              {STATUS_ORDER.map((status) => (
                <option key={status} value={status}>
                  {PAYMENT_STATUS[status].label}
                </option>
              ))}
            </Select>
          ) : (
            <Badge variant={PAYMENT_STATUS[payment.status].variant}>
              {PAYMENT_STATUS[payment.status].label}
            </Badge>
          )}

          {/* 截图另开一页看：图片接口要鉴权，塞进 <img> 在 APK 里会 401 裂图 */}
          {payment.proof_image_url ? (
            <Button asChild variant="ghost" size="sm">
              <a href={paymentProofUrl(payment.id)} target="_blank" rel="noreferrer">
                <ExternalLink />
                截图
              </a>
            </Button>
          ) : null}

          {/* 后端只允许删「失败」的记录，所以别的状态连按钮都不出 */}
          {canSettle && payment.status === "fail" ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="移除这笔付款记录"
              onClick={async () => {
                const ok = await confirm({
                  title: "移除这笔付款记录？",
                  description: `${payment.name || "—"} · ${formatAmount(payment.amount)}，连同截图一起删掉，无法撤销。`,
                  tone: "danger",
                  confirmText: "移除",
                });
                if (ok) remove.mutate(payment.id);
              }}
            >
              <Trash2 className="text-destructive" />
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
