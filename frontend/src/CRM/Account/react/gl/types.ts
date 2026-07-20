export type GLAccountType = "asset" | "liability" | "equity" | "income" | "expense";

export type GLAccount = {
  id: number;
  code: string;
  name: string;
  account_type: GLAccountType;
  parent_id?: number | null;
  is_cash: boolean;
  cash_kind?: string | null;
  bank_account_no?: string | null;
  currency: string;
  opening_balance?: number | null;
  status: string;
  remark?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type GLJournalLine = {
  id?: number;
  entry_id?: number;
  account_id: number;
  account_code?: string | null;
  account_name?: string | null;
  account_type?: GLAccountType | null;
  is_cash?: boolean;
  line_no?: number;
  debit: number;
  credit: number;
  description?: string | null;
};

export type GLJournalEntry = {
  id: number;
  entry_no: string;
  entry_date: string;
  memo?: string | null;
  reference?: string | null;
  source: string;
  source_ref_type?: string | null;
  source_ref_id?: number | null;
  status: "draft" | "posted" | "void";
  total_debit: number;
  total_credit: number;
  created_by?: number | null;
  created_by_name?: string | null;
  posted_at?: string | null;
  created_at?: string | null;
  lines?: GLJournalLine[];
};

export type GLCashAccountSummary = {
  id: number;
  code: string;
  name: string;
  cash_kind?: string | null;
  bank_account_no?: string | null;
  currency: string;
  balance: number;
};

export type GLCashSummary = {
  accounts: GLCashAccountSummary[];
  total_balance: number;
};

export type GLDashboard = {
  accounts: GLAccount[];
  recent_entries: GLJournalEntry[];
  cash: GLCashSummary;
};

export type GLTrialBalanceRow = {
  account_id: number;
  code: string;
  name: string;
  account_type: GLAccountType;
  opening_balance: number;
  period_debit: number;
  period_credit: number;
  closing_balance: number;
  debit_balance: number;
  credit_balance: number;
};

export type GLTrialBalance = {
  rows: GLTrialBalanceRow[];
  total_debit: number;
  total_credit: number;
  balanced: boolean;
  start?: string | null;
  end?: string | null;
};

export type GLLedgerRow = {
  line_id: number;
  entry_id: number;
  entry_no: string;
  entry_date: string;
  memo?: string | null;
  source: string;
  description?: string | null;
  debit: number;
  credit: number;
  balance: number;
};

export type GLAccountLedger = {
  account: GLAccount;
  opening_balance: number;
  closing_balance: number;
  total_debit: number;
  total_credit: number;
  entries: GLLedgerRow[];
  start?: string | null;
  end?: string | null;
};

export type GLJournalEntryInput = {
  entry_date?: string;
  memo?: string;
  reference?: string;
  status?: "draft" | "posted";
  lines: Array<{ account_id: number; debit?: number | string; credit?: number | string; description?: string }>;
};
