import { useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { createGLAccount, deleteGLAccount, updateGLAccount } from "./api";
import {
  ACCOUNT_TYPE_LABELS,
  btnStyle,
  cardStyle,
  cellStrongStyle,
  dangerButtonStyle,
  emptyStyle,
  filterBarStyle,
  ghostButtonStyle,
  inputStyle,
  labelStyle,
  money,
  monoCellStyle,
  primaryButtonStyle,
  searchInputStyle,
  subTabStyle,
  tabBarStyle,
  tableWrapStyle,
  toolbarStyle,
  typeChipStyle,
} from "./glStyles";
import type { GLAccount, GLAccountType } from "./types";

type AccountsTabProps = {
  accounts: GLAccount[];
  canEdit: boolean;
  onChanged: () => void;
  onNotify: (message: string, isError?: boolean) => void;
};

type TypeFilter = "all" | GLAccountType;

const TYPE_TABS: { key: TypeFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "asset", label: "资产" },
  { key: "liability", label: "负债" },
  { key: "equity", label: "权益" },
  { key: "income", label: "收入" },
  { key: "expense", label: "支出" },
];

type FormState = {
  id: number | null;
  code: string;
  name: string;
  account_type: GLAccountType;
  is_cash: boolean;
  cash_kind: string;
  bank_account_no: string;
  currency: string;
  opening_balance: string;
  status: string;
};

const EMPTY_FORM: FormState = {
  id: null,
  code: "",
  name: "",
  account_type: "asset",
  is_cash: false,
  cash_kind: "cash",
  bank_account_no: "",
  currency: "MYR",
  opening_balance: "0",
  status: "active",
};

