import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Lock, X } from "lucide-react";
import { useState } from "react";

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
  LoadingState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useConfirm,
  useToast,
} from "@/shared/ui";
import { claimKeys, decideClaim, fetchClaims } from "../api";
import type { Claim } from "../types";

export function ClaimsPage() {
  const { has } = useAuth();
  const canApprove = has("account_edit") || has("council_approve");
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<number | null>(null);

  const list = useApiQuery(claimKeys.list(), fetchClaims);

  const decide = useMutation({
    mutationFn: ({ id, approved }: { id: number; approved: boolean }) =>
      decideClaim(id, { decision: approved ? "approve" : "reject" }),
    onSuccess: () => {
      toast.success("已记录你的审批");
      void qc.invalidateQueries({ queryKey: claimKeys.list() });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "操作失败"),
  });

  if (list.isPending) return <LoadingState />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;

  const claims = list.data.data;

  return (
    <div>
      <PageHeader
        title="报销"
        description={
          list.data.can_view_all ? `全部 ${list.data.count} 单` : `我的 ${list.data.count} 单`
        }
      />

      {claims.length === 0 ? (
        <EmptyState title="还没有报销单" />
      ) : (
        <Card>
          <CardContent className="p-0 pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>申请人</TableHead>
                  <TableHead>用途</TableHead>
                  <TableHead className="text-right">金额</TableHead>
                  <TableHead>审批</TableHead>
                  <TableHead>日期</TableHead>
                  {canApprove ? <TableHead /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {claims.map((claim) => (
                  <ClaimRow
                    key={claim.id}
                    claim={claim}
                    canApprove={canApprove}
                    expanded={expanded === claim.id}
                    onToggle={() => setExpanded((v) => (v === claim.id ? null : claim.id))}
                    onDecide={async (approved) => {
                      const ok = await confirm({
                        title: approved ? "通过这张报销单？" : "否决这张报销单？",
                        description: `${claim.applicant_name || "申请人"} · ${formatAmount(claim.amount)}`,
                        tone: approved ? "default" : "danger",
                        confirmText: approved ? "通过" : "否决",
                      });
                      if (ok) decide.mutate({ id: claim.id, approved });
                    }}
                  />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ClaimRow({
  claim,
  canApprove,
  expanded,
  onToggle,
  onDecide,
}: {
  claim: Claim;
  canApprove: boolean;
  expanded: boolean;
  onToggle: () => void;
  onDecide: (approved: boolean) => void;
}) {
  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell className="whitespace-nowrap">{claim.applicant_name || "—"}</TableCell>
        <TableCell className="max-w-[20rem] truncate">{claim.purpose || "—"}</TableCell>
        <TableCell className="whitespace-nowrap text-right font-mono">
          {formatAmount(claim.amount)}
        </TableCell>
        <TableCell>
          <ApprovalBadge status={claim.status} />
          {claim.is_locked ? (
            <Lock className="ml-1.5 inline size-3 text-muted-foreground" aria-label="已锁定" />
          ) : null}
        </TableCell>
        <TableCell className="whitespace-nowrap text-muted-foreground">
          {claim.request_date?.slice(0, 10) ?? "—"}
        </TableCell>
        {canApprove ? (
          <TableCell onClick={(e) => e.stopPropagation()}>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label="通过"
                disabled={claim.is_locked}
                onClick={() => onDecide(true)}
              >
                <Check className="text-success" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="否决"
                disabled={claim.is_locked}
                onClick={() => onDecide(false)}
              >
                <X className="text-destructive" />
              </Button>
            </div>
          </TableCell>
        ) : null}
      </TableRow>

      {expanded ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={canApprove ? 6 : 5} className="bg-muted/40">
            <div className="space-y-4 py-2">
              <section>
                <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">明细</h4>
                {/* 后端已经把数据清洗成必有明细的结构，所以这里不写「没有明细」的分支 */}
                <ul className="space-y-1 text-sm">
                  {claim.line_items.map((line) => (
                    <li key={line.id} className="flex justify-between gap-4">
                      <span className="min-w-0 truncate">{line.description || "—"}</span>
                      <span className="shrink-0 font-mono">{formatAmount(line.amount)}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <Field label="供应商" value={claim.vendor_name} />
                <Field label="部门" value={claim.department_name} />
                <Field label="收款银行" value={claim.bank_name} />
                <Field label="账号" value={claim.bank_account} mono />
                <Field label="户名" value={claim.account_name} />
                {claim.event_name ? <Field label="关联活动" value={claim.event_name} /> : null}
              </section>

              {claim.approver_data.length > 0 ? (
                <section>
                  <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">审批记录</h4>
                  <ul className="flex flex-wrap gap-1.5">
                    {claim.approver_data.map((a, i) => (
                      <li key={`${a.user_id}-${i}`}>
                        <Badge variant={a.decision === "approve" ? "success" : a.decision === "reject" ? "danger" : "neutral"}>
                          {a.name || "—"}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <p className="flex gap-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono" : undefined}>{value || "—"}</span>
    </p>
  );
}

/**
 * status 形如 "2/0" —— 「通过数/否决数」，不是枚举。
 * 有否决就红，有通过就绿，都没有就是待审。
 */
function ApprovalBadge({ status }: { status: string }) {
  const [approve = "0", reject = "0"] = String(status ?? "0/0").split("/");
  const a = Number(approve) || 0;
  const r = Number(reject) || 0;
  if (r > 0) return <Badge variant="danger">否决 {r}</Badge>;
  if (a > 0) return <Badge variant="success">通过 {a}</Badge>;
  return <Badge variant="neutral">待审</Badge>;
}

/** 后端可能给 number 也可能给字符串（Decimal 序列化），两种都要能显示。 */
function formatAmount(value: number | string): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value ?? "—");
  return n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
