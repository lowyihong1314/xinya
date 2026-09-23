import { useState, type FormEvent } from "react";

import {
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
  Textarea,
} from "@/shared/ui";

import type { AccountInput } from "../api";
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_OPTIONS } from "../format";
import type { AccountType, GLAccount } from "../types";

/**
 * 新建 / 修改会计科目。
 *
 * ★ 调用方**只在要用的时候才挂载它**（`{editing !== undefined && <AccountFormDialog …/>}`），
 *   这样每次打开都是全新的 useState。常驻挂载 + open 开关的写法会把上次没提交的
 *   输入留到下一次打开，编辑 A 关掉再开 B 会看到 A 的内容。
 *
 * 校验全部交给后端：科目编号重复、类型不合法、期初余额不是数字，后端都有现成的
 * 中文文案（「科目编号 1001 已存在」这种）。前端再写一套只会和后端漂移。
 */

/** is_cash + cash_kind 两个字段在界面上合成一个选择，否则会出现「是现金但没选种类」。 */
type CashChoice = "none" | "cash" | "bank";

function toCashChoice(account: GLAccount | null): CashChoice {
  if (!account?.is_cash) return "none";
  return account.cash_kind === "bank" ? "bank" : "cash";
}

interface FormState {
  code: string;
  name: string;
  account_type: AccountType;
  cash: CashChoice;
  bank_account_no: string;
  currency: string;
  opening_balance: string;
  status: string;
  remark: string;
}

export function AccountFormDialog({
  account,
  onSubmit,
  onClose,
  submitting,
}: {
  /** null = 新建。 */
  account: GLAccount | null;
  onSubmit: (input: AccountInput) => void;
  onClose: () => void;
  submitting: boolean;
}) {
  const [form, setForm] = useState<FormState>({
    code: account?.code ?? "",
    name: account?.name ?? "",
    account_type: account?.account_type ?? "asset",
    cash: toCashChoice(account),
    bank_account_no: account?.bank_account_no ?? "",
    currency: account?.currency ?? "MYR",
    // 期初余额用字符串存：数字 state 会把「清空输入框」变成 0，用户看不出区别。
    opening_balance: account?.opening_balance != null ? String(account.opening_balance) : "",
    status: account?.status ?? "active",
    remark: account?.remark ?? "",
  });

  const patch = (next: Partial<FormState>) => setForm((prev) => ({ ...prev, ...next }));

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      code: form.code,
      name: form.name,
      account_type: form.account_type,
      is_cash: form.cash !== "none",
      // 非现金科目传 null；后端在 is_cash 为假时也会自己清空，两边一致。
      cash_kind: form.cash === "none" ? null : form.cash,
      bank_account_no: form.cash === "bank" ? form.bank_account_no || null : null,
      currency: form.currency,
      opening_balance: form.opening_balance,
      status: form.status,
      remark: form.remark || null,
      // 父子科目目前没有界面（后端支持 parent_id）。改科目时保持原值，别把已有的层级冲掉。
      parent_id: account?.parent_id ?? null,
    });
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{account ? "修改科目" : "新建科目"}</DialogTitle>
          <DialogDescription>
            科目编号决定科目表的排序，建议按 1xxx 资产 / 2xxx 负债 的习惯编。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="account-code">科目编号</Label>
              <Input
                id="account-code"
                required
                value={form.code}
                onChange={(e) => patch({ code: e.target.value })}
                placeholder="1001"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-name">科目名称</Label>
              <Input
                id="account-name"
                required
                value={form.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="库存现金"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-type">科目类型</Label>
              <Select
                id="account-type"
                value={form.account_type}
                onChange={(e) => patch({ account_type: e.target.value as AccountType })}
              >
                {ACCOUNT_TYPE_OPTIONS.map((type) => (
                  <option key={type} value={type}>
                    {ACCOUNT_TYPE_LABELS[type]}（{type}）
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-cash">现金日记账</Label>
              <Select
                id="account-cash"
                value={form.cash}
                onChange={(e) => patch({ cash: e.target.value as CashChoice })}
              >
                <option value="none">不计入现金日记账</option>
                <option value="cash">现金</option>
                <option value="bank">银行</option>
              </Select>
            </div>
            {form.cash === "bank" ? (
              <div className="space-y-1.5">
                <Label htmlFor="account-bank">银行账号</Label>
                <Input
                  id="account-bank"
                  value={form.bank_account_no}
                  onChange={(e) => patch({ bank_account_no: e.target.value })}
                />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="account-currency">币种</Label>
              <Input
                id="account-currency"
                value={form.currency}
                onChange={(e) => patch({ currency: e.target.value })}
                placeholder="MYR"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-opening">期初余额</Label>
              <Input
                id="account-opening"
                type="number"
                step="0.01"
                inputMode="decimal"
                value={form.opening_balance}
                onChange={(e) => patch({ opening_balance: e.target.value })}
                placeholder="0.00"
              />
              {/* 借方为正是后端的存法，界面不解释的话没人猜得到负数是什么意思 */}
              <p className="text-xs text-muted-foreground">借方为正，贷方填负数。</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-status">状态</Label>
              <Select
                id="account-status"
                value={form.status}
                onChange={(e) => patch({ status: e.target.value })}
              >
                <option value="active">启用</option>
                <option value="inactive">停用</option>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="account-remark">备注</Label>
            <Textarea
              id="account-remark"
              className="min-h-20"
              value={form.remark}
              onChange={(e) => patch({ remark: e.target.value })}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" loading={submitting}>
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
