import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/shared/api/errors";
import { useApiQuery } from "@/shared/api/useApiQuery";
import { useAuth } from "@/shared/auth/AuthProvider";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  Input,
  Label,
  LoadingState,
  PageHeader,
  Select,
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
  createAccount,
  createJournalEntry,
  deleteAccount,
  fetchAccounts,
  fetchCashSummary,
  fetchJournalEntries,
  ledgerKeys,
  updateAccount,
  type AccountInput,
  type JournalEntryInput,
} from "../api";
import { AccountFormDialog } from "../components/AccountFormDialog";
import { DateRangeFields } from "../components/DateRangeFields";
import { EntryStatusBadge } from "../components/EntryStatusBadge";
import { JournalEntryFormDialog } from "../components/JournalEntryFormDialog";
import { ACCOUNT_TYPE_LABELS, cashKindLabel, formatMoney, isAccountActive } from "../format";
import type { GLAccount, JournalEntryStatus } from "../types";

/**
 * 总账主页：现金余额 + 凭证 + 科目表三个分区。
 *
 * 三个分区各自取数（/gl/cash-summary、/gl/journal-entries、/gl/accounts），
 * 没走三合一的 /gl/dashboard —— 那条接口一次给全部，但凭证这边有状态和日期过滤，
 * 一改过滤条件就得把科目和现金余额也重新拉一遍。
 */
