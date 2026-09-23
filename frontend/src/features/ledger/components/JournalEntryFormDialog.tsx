import { Plus, Trash2 } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
} from "@/shared/ui";

import type { JournalEntryInput } from "../api";
import { formatMoney, isAccountActive } from "../format";
import type { GLAccount, GLJournalEntry } from "../types";

/**
 * 录入 / 修改凭证（一张凭证 = 抬头 + 至少两条分录，借贷必须相等）。
 *
 * ★ 和科目对话框一样，调用方**用的时候才挂载**，保证每次打开都是干净的表单。
 *
 * 校验的分工：
 *   · 后端管「对不对」—— 少于两条分录、借贷不平、科目停用、金额不是数字，
 *     每条都有中文文案，提交失败时原样 toast 出来。
 *   · 前端只管「看得见」—— 下面实时算借贷合计并把差额标出来，
 *     让用户在点保存**之前**就知道差在哪，而不是靠一次失败的提交来告诉他。
 */

interface LineDraft {
  /** 仅用于 React 的 key：分录本身没有稳定标识（新行没有 id，行序还会变）。 */
  key: number;
  account_id: string;
  debit: string;
  credit: string;
  description: string;
}

function emptyLine(key: number): LineDraft {
  return { key, account_id: "", debit: "", credit: "", description: "" };
}

