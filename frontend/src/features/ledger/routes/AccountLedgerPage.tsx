import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { useApiQuery } from "@/shared/api/useApiQuery";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
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
} from "@/shared/ui";

import { fetchAccountLedger, ledgerKeys } from "../api";
import { DateRangeFields } from "../components/DateRangeFields";
import {
  ACCOUNT_TYPE_LABELS,
  cashKindLabel,
  formatAmountCell,
  formatMoney,
  isAccountActive,
} from "../format";

/**
 * 科目明细账。现金/银行科目的这张表就是「现金日记账」——
 * 后端没有单独的现金日记账接口，因为它本来就是同一份数据（见 api/gl/README.md）。
 */
export function AccountLedgerPage() {
  const { accountId } = useParams();
  const id = Number(accountId);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const params = { start: start || undefined, end: end || undefined };
  const ledger = useApiQuery(ledgerKeys.accountLedger(id, params), () => fetchAccountLedger(id, params), {
    enabled: Number.isFinite(id),
    placeholderData: (prev) => prev,
  });

  if (ledger.isPending) return <LoadingState />;
  if (ledger.isError) return <ErrorState error={ledger.error} onRetry={() => void ledger.refetch()} />;

  const { account } = ledger.data;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/ledger">
          <ArrowLeft />
          总账
        </Link>
      </Button>

      <PageHeader
        title={`${account.code} ${account.name}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">{ACCOUNT_TYPE_LABELS[account.account_type]}</Badge>
            {account.is_cash ? <Badge variant="info">{cashKindLabel(account.cash_kind)}</Badge> : null}
            {isAccountActive(account.status) ? null : <Badge variant="warning">已停用</Badge>}
            <span className="text-muted-foreground">{account.currency}</span>
          </span>
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <DateRangeFields
              idPrefix="ledger"
              start={start}
              end={end}
              onStartChange={setStart}
              onEndChange={setEnd}
            />
          </div>
        </CardHeader>
        <CardContent>
          {/* 四个数放在明细上方：核对时先看总数对不对，再往下找是哪一行 */}
          <dl className="grid gap-4 sm:grid-cols-4">
            <Summary label="期初余额" value={formatMoney(ledger.data.opening_balance)} />
            <Summary label="借方合计" value={formatMoney(ledger.data.total_debit)} />
            <Summary label="贷方合计" value={formatMoney(ledger.data.total_credit)} />
            <Summary label="期末余额" value={formatMoney(ledger.data.closing_balance)} />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="px-0 pt-0">
          {ledger.data.entries.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日期</TableHead>
                  <TableHead>凭证号</TableHead>
                  <TableHead>摘要</TableHead>
                  <TableHead className="text-right">借方</TableHead>
                  <TableHead className="text-right">贷方</TableHead>
                  <TableHead className="text-right">余额</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.data.entries.map((row) => (
                  <TableRow key={row.line_id}>
                    <TableCell className="whitespace-nowrap">{row.entry_date ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono">
                      <Link to={`/ledger/entries/${row.entry_id}`} className="text-primary hover:underline">
                        {row.entry_no}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[20rem] truncate">
                      {/* 分录说明比凭证摘要更贴这一行；没有说明时才退回摘要 */}
                      {row.description || row.memo || "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                      {formatAmountCell(row.debit)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                      {formatAmountCell(row.credit)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                      {formatMoney(row.balance)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              title="这个区间没有明细"
              description="只有已过账的凭证会进明细账。"
              className="py-10"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-mono text-lg tabular-nums">{value}</dd>
    </div>
  );
}