export function LedgerPage() {
  const { has } = useAuth();
  const canEdit = has("account_edit");
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  // 凭证过滤
  const [entryStatus, setEntryStatus] = useState<JournalEntryStatus | "">("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  // 科目过滤（后端没有关键词参数，科目表就几十行，在前端过滤即可）
  const [accountKeyword, setAccountKeyword] = useState("");
  const [accountScope, setAccountScope] = useState<"all" | "active">("all");

  // undefined = 对话框关着；null = 新建；对象 = 改这一条。
  // 用「关着就不挂载」而不是 open 开关，保证每次打开都是空白表单。
  const [accountDialog, setAccountDialog] = useState<GLAccount | null | undefined>(undefined);
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);

  const entryParams = {
    status: entryStatus || undefined,
    start: start || undefined,
    end: end || undefined,
  };
  const accountParams = { includeInactive: accountScope === "all" };

  const cash = useApiQuery(ledgerKeys.cash(), fetchCashSummary);
  const entries = useApiQuery(ledgerKeys.entries(entryParams), () => fetchJournalEntries(entryParams), {
    placeholderData: (prev) => prev, // 换过滤条件时留着上一批，列表不闪空
  });
  const accounts = useApiQuery(ledgerKeys.accounts(accountParams), () => fetchAccounts(accountParams));

  /** 任何一处改动都会牵动余额、试算表和列表，整块失效最省心也最不容易漏。 */
  const invalidateAll = () => void qc.invalidateQueries({ queryKey: ledgerKeys.all });

  const saveAccount = useMutation({
    mutationFn: (input: AccountInput) =>
      accountDialog ? updateAccount(accountDialog.id, input) : createAccount(input),
    onSuccess: () => {
      toast.success(accountDialog ? "科目已更新" : "科目已创建");
      setAccountDialog(undefined);
      invalidateAll();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "保存失败"),
  });

  const removeAccount = useMutation({
    mutationFn: (id: number) => deleteAccount(id),
    onSuccess: () => {
      toast.success("科目已删除");
      invalidateAll();
    },
    // 「该科目已有分录记录，不能删除；可改为停用。」这句话来自后端，原样给用户
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "删除失败"),
  });

  const createEntry = useMutation({
    mutationFn: (input: JournalEntryInput) => createJournalEntry(input),
    onSuccess: (entry) => {
      toast.success(`凭证 ${entry.entry_no} 已保存`);
      setEntryDialogOpen(false);
      invalidateAll();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "保存失败"),
  });

  const visibleAccounts = (accounts.data ?? []).filter((account) => {
    const kw = accountKeyword.trim().toLowerCase();
    if (!kw) return true;
    return `${account.code} ${account.name}`.toLowerCase().includes(kw);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="总账"
        description="会计科目、凭证与过账。现金日记账就是现金/银行科目的明细。"
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to="/ledger/trial-balance">
                <BarChart3 />
                试算平衡表
              </Link>
            </Button>
            {canEdit ? (
              <Button size="sm" onClick={() => setEntryDialogOpen(true)}>
                <Plus />
                新建凭证
              </Button>
            ) : null}
          </>
        }
      />

      {/* ── 现金与银行 ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">现金与银行</CardTitle>
        </CardHeader>
        <CardContent>
          {cash.isPending ? (
            <LoadingState className="min-h-24" />
          ) : cash.isError ? (
            <ErrorState error={cash.error} onRetry={() => void cash.refetch()} className="min-h-24" />
          ) : cash.data.accounts.length ? (
            <div className="space-y-3">
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {cash.data.accounts.map((account) => (
                  <li key={account.id} className="rounded-[var(--radius-sm)] bg-muted p-3">
                    <Link to={`/ledger/accounts/${account.id}`} className="block">
                      <p className="flex items-center gap-2 text-sm">
                        <span className="truncate font-medium">{account.name}</span>
                        <Badge variant="neutral">{cashKindLabel(account.cash_kind)}</Badge>
                      </p>
                      <p className="mt-1 font-mono text-lg tabular-nums">
                        {account.currency} {formatMoney(account.balance)}
                      </p>
                      {account.bank_account_no ? (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {account.bank_account_no}
                        </p>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground">
                合计{" "}
                <span className="font-mono tabular-nums text-foreground">
                  {formatMoney(cash.data.total_balance)}
                </span>
                {/* 草稿不计入余额，不说清楚的话对不上账时会以为是 bug */}
                <span className="ml-2">（只算已过账的凭证）</span>
              </p>
            </div>
          ) : (
            <EmptyState
              title="还没有现金/银行科目"
              description="在下面的科目表里新建科目时选「现金」或「银行」。"
              className="min-h-24"
            />
          )}
        </CardContent>
      </Card>

      {/* ── 凭证 ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">凭证</CardTitle>
          <div className="grid gap-3 pt-2 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="filter-status">状态</Label>
              <Select
                id="filter-status"
                value={entryStatus}
                onChange={(e) => setEntryStatus(e.target.value as JournalEntryStatus | "")}
              >
                <option value="">全部状态</option>
                <option value="draft">草稿</option>
                <option value="posted">已过账</option>
                <option value="void">已作废</option>
              </Select>
            </div>
            <DateRangeFields
              idPrefix="entry-filter"
              start={start}
              end={end}
              onStartChange={setStart}
              onEndChange={setEnd}
            />
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {entries.isPending ? (
            <LoadingState />
          ) : entries.isError ? (
            <ErrorState error={entries.error} onRetry={() => void entries.refetch()} />
          ) : entries.data.length ? (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>凭证号</TableHead>
                    <TableHead>日期</TableHead>
                    <TableHead>摘要</TableHead>
                    <TableHead>来源</TableHead>
                    <TableHead className="text-right">金额</TableHead>
                    <TableHead>状态</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.data.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap font-mono">
                        <Link to={`/ledger/entries/${entry.id}`} className="text-primary hover:underline">
                          {entry.entry_no}
                        </Link>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{entry.entry_date ?? "—"}</TableCell>
                      <TableCell className="max-w-[18rem] truncate">{entry.memo || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {entry.source}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                        {formatMoney(entry.total_debit)}
                      </TableCell>
                      <TableCell>
                        <EntryStatusBadge status={entry.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {/* 后端默认只给 200 条，到顶了要说一声，否则用户以为凭证就这么多 */}
              {entries.data.length >= 200 ? (
                <p className="px-5 pt-3 text-xs text-muted-foreground">
                  只显示最近 200 张，用日期范围缩小查询。
                </p>
              ) : null}
            </>
          ) : (
            <EmptyState
              title={entryStatus || start || end ? "这个条件下没有凭证" : "还没有凭证"}
              description={entryStatus || start || end ? "换个状态或日期范围试试" : undefined}
              className="py-10"
            />
          )}
        </CardContent>
      </Card>

      {/* ── 科目表 ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">会计科目</CardTitle>
            {canEdit ? (
              <Button variant="outline" size="sm" onClick={() => setAccountDialog(null)}>
                <Plus />
                新建科目
              </Button>
            ) : null}
          </div>
          <div className="grid gap-3 pt-2 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="account-search">搜索</Label>
              <Input
                id="account-search"
                value={accountKeyword}
                onChange={(e) => setAccountKeyword(e.target.value)}
                placeholder="科目编号或名称"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-scope">范围</Label>
              <Select
                id="account-scope"
                value={accountScope}
                onChange={(e) => setAccountScope(e.target.value as "all" | "active")}
              >
                <option value="all">全部科目</option>
                <option value="active">仅启用</option>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {accounts.isPending ? (
            <LoadingState />
          ) : accounts.isError ? (
            <ErrorState error={accounts.error} onRetry={() => void accounts.refetch()} />
          ) : visibleAccounts.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>编号</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead className="text-right">期初余额</TableHead>
                  <TableHead>状态</TableHead>
                  {canEdit ? <TableHead className="text-right">操作</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleAccounts.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell className="whitespace-nowrap font-mono">
                      <Link
                        to={`/ledger/accounts/${account.id}`}
                        className="text-primary hover:underline"
                      >
                        {account.code}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[16rem]">
                      <span className="block truncate">{account.name}</span>
                      {account.is_cash ? (
                        <span className="text-xs text-muted-foreground">
                          {cashKindLabel(account.cash_kind)}
                          {account.bank_account_no ? ` · ${account.bank_account_no}` : ""}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {ACCOUNT_TYPE_LABELS[account.account_type]}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                      {account.currency} {formatMoney(account.opening_balance)}
                    </TableCell>
                    <TableCell>
                      {isAccountActive(account.status) ? (
                        <Badge variant="success">启用</Badge>
                      ) : (
                        <Badge variant="neutral">停用</Badge>
                      )}
                    </TableCell>
                    {canEdit ? (
                      <TableCell className="whitespace-nowrap text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`修改科目 ${account.code}`}
                          onClick={() => setAccountDialog(account)}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`删除科目 ${account.code}`}
                          loading={removeAccount.isPending && removeAccount.variables === account.id}
                          onClick={async () => {
                            if (
                              await confirm({
                                title: `删除科目 ${account.code} ${account.name}？`,
                                description: "这一步不可撤销。已经有分录的科目删不掉，可以改成停用。",
                                tone: "danger",
                                confirmText: "删除",
                              })
                            ) {
                              removeAccount.mutate(account.id);
                            }
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              title={accountKeyword ? "没有匹配的科目" : "科目表是空的"}
              description={accountKeyword ? "换个关键词试试" : "先建科目才能记凭证。"}
              className="py-10"
            />
          )}
        </CardContent>
      </Card>

      {accountDialog !== undefined ? (
        <AccountFormDialog
          account={accountDialog}
          submitting={saveAccount.isPending}
          onClose={() => setAccountDialog(undefined)}
          onSubmit={(input) => saveAccount.mutate(input)}
        />
      ) : null}

      {entryDialogOpen ? (
        <JournalEntryFormDialog
          entry={null}
          // 科目表这时已经在缓存里（同一个页面的第三个分区），不会多发请求。
          accounts={accounts.data ?? []}
          submitting={createEntry.isPending}
          onClose={() => setEntryDialogOpen(false)}
          onSubmit={(input) => createEntry.mutate(input)}
        />
      ) : null}
    </div>
  );
}
