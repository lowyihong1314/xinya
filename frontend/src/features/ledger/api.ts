/**
 * 总账（会计科目 + 凭证 + 过账）。后端 backend/api/gl/router.py（挂载前缀 /gl）。
 *
 * ★ 本模块**每一条**接口的成功响应都是 `{"status":"success","data": …}`，业务数据
 *   在 data 里。外层统一在这里剥掉，页面拿到的就是数据本身 —— 否则每个调用点都要
 *   写一次 `.data`，漏写一处就是编译通过、运行时 undefined。
 *   （email 模块没剥是因为它的 from_email 挂在信封同级上，形状不一样。）
 *
 * ⚠️ 前端页面地址用 /ledger 不用 /gl：后端有 /gl/accounts、/gl/journal-entries…，
 *    虽然 /gl 本身没被占，但「用户可见的地址」优先用词清楚的那个。
 *    已核对过 /ledger、/ledger/entries/{id}、/ledger/accounts/{id}、
 *    /ledger/trial-balance 都不和后端 79 条路由的完整路径重合。
 */
import { http } from "@/shared/api/client";

import type {
  AccountLedger,
  AccountType,
  CashSummary,
  DeletedResult,
  GLAccount,
  GLDashboard,
  GLJournalEntry,
  JournalEntryStatus,
  SourceEntryRef,
  TrialBalance,
} from "./types";

/** 后端的成功信封。失败时是 {"status":"error","message":…}，由 http 抛成 ApiError。 */
interface GLEnvelope<T> {
  status: string;
  data: T;
}

const unwrap = async <T>(promise: Promise<GLEnvelope<T>>): Promise<T> =>
  (await promise).data;

export interface AccountListParams {
  /** 默认连停用科目一起返回（后端默认也是）。记账选科目时传 false 只要启用的。 */
  includeInactive?: boolean;
}

export interface EntryListParams {
  status?: JournalEntryStatus;
  source?: string;
  /** "YYYY-MM-DD"，按凭证日期过滤，闭区间。 */
  start?: string;
  end?: string;
  /** 不传时后端默认 200 条。 */
  limit?: number;
}

export interface ReportRangeParams {
  start?: string;
  end?: string;
}

export const ledgerKeys = {
  all: ["ledger"] as const,
  accounts: (params: AccountListParams = {}) => [...ledgerKeys.all, "accounts", params] as const,
  entries: (params: EntryListParams = {}) => [...ledgerKeys.all, "entries", params] as const,
  entry: (id: number) => [...ledgerKeys.all, "entry", id] as const,
  cash: () => [...ledgerKeys.all, "cash"] as const,
  trialBalance: (params: ReportRangeParams = {}) =>
    [...ledgerKeys.all, "trial-balance", params] as const,
  accountLedger: (id: number, params: ReportRangeParams = {}) =>
    [...ledgerKeys.all, "account-ledger", id, params] as const,
};

// --------------------------------------------------------------------------- //
// 会计科目
// --------------------------------------------------------------------------- //

/**
 * ⚠️ include_inactive 的取值不是布尔语义：后端写的是 `include_inactive != "0"`，
 *    **只有字面量 "0" 才算关掉**，传 "false" / "no" / "" 都仍然是「全都要」。
 *    所以这里只在要「仅启用」时传 "0"，其余情况不传参数。
 */
export const fetchAccounts = (params: AccountListParams = {}) =>
  unwrap(
    http.get<GLEnvelope<GLAccount[]>>("/gl/accounts", {
      query: { include_inactive: params.includeInactive === false ? "0" : undefined },
    }),
  );

export interface AccountInput {
  code: string;
  name: string;
  account_type: AccountType;
  is_cash: boolean;
  /** is_cash 为 false 时后端会强制清空这两个字段，不用前端自己擦。 */
  cash_kind: string | null;
  bank_account_no: string | null;
  currency: string;
  /** 空串 → 后端 _money 记 0.00；"abc" 才会 422。 */
  opening_balance: string;
  status: string;
  remark: string | null;
  parent_id: number | null;
}

export const createAccount = (input: AccountInput) =>
  unwrap(http.post<GLEnvelope<GLAccount>>("/gl/accounts", input));

/**
 * 改科目。后端按 `"字段名" in payload` 决定改不改某个字段，所以**传什么改什么**；
 * 这里的调用点一律传整份表单，省得算「哪些字段动过」。
 */
export const updateAccount = (id: number, input: AccountInput) =>
  unwrap(http.put<GLEnvelope<GLAccount>>(`/gl/accounts/${id}`, input));

/** 已有分录的科目删不掉（后端 422 「可改为停用」），页面把那句话原样弹给用户。 */
export const deleteAccount = (id: number) =>
  unwrap(http.delete<GLEnvelope<DeletedResult>>(`/gl/accounts/${id}`));

// --------------------------------------------------------------------------- //
// 凭证
// --------------------------------------------------------------------------- //

export const fetchJournalEntries = (params: EntryListParams = {}) =>
  unwrap(
    http.get<GLEnvelope<GLJournalEntry[]>>("/gl/journal-entries", {
      query: {
        status: params.status || undefined,
        source: params.source || undefined,
        start: params.start || undefined,
        end: params.end || undefined,
        limit: params.limit,
      },
    }),
  );

