import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { useApiQuery } from "@/shared/api/useApiQuery";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  Button,
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

import { fetchTrialBalance, ledgerKeys } from "../api";
import { DateRangeFields } from "../components/DateRangeFields";
import { ACCOUNT_TYPE_LABELS, formatAmountCell, formatMoney } from "../format";

/**
 * 试算平衡表：每个科目的期初、本期发生额、期末余额，以及全表借贷是否相等。
 *
 * 日期范围只框「本期发生额」（后端按凭证日期过滤已过账的分录），
 * 期初余额始终是科目上那个 opening_balance —— 这是后端的算法，界面别自己再解释成
 * 「区间起点的余额」，两者不是一回事。
 */
export function TrialBalancePage() {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const params = { start: start || undefined, end: end || undefined };
  const report = useApiQuery(ledgerKeys.trialBalance(params), () => fetchTrialBalance(params), {
    placeholderData: (prev) => prev,
  });

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/ledger">
          <ArrowLeft />
          总账
        </Link>
      </Button>

      <PageHeader
        title="试算平衡表"
        description="只统计已过账的凭证；草稿和已作废的不计入。"
        actions={
          report.data ? (
            report.data.balanced ? (
              <Badge variant="success">借贷平衡</Badge>
            ) : (
              <Badge variant="danger">借贷不平衡</Badge>
            )
          ) : null
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <DateRangeFields
              idPrefix="tb"
              start={start}
              end={end}
              onStartChange={setStart}
              onEndChange={setEnd}
            />
          </div>
        </CardHeader>
        <CardContent className="px-0">
          {report.isPending ? (
            <LoadingState />
          ) : report.isError ? (
            <ErrorState error={report.error} onRetry={() => void report.refetch()} />
          ) : report.data.rows.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>编号</TableHead>
                  <TableHead>科目</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead className="text-right">期初</TableHead>
                  <TableHead className="text-right">本期借方</TableHead>
                  <TableHead className="text-right">本期贷方</TableHead>
                  <TableHead className="text-right">期末借方</TableHead>
                  <TableHead className="text-right">期末贷方</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.data.rows.map((row) => (
                  <TableRow key={row.account_id}>
                    <TableCell className="whitespace-nowrap font-mono">
                      <Link
                        to={`/ledger/accounts/${row.account_id}`}
                        className="text-primary hover:underline"
                      >
                        {row.code}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[16rem] truncate">{row.name}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {ACCOUNT_TYPE_LABELS[row.account_type]}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                      {formatAmountCell(row.opening_balance)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                      {formatAmountCell(row.period_debit)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                      {formatAmountCell(row.period_credit)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                      {formatAmountCell(row.debit_balance)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                      {formatAmountCell(row.credit_balance)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="font-medium hover:bg-transparent">
                  <TableCell colSpan={6}>合计</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                    {formatMoney(report.data.total_debit)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                    {formatMoney(report.data.total_credit)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              title="这个区间没有数据"
              description="停用且没有余额、没有发生额的科目不会出现在表里。"
              className="py-10"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