/** "" / "abc" 都算 0，只用来显示合计；真正的校验在后端。 */
function toNumber(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function todayISO(): string {
  // toISOString() 是 UTC，马来西亚 +8 时区在早上 8 点前会给出昨天的日期。
  // 用本地字段自己拼，凭证日期必须是用户眼里的今天。
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function JournalEntryFormDialog({
  entry,
  accounts,
  onSubmit,
  onClose,
  submitting,
}: {
  /** null = 新建。改的时候只可能是草稿（已过账/已作废后端不让改）。 */
  entry: GLJournalEntry | null;
  accounts: GLAccount[];
  onSubmit: (input: JournalEntryInput) => void;
  onClose: () => void;
  submitting: boolean;
}) {
  const nextKey = useRef(0);
  const makeLine = () => emptyLine(nextKey.current++);

  const [entryDate, setEntryDate] = useState(entry?.entry_date ?? todayISO());
  const [memo, setMemo] = useState(entry?.memo ?? "");
  const [reference, setReference] = useState(entry?.reference ?? "");
  const [status, setStatus] = useState<"posted" | "draft">("posted");
  const [lines, setLines] = useState<LineDraft[]>(() =>
    entry
      ? entry.lines.map((line) => ({
          key: nextKey.current++,
          account_id: String(line.account_id),
          // 后端的 debit/credit 永远是数字（0 也是 0），但 0 在输入框里是噪音，留空。
          debit: line.debit ? String(line.debit) : "",
          credit: line.credit ? String(line.credit) : "",
          description: line.description ?? "",
        }))
      : [makeLine(), makeLine()],
  );

  // 停用的科目后端不让记账（「科目 1001 已停用，不能记账」），所以压根不给选。
  // 改旧凭证时那条线上的科目可能已经停用了 —— 它仍然要能显示，见下面的 fallback。
  const selectable = accounts.filter((a) => isAccountActive(a.status));

  const patchLine = (key: number, next: Partial<LineDraft>) =>
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...next } : line)));

  const totalDebit = lines.reduce((sum, line) => sum + toNumber(line.debit), 0);
  const totalCredit = lines.reduce((sum, line) => sum + toNumber(line.credit), 0);
  // 浮点数相减会留下 0.00000001 这种尾巴，按分（两位）比较。
  const diff = Math.round((totalDebit - totalCredit) * 100) / 100;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      entry_date: entryDate,
      memo: memo || null,
      reference: reference || null,
      lines: lines.map((line) => ({
        account_id: line.account_id ? Number(line.account_id) : null,
        debit: line.debit,
        credit: line.credit,
        description: line.description || null,
      })),
      // 改凭证时后端不看 status（改的一定是草稿，状态由过账按钮推进）。
      ...(entry ? {} : { status }),
    });
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{entry ? `修改凭证 ${entry.entry_no}` : "新建凭证"}</DialogTitle>
          <DialogDescription>
            至少两条分录，借方合计必须等于贷方合计。凭证号由系统按月份生成。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="entry-date">凭证日期</Label>
              <Input
                id="entry-date"
                type="date"
                required
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="entry-reference">参考号</Label>
              <Input
                id="entry-reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="单据号 / 支票号"
              />
            </div>
            {entry ? null : (
              <div className="space-y-1.5">
                <Label htmlFor="entry-status">保存方式</Label>
                <Select
                  id="entry-status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as "posted" | "draft")}
                >
                  <option value="posted">直接过账</option>
                  <option value="draft">存为草稿</option>
                </Select>
              </div>
            )}
            <div className="space-y-1.5 sm:col-span-3">
              <Label htmlFor="entry-memo">摘要</Label>
              <Input
                id="entry-memo"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="这张凭证记的是什么"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">分录</h4>
              <Button type="button" variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, makeLine()])}>
                <Plus />
                加一行
              </Button>
            </div>

            {/* 列标题只在宽屏显示；窄屏每个控件自己带 placeholder / aria-label，
                因为一行五个控件横排在手机上一定挤成一团。 */}
            <div className="hidden gap-2 px-1 text-xs text-muted-foreground sm:grid sm:grid-cols-12">
              <span className="sm:col-span-4">科目</span>
              <span className="sm:col-span-2 text-right">借方</span>
              <span className="sm:col-span-2 text-right">贷方</span>
              <span className="sm:col-span-3">说明</span>
            </div>

            <ul className="space-y-2">
              {lines.map((line, index) => {
                // 旧凭证里的科目可能已经停用，不在 selectable 里。不补这一项的话
                // <select> 会自动跳到第一个选项，用户一保存就把科目换掉了。
                const missing =
                  line.account_id && !selectable.some((a) => String(a.id) === line.account_id)
                    ? accounts.find((a) => String(a.id) === line.account_id)
                    : undefined;

                return (
                  <li
                    key={line.key}
                    className="grid gap-2 rounded-[var(--radius-sm)] border border-border p-2 sm:grid-cols-12 sm:items-center sm:border-0 sm:p-0"
                  >
                    <div className="sm:col-span-4">
                      <Select
                        value={line.account_id}
                        onChange={(e) => patchLine(line.key, { account_id: e.target.value })}
                        aria-label={`第 ${index + 1} 行科目`}
                      >
                        <option value="">选择科目…</option>
                        {missing ? (
                          <option value={String(missing.id)}>
                            {missing.code} {missing.name}（已停用）
                          </option>
                        ) : null}
                        {selectable.map((account) => (
                          <option key={account.id} value={String(account.id)}>
                            {account.code} {account.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="sm:col-span-2">
                      <Input
                        type="number"
                        step="0.01"
                        inputMode="decimal"
                        className="text-right font-mono tabular-nums"
                        placeholder="借方"
                        aria-label={`第 ${index + 1} 行借方`}
                        value={line.debit}
                        // 一行只能有一边有钱（后端「不能同时填借方和贷方」），
                        // 与其让用户提交失败再回来改，不如填这边就清那边。
                        onChange={(e) =>
                          patchLine(line.key, {
                            debit: e.target.value,
                            credit: e.target.value ? "" : line.credit,
                          })
                        }
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Input
                        type="number"
                        step="0.01"
                        inputMode="decimal"
                        className="text-right font-mono tabular-nums"
                        placeholder="贷方"
                        aria-label={`第 ${index + 1} 行贷方`}
                        value={line.credit}
                        onChange={(e) =>
                          patchLine(line.key, {
                            credit: e.target.value,
                            debit: e.target.value ? "" : line.debit,
                          })
                        }
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <Input
                        placeholder="说明"
                        aria-label={`第 ${index + 1} 行说明`}
                        value={line.description}
                        onChange={(e) => patchLine(line.key, { description: e.target.value })}
                      />
                    </div>
                    <div className="flex justify-end sm:col-span-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`删除第 ${index + 1} 行`}
                        // 少于两行后端一定拒（「凭证至少需要两条分录」），所以干脆不让删到那步
                        disabled={lines.length <= 2}
                        onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2 rounded-[var(--radius-sm)] bg-muted px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                借方合计{" "}
                <span className="font-mono tabular-nums text-foreground">{formatMoney(totalDebit)}</span>
              </span>
              <span className="text-muted-foreground">
                贷方合计{" "}
                <span className="font-mono tabular-nums text-foreground">{formatMoney(totalCredit)}</span>
              </span>
              {diff === 0 ? (
                <Badge variant="success">借贷平衡</Badge>
              ) : (
                <Badge variant="warning">差额 {formatMoney(diff)}</Badge>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            {/* 不平衡时也允许提交：后端的「借贷不平衡：借方合计 X，贷方合计 Y」比
                一个灰掉的按钮更能说清问题，而且禁用按钮在借贷都为 0 时会让人卡住。 */}
            <Button type="submit" loading={submitting}>
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