export const fetchJournalEntry = (id: number) =>
  unwrap(http.get<GLEnvelope<GLJournalEntry>>(`/gl/journal-entries/${id}`));

export interface JournalLineInput {
  /** null 时后端回「第 N 行未选择科目」，这条文案直接给用户看。 */
  account_id: number | null;
  /** 金额用字符串发：空串在后端等于 0.00，而 Number("") === 0 会把「没填」和「填 0」混掉。 */
  debit: string;
  credit: string;
  description: string | null;
}

export interface JournalEntryInput {
  /** "YYYY-MM-DD"。留空后端取今天，但页面总是填好再发。 */
  entry_date: string;
  memo: string | null;
  reference: string | null;
  /** 至少两条，借贷必须相等 —— 这些都由后端校验并给中文文案。 */
  lines: JournalLineInput[];
  /** 只有新建时能选 draft/posted；改凭证时后端不看这个字段。 */
  status?: Extract<JournalEntryStatus, "draft" | "posted">;
}

export const createJournalEntry = (input: JournalEntryInput) =>
  unwrap(http.post<GLEnvelope<GLJournalEntry>>("/gl/journal-entries", input));

/** 只有草稿能改：已过账的后端回「请先作废后重新录入」，已作废的直接拒。 */
export const updateJournalEntry = (id: number, input: JournalEntryInput) =>
  unwrap(http.put<GLEnvelope<GLJournalEntry>>(`/gl/journal-entries/${id}`, input));

/** 过账。重复过账是幂等的（后端原样返回，不报错）。 */
export const postJournalEntry = (id: number) =>
  unwrap(http.post<GLEnvelope<GLJournalEntry>>(`/gl/journal-entries/${id}/post`));

/** 作废。**不可撤销**，调用前必须 confirm({tone:"danger"})。 */
export const voidJournalEntry = (id: number) =>
  unwrap(http.post<GLEnvelope<GLJournalEntry>>(`/gl/journal-entries/${id}/void`));

/** 删除。已过账的删不掉（后端 422 「请改为作废」）。 */
export const deleteJournalEntry = (id: number) =>
  unwrap(http.delete<GLEnvelope<DeletedResult>>(`/gl/journal-entries/${id}`));

// --------------------------------------------------------------------------- //
// 现金日记账 / 报表
// --------------------------------------------------------------------------- //

export const fetchCashSummary = () =>
  unwrap(http.get<GLEnvelope<CashSummary>>("/gl/cash-summary"));

export const fetchTrialBalance = (params: ReportRangeParams = {}) =>
  unwrap(
    http.get<GLEnvelope<TrialBalance>>("/gl/reports/trial-balance", {
      query: { start: params.start || undefined, end: params.end || undefined },
    }),
  );

export const fetchAccountLedger = (id: number, params: ReportRangeParams = {}) =>
  unwrap(
    http.get<GLEnvelope<AccountLedger>>(`/gl/reports/account-ledger/${id}`, {
      query: { start: params.start || undefined, end: params.end || undefined },
    }),
  );

// --------------------------------------------------------------------------- //
// 给别的模块用的接口
//
// 下面四条本模块的页面**不调用**，但它们是 /gl 的路由，按「只有 api.ts 知道接口
// 路径」的约定放在这里 —— 报销 / 收款那些页面要显示「这单已记账」时从这里导入，
// 不要在那边重新写一遍 "/gl/journal-entries/..."。
// --------------------------------------------------------------------------- //

/** 三合一（全量科目 + 最近 50 张凭证 + 现金余额）。一次取完，适合首页小卡片。 */
export const fetchGLDashboard = () => unwrap(http.get<GLEnvelope<GLDashboard>>("/gl/dashboard"));

/** 某张单据对应的凭证；没记账时返回 **null 而不是 404**，前端靠这个判断。 */
export const fetchEntryBySource = (refType: string, refId: string | number) =>
  unwrap(
    http.get<GLEnvelope<GLJournalEntry | null>>("/gl/journal-entries/by-source", {
      query: { ref_type: refType, ref_id: refId },
    }),
  );

/** 批量版：{ 单据ID: {id, entry_no, status} }，单据列表一次问完，别一行一个请求。 */
export const fetchEntrySourceMap = (refType: string, refIds?: Array<string | number>) =>
  unwrap(
    http.get<GLEnvelope<Record<string, SourceEntryRef>>>("/gl/journal-entries/source-map", {
      // 不传 ref_ids = 该类型下全查；传了但都是空的 = 后端返回 {}。两者不一样。
      query: { ref_type: refType, ref_ids: refIds?.length ? refIds.join(",") : undefined },
    }),
  );

export interface FromSourceInput {
  source?: string;
  source_ref_type: string;
  source_ref_id: string | number;
  lines: JournalLineInput[];
  entry_date?: string;
  memo?: string | null;
  reference?: string | null;
}

/** 单据确认时自动记一张已过账的凭证。对 (ref_type, ref_id) 幂等，重复调不会记两张。 */
export const postJournalFromSource = (input: FromSourceInput) =>
  unwrap(http.post<GLEnvelope<GLJournalEntry>>("/gl/journal-entries/from-source", input));