export function AccountsTab({ accounts, canEdit, onChanged, onNotify }: AccountsTabProps) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts
      .filter((a) => typeFilter === "all" || a.account_type === typeFilter)
      .filter((a) => !q || `${a.code} ${a.name}`.toLowerCase().includes(q));
  }, [accounts, typeFilter, query]);

  function openCreate() {
    setForm({ ...EMPTY_FORM });
  }

  function openEdit(account: GLAccount) {
    setForm({
      id: account.id,
      code: account.code,
      name: account.name,
      account_type: account.account_type,
      is_cash: account.is_cash,
      cash_kind: account.cash_kind || "cash",
      bank_account_no: account.bank_account_no || "",
      currency: account.currency || "MYR",
      opening_balance: String(account.opening_balance ?? 0),
      status: account.status || "active",
    });
  }

  async function handleSave() {
    if (!form) return;
    if (!form.code.trim() || !form.name.trim()) {
      onNotify("科目编号和名称不能为空", true);
      return;
    }
    setSaving(true);
    try {
      const payload: Partial<GLAccount> = {
        code: form.code.trim(),
        name: form.name.trim(),
        account_type: form.account_type,
        is_cash: form.is_cash,
        cash_kind: form.is_cash ? form.cash_kind : null,
        bank_account_no: form.is_cash ? form.bank_account_no.trim() : null,
        currency: form.currency.trim() || "MYR",
        opening_balance: Number(form.opening_balance || 0),
        status: form.status,
      };
      if (form.id) {
        await updateGLAccount(form.id, payload);
        onNotify("科目已更新");
      } else {
        await createGLAccount(payload);
        onNotify("科目已创建");
      }
      setForm(null);
      onChanged();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "保存失败", true);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(account: GLAccount) {
    if (!window.confirm(`确定删除科目 ${account.code} ${account.name}?`)) return;
    try {
      await deleteGLAccount(account.id);
      onNotify("科目已删除");
      onChanged();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "删除失败", true);
    }
  }

  return (
    <>
      <div style={toolbarStyle}>
        <div>
          <div style={{ fontSize: "15px", fontWeight: 800, color: "var(--x-color-ink)" }}>科目表 Chart of Accounts</div>
          <div style={{ fontSize: "12px", color: "var(--x-color-ink-muted)" }}>共 {accounts.length} 个科目 · 资金账户会出现在现金账</div>
        </div>
        {canEdit ? (
          <button type="button" style={primaryButtonStyle} onClick={openCreate}>
            新建科目
          </button>
        ) : null}
      </div>

      {form ? (
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--x-color-line-soft)" }}>
          <div style={cardStyle}>
            <div style={{ fontWeight: 700, color: "var(--x-color-accent-strong)" }}>{form.id ? "编辑科目" : "新建科目"}</div>
            <div style={formGridStyle}>
              <Field label="科目编号">
                <input style={inputStyle} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="如 1000" />
              </Field>
              <Field label="科目名称">
                <input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 现金 Cash" />
              </Field>
              <Field label="科目类型">
                <select style={inputStyle} value={form.account_type} onChange={(e) => setForm({ ...form, account_type: e.target.value as GLAccountType })}>
                  {(Object.keys(ACCOUNT_TYPE_LABELS) as GLAccountType[]).map((t) => (
                    <option key={t} value={t}>
                      {ACCOUNT_TYPE_LABELS[t]}（{t}）
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="期初余额（借方为正）">
                <input style={inputStyle} value={form.opening_balance} onChange={(e) => setForm({ ...form, opening_balance: e.target.value })} />
              </Field>
              <Field label="币种">
                <input style={inputStyle} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
              </Field>
              <Field label="状态">
                <select style={inputStyle} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option value="active">启用</option>
                  <option value="inactive">停用</option>
                </select>
              </Field>
              <Field label="资金账户（现金/银行）">
                <label style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "13px" }}>
                  <input type="checkbox" checked={form.is_cash} onChange={(e) => setForm({ ...form, is_cash: e.target.checked })} />
                  计入现金账 Cash Book
                </label>
              </Field>
              {form.is_cash ? (
                <>
                  <Field label="资金类型">
                    <select style={inputStyle} value={form.cash_kind} onChange={(e) => setForm({ ...form, cash_kind: e.target.value })}>
                      <option value="cash">现金 Cash</option>
                      <option value="bank">银行 Bank</option>
                    </select>
                  </Field>
                  <Field label="银行账号">
                    <input style={inputStyle} value={form.bank_account_no} onChange={(e) => setForm({ ...form, bank_account_no: e.target.value })} />
                  </Field>
                </>
              ) : null}
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button type="button" style={primaryButtonStyle} onClick={() => void handleSave()} disabled={saving}>
                {saving ? "保存中…" : "保存"}
              </button>
              <button type="button" style={btnStyle} onClick={() => setForm(null)} disabled={saving}>
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div style={filterBarStyle}>
        <div style={tabBarStyle}>
          {TYPE_TABS.map((tab) => (
            <button key={tab.key} type="button" style={subTabStyle(tab.key === typeFilter)} onClick={() => setTypeFilter(tab.key)}>
              {tab.label}
            </button>
          ))}
        </div>
        <input style={searchInputStyle} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索编号 / 名称" />
      </div>

      {!filtered.length ? (
        <div style={emptyStyle}>{query ? "没有匹配的科目" : "暂无科目"}</div>
      ) : (
        <div style={tableWrapStyle}>
          <table className="gl-table">
            <thead>
              <tr>
                <th>编号</th>
                <th>名称</th>
                <th>类型</th>
                <th>资金账户</th>
                <th>币种</th>
                <th className="gl-num">期初余额</th>
                <th>状态</th>
                {canEdit ? <th>操作</th> : null}
              </tr>
            </thead>
            <tbody>
              {filtered.map((account) => (
                <tr key={account.id}>
                  <td style={monoCellStyle}>{account.code}</td>
                  <td style={cellStrongStyle}>{account.name}</td>
                  <td>
                    <span style={typeChipStyle(account.account_type)}>{ACCOUNT_TYPE_LABELS[account.account_type]}</span>
                  </td>
                  <td>{account.is_cash ? (account.cash_kind === "bank" ? "银行" : "现金") : "—"}</td>
                  <td>{account.currency}</td>
                  <td className="gl-num">{money(account.opening_balance)}</td>
                  <td>{account.status === "active" ? "启用" : "停用"}</td>
                  {canEdit ? (
                    <td>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button type="button" style={ghostButtonStyle} onClick={() => openEdit(account)}>
                          编辑
                        </button>
                        <button type="button" style={dangerButtonStyle} onClick={() => void handleDelete(account)}>
                          删除
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: "4px" }}>
      <div style={labelStyle}>{label}</div>
      {children}
    </div>
  );
}

const formGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "10px",
};
