import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, CheckCircle2, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { ApiError } from "@/shared/api/errors";
import { useApiQuery } from "@/shared/api/useApiQuery";
import { useAuth } from "@/shared/auth/AuthProvider";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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

import {
  deleteJournalEntry,
  fetchAccounts,
  fetchJournalEntry,
  ledgerKeys,
  postJournalEntry,
  updateJournalEntry,
  voidJournalEntry,
  type JournalEntryInput,
} from "../api";
import { EntryStatusBadge } from "../components/EntryStatusBadge";
import { JournalEntryFormDialog } from "../components/JournalEntryFormDialog";
import { formatAmountCell, formatDateTime, formatMoney } from "../format";

/**
 * 凭证详情：抬头 + 分录明细 + 过账 / 作废 / 修改 / 删除。
 *
 * 状态机（后端 service.py 定的，界面照着它显示按钮，别多给）：
 *   草稿  → 可改、可删、可过账、可作废
 *   已过账 → 只能作废（改要先作废再重录，删直接拒）
 *   已作废 → 终点，什么都不能做
 */
export function JournalEntryDetailPage() {
  const { entryId } = useParams();
  const id = Number(entryId);
  const { has } = useAuth();
  const canEdit = has("account_edit");
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);

  const entry = useApiQuery(ledgerKeys.entry(id), () => fetchJournalEntry(id), {
    enabled: Number.isFinite(id),
  });

  // 改凭证要选科目。只在真的打开编辑框时才拉，光看一张凭证不该顺带请求科目表。
  const accountParams = { includeInactive: true };
  const accounts = useApiQuery(ledgerKeys.accounts(accountParams), () => fetchAccounts(accountParams), {
    enabled: editing,
  });

  const invalidateAll = () => void qc.invalidateQueries({ queryKey: ledgerKeys.all });

  const save = useMutation({
    mutationFn: (input: JournalEntryInput) => updateJournalEntry(id, input),
    onSuccess: () => {
      toast.success("凭证已更新");
      setEditing(false);
      invalidateAll();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "保存失败"),
  });

  const post = useMutation({
    mutationFn: () => postJournalEntry(id),
    onSuccess: () => {
      toast.success("已过账");
      invalidateAll();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "过账失败"),
  });

  const discard = useMutation({
    mutationFn: () => voidJournalEntry(id),
    onSuccess: () => {
      toast.success("凭证已作废");
      invalidateAll();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "作废失败"),
  });

  const remove = useMutation({
    mutationFn: () => deleteJournalEntry(id),
    onSuccess: () => {
      toast.success("凭证已删除");
      invalidateAll();
      // 这条记录没了，留在详情页只会看到一个 404
      void navigate("/ledger", { replace: true });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "删除失败"),
  });

  if (entry.isPending) return <LoadingState />;
  if (entry.isError) return <ErrorState error={entry.error} onRetry={() => void entry.refetch()} />;
  // 凭证 id 不是数字时查询被禁用，这里会走到 —— 渲染 404 而不是永久转圈
  if (!entry.data) return <EmptyState title="找不到这张凭证" description="链接里的凭证编号不正确。" />;

  const data = entry.data;
  const isDraft = data.status === "draft";
  const isVoid = data.status === "void";

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/ledger">
          <ArrowLeft />
          总账
        </Link>
      </Button>

      <PageHeader
        title={data.entry_no}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{data.entry_date ?? "—"}</span>
            <EntryStatusBadge status={data.status} />
            <span className="text-muted-foreground">来源 {data.source}</span>
          </span>
        }
        actions={
          canEdit && !isVoid ? (
            <>
              {isDraft ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                    <Pencil />
                    修改
                  </Button>
                  <Button
                    size="sm"
                    loading={post.isPending}
                    // 过账不是不可撤销（还能作废），但过完就不能再改了，
                    // 而「改」正是用户在草稿阶段最常做的事，所以问一句。
                    onClick={async () => {
                      if (
                        await confirm({
                          title: `过账凭证 ${data.entry_no}？`,
                          description: "过账后这张凭证进入账本，要改只能先作废再重新录入。",
                          confirmText: "过账",
                        })
                      ) {
                        post.mutate();
                      }
                    }}
                  >
                    <CheckCircle2 />
                    过账
                  </Button>
                </>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                loading={discard.isPending}
                onClick={async () => {
                  if (
                    await confirm({
                      title: `作废凭证 ${data.entry_no}？`,
                      description: "作废后这张凭证不再计入余额和报表，且无法恢复。",
                      tone: "danger",
                      confirmText: "作废",
                    })
                  ) {
                    discard.mutate();
                  }
                }}
              >
                <Ban />
                作废
              </Button>
              {isDraft ? (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={remove.isPending}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: `删除凭证 ${data.entry_no}？`,
                        description: "草稿会被彻底删除，这一步不可撤销。",
                        tone: "danger",
                        confirmText: "删除",
                      })
                    ) {
                      remove.mutate();
                    }
                  }}
                >
                  <Trash2 />
                  删除
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">凭证信息</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="摘要" value={data.memo} />
            <Field label="参考号" value={data.reference} />
            <Field label="制单人" value={data.created_by_name} />
            <Field label="创建时间" value={formatDateTime(data.created_at)} />
            <Field label="过账时间" value={formatDateTime(data.posted_at)} />
            {/* 自动记账的凭证要能看出是哪张单据带出来的，否则对账时无从查起 */}
            {data.source_ref_type ? (
              <Field label="关联单据" value={`${data.source_ref_type} #${data.source_ref_id ?? "—"}`} />
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">分录</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>科目</TableHead>
                <TableHead>说明</TableHead>
                <TableHead className="text-right">借方</TableHead>
                <TableHead className="text-right">贷方</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="text-muted-foreground">{line.line_no}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {/* 科目被删过时这两个字段是 null，退回显示 account_id 总比空白强 */}
                    <Link
                      to={`/ledger/accounts/${line.account_id}`}
                      className="text-primary hover:underline"
                    >
                      <span className="font-mono">{line.account_code ?? `#${line.account_id}`}</span>{" "}
                      {line.account_name ?? ""}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[18rem] truncate">{line.description || "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                    {formatAmountCell(line.debit)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                    {formatAmountCell(line.credit)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-medium hover:bg-transparent">
                <TableCell colSpan={3}>合计</TableCell>
                <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                  {formatMoney(data.total_debit)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                  {formatMoney(data.total_credit)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {editing ? (
        <JournalEntryFormDialog
          entry={data}
          accounts={accounts.data ?? []}
          submitting={save.isPending}
          onClose={() => setEditing(false)}
          onSubmit={(input) => save.mutate(input)}
        />
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{value || "—"}</dd>
    </div>
  );
}
