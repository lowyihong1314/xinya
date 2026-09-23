/**
 * 后端 /gl/* 的数据形状。见 backend/api/gl/serializers.py 与 service.py。
 *
 * ★ **形状来自后端代码，未实测**：/gl/* 每一条都要 account_read|account_edit，
 *   scripts/api-shape.mjs 匿名打过去 13 条全是 401（{"status","message"}），
 *   看不到成功体。所以下面的字段是逐个对着 serializers.py 的字典字面量抄的，
 *   顺序都一样，方便以后对照。拿到有权限的会话后请用那个工具复核一遍。
 *
 * 两处容易写错的地方（serializers.py 的注释也特地写了）：
 *   · 分录的 debit / credit 是 ``_num(...) or 0.0`` —— **永远是数字，不会是 null**，
 *     前端可以直接做算术。别写成 `number | null` 然后到处加 `?? 0`。
 *   · 科目的 opening_balance 走的是裸 ``_num(...)``，**可能是 null**。两者不一样。
 */

/** 科目类型。后端常量 ACCOUNT_TYPES（backend/models/gl.py），顺序照抄。 */
export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

/** 凭证状态。草稿可改可删，过账后只能作废，作废是终点。 */
export type JournalEntryStatus = "draft" | "posted" | "void";

/** 会计科目。serialize_account() 的全部键，没有别的字段。 */
export interface GLAccount {
  id: number;
  code: string;
  name: string;
  account_type: AccountType;
  parent_id: number | null;
  is_cash: boolean;
  /** 现金科目的细分："cash" / "bank"；非现金科目是 null。 */
  cash_kind: string | null;
  bank_account_no: string | null;
  currency: string;
  /** 借方为正存放（借 +、贷 -）。可能是 null，见文件头。 */
  opening_balance: number | null;
  /** "active" = 启用；其余（界面上写 "inactive"）= 停用，停用科目不能记账。 */
  status: string;
  remark: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** 分录。account_* 三个字段是从科目上抄过来的快照，科目被删时为 null。 */
export interface GLJournalLine {
  id: number;
  entry_id: number;
  account_id: number;
  account_code: string | null;
  account_name: string | null;
  account_type: AccountType | null;
  is_cash: boolean;
  line_no: number;
  debit: number;
  credit: number;
  description: string | null;
}

/**
 * 凭证。serialize_journal_entry(include_lines=True) 的形状。
 * 列表接口和详情接口**都带 lines**（router 里两处都用默认参数），所以不用分两个类型。
 */
export interface GLJournalEntry {
  id: number;
  /** 形如 JV202409-0007，后端按月份 + 流水号生成。 */
  entry_no: string;
  /** "YYYY-MM-DD"。 */
  entry_date: string | null;
  memo: string | null;
  reference: string | null;
  /** manual / cash_book / reimbursement / income / sales …，自动记账时是来源模块名。 */
  source: string;
  source_ref_type: string | null;
  source_ref_id: number | null;
  status: JournalEntryStatus;
  total_debit: number;
  total_credit: number;
  created_by: number | null;
  /** display_name → name_NRIC → username 的回退结果，三个都没有就是 null。 */
  created_by_name: string | null;
  /** 后端存的是 utcnow() 的裸时间，**没有时区**，别当成本地时间做换算。 */
  posted_at: string | null;
  created_at: string | null;
  lines: GLJournalLine[];
}

/** 现金/银行科目的余额（load_cash_summary 的行）。字段比 GLAccount 少，是另一份形状。 */
export interface CashAccountBalance {
  id: number;
  code: string;
  name: string;
  cash_kind: string | null;
  bank_account_no: string | null;
  currency: string;
  /** 期初 + 已过账借方 - 已过账贷方。草稿凭证不计入。 */
  balance: number;
}

export interface CashSummary {
  accounts: CashAccountBalance[];
  total_balance: number;
}

/** 试算平衡表的一行。余额一律借方为正，再拆成 debit_balance / credit_balance 两列。 */
export interface TrialBalanceRow {
  account_id: number;
  code: string;
  name: string;
  account_type: AccountType;
  opening_balance: number;
  period_debit: number;
  period_credit: number;
  closing_balance: number;
  debit_balance: number;
  credit_balance: number;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  total_debit: number;
  total_credit: number;
  balanced: boolean;
  /** 回显的查询区间，没传就是 null。 */
  start: string | null;
  end: string | null;
}

/** 科目明细账的一行（一条已过账的分录 + 累计余额）。 */
export interface AccountLedgerRow {
  line_id: number;
  entry_id: number;
  entry_no: string;
  entry_date: string | null;
  memo: string | null;
  source: string;
  description: string | null;
  debit: number;
  credit: number;
  /** 从 opening_balance 起逐行累加的余额，借方为正。 */
  balance: number;
}

export interface AccountLedger {
  account: GLAccount;
  opening_balance: number;
  closing_balance: number;
  total_debit: number;
  total_credit: number;
  entries: AccountLedgerRow[];
  start: string | null;
  end: string | null;
}

/** /gl/dashboard 的三合一（科目全量 + 最近 50 张凭证 + 现金余额）。 */
export interface GLDashboard {
  accounts: GLAccount[];
  recent_entries: GLJournalEntry[];
  cash: CashSummary;
}

/** 删除类接口的返回体。{"id": 12, "deleted": true} */
export interface DeletedResult {
  id: number;
  deleted: boolean;
}

/** /gl/journal-entries/source-map 的值：单据 → 它的凭证。 */
export interface SourceEntryRef {
  id: number;
  entry_no: string;
  status: JournalEntryStatus;
}
