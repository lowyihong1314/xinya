import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { ApiError } from "@/shared/api/errors";
import { useApiQuery } from "@/shared/api/useApiQuery";
import { useAuth } from "@/shared/auth/AuthProvider";
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  LoadingState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useConfirm,
  useToast,
} from "@/shared/ui";
import { addFee, deleteFee, fetchFees, formKeys, updateFee } from "../api";
import type { FeeInput } from "../api";
import type { FormFee, RegisFormDetail } from "../types";
import { FeeFormDialog } from "./FeeFormDialog";
import { PaymentList } from "./PaymentList";
import { feeAgeRange, formatAmount } from "./memberFields";

/** 「费用与缴费」：这张表的收费项配置 + 全表的缴费记录。 */
export function FeesPanel({ form }: { form: RegisFormDetail }) {
  const { has } = useAuth();
  const canEdit = has("form_edit");
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  /** undefined = 对话框没开；null = 新增；FormFee = 改这一条。 */
  const [editing, setEditing] = useState<FormFee | null | undefined>(undefined);

  // 详情接口已经带了 form.fees，这里仍单独拉一份：增删改之后只失效这一小块，
  // 不用把整张表（含全部成员）重新拉一遍。
  const fees = useApiQuery(formKeys.fees(form.id), () => fetchFees(form.id));

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: formKeys.fees(form.id) });
    void qc.invalidateQueries({ queryKey: formKeys.detail(form.id) });
  };

  const save = useMutation({
    mutationFn: ({ fee, input }: { fee: FormFee | null; input: FeeInput }) =>
      fee ? updateFee(fee.id, input) : addFee(form.id, input),
    onSuccess: () => {
      toast.success("收费项已保存");
      setEditing(undefined);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "保存失败"),
  });

  const remove = useMutation({
    mutationFn: (feeId: number) => deleteFee(feeId),
    onSuccess: () => {
      toast.success("收费项已删除");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "删除失败"),
  });

  /**
   * 全表的缴费记录。
   * ★ 两条来源：财政（account_read/account_edit）能直接拿到 form.payments；
   *   其余有成员查看权的人只能从每个成员身上收集。同一批记录，谁有值用谁 ——
   *   只认 form.payments 的话，报名表管理员这一块会一片空白。
   */
  const payments = useMemo(
    () => form.payments ?? (form.members ?? []).flatMap((m) => m.payments ?? []),
    [form.payments, form.members],
  );

  const settled = payments
    .filter((p) => p.status === "checked")
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">收费项</h3>
          {canEdit ? (
            <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
              <Plus />
              新增
            </Button>
          ) : null}
        </div>

        {fees.isPending ? (
          <LoadingState className="min-h-24" />
        ) : fees.isError ? (
          <ErrorState error={fees.error} onRetry={() => void fees.refetch()} />
        ) : fees.data?.fees.length ? (
          <Card>
            <CardContent className="p-0 pt-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>类别</TableHead>
                    <TableHead>适用年龄</TableHead>
                    <TableHead className="text-right">金额</TableHead>
                    <TableHead>说明</TableHead>
                    {canEdit ? <TableHead /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fees.data.fees.map((fee) => (
                    <TableRow key={fee.id}>
                      <TableCell className="font-medium">{fee.category}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {feeAgeRange(fee.age_range_from, fee.age_range_to)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono">
                        {formatAmount(fee.amount)}
                      </TableCell>
                      <TableCell className="max-w-[18rem] truncate text-muted-foreground">
                        {fee.description || "—"}
                      </TableCell>
                      {canEdit ? (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`修改 ${fee.category}`}
                              onClick={() => setEditing(fee)}
                            >
                              <Pencil />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`删除 ${fee.category}`}
                              onClick={async () => {
                                const ok = await confirm({
                                  title: `删除收费项「${fee.category}」？`,
                                  description: "已经产生的付款记录不受影响，但付款页以后挑不到这一条了。",
                                  tone: "danger",
                                  confirmText: "删除",
                                });
                                if (ok) remove.mutate(fee.id);
                              }}
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
        ) : (
          <EmptyState
            title="没有收费项"
            description={canEdit ? "没有收费项时这张表是免费报名。" : undefined}
          />
        )}
      </section>

      <section>
        <h3 className="mb-3 text-sm font-medium text-muted-foreground">
          缴费记录 · 共 {payments.length} 笔，已确认 {formatAmount(settled)}
        </h3>
        <PaymentList formId={form.id} payments={payments} showPayer />
      </section>

      {editing !== undefined ? (
        <FeeFormDialog
          fee={editing}
          submitting={save.isPending}
          onClose={() => setEditing(undefined)}
          onSubmit={(input) => save.mutate({ fee: editing, input })}
        />
      ) : null}
    </div>
  );
}
