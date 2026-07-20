import { apiFetch } from "../../../../js/apiFetch";

import type {
  GLAccount,
  GLAccountLedger,
  GLCashSummary,
  GLDashboard,
  GLJournalEntry,
  GLJournalEntryInput,
  GLTrialBalance,
} from "./types";

async function parseJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as { data?: T; error?: string; message?: string };
  if (!response.ok) {
    throw new Error(data.message || data.error || "请求失败");
  }
  if (data.data === undefined) {
    throw new Error("返回数据缺失");
  }
  return data.data;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function fetchGLDashboard() {
  const response = await apiFetch("/api/gl/dashboard", { credentials: "include" });
  return parseJson<GLDashboard>(response);
}

export async function fetchGLAccounts() {
  const response = await apiFetch("/api/gl/accounts", { credentials: "include" });
  return parseJson<GLAccount[]>(response);
}

export async function createGLAccount(payload: Partial<GLAccount>) {
  const response = await apiFetch("/api/gl/accounts", jsonInit("POST", payload));
  return parseJson<GLAccount>(response);
}

export async function updateGLAccount(id: number, payload: Partial<GLAccount>) {
  const response = await apiFetch(`/api/gl/accounts/${id}`, jsonInit("PUT", payload));
  return parseJson<GLAccount>(response);
}

export async function deleteGLAccount(id: number) {
  const response = await apiFetch(`/api/gl/accounts/${id}`, { method: "DELETE", credentials: "include" });
  return parseJson<{ id: number; deleted: boolean }>(response);
}

export async function fetchGLJournalEntries(params: { status?: string; source?: string; start?: string; end?: string } = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.source) query.set("source", params.source);
  if (params.start) query.set("start", params.start);
  if (params.end) query.set("end", params.end);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await apiFetch(`/api/gl/journal-entries${suffix}`, { credentials: "include" });
  return parseJson<GLJournalEntry[]>(response);
}

export async function createGLJournalEntry(payload: GLJournalEntryInput) {
  const response = await apiFetch("/api/gl/journal-entries", jsonInit("POST", payload));
  return parseJson<GLJournalEntry>(response);
}

export async function postGLJournalEntry(id: number) {
  const response = await apiFetch(`/api/gl/journal-entries/${id}/post`, { method: "POST", credentials: "include" });
  return parseJson<GLJournalEntry>(response);
}

export async function voidGLJournalEntry(id: number) {
  const response = await apiFetch(`/api/gl/journal-entries/${id}/void`, { method: "POST", credentials: "include" });
  return parseJson<GLJournalEntry>(response);
}

export async function deleteGLJournalEntry(id: number) {
  const response = await apiFetch(`/api/gl/journal-entries/${id}`, { method: "DELETE", credentials: "include" });
  return parseJson<{ id: number; deleted: boolean }>(response);
}

export async function fetchGLEntryBySource(refType: string, refId: number) {
  const query = new URLSearchParams({ ref_type: refType, ref_id: String(refId) });
  const response = await apiFetch(`/api/gl/journal-entries/by-source?${query.toString()}`, { credentials: "include" });
  const data = (await response.json().catch(() => ({}))) as { data?: GLJournalEntry | null; error?: string; message?: string };
  if (!response.ok) {
    throw new Error(data.message || data.error || "请求失败");
  }
  return data.data ?? null;
}

export type GLSourceEntryRef = { id: number; entry_no: string; status: "draft" | "posted" | "void" };

export async function fetchGLSourceMap(refType: string, refIds?: Array<number | string>) {
  const query = new URLSearchParams({ ref_type: refType });
  if (refIds && refIds.length) query.set("ref_ids", refIds.join(","));
  const response = await apiFetch(`/api/gl/journal-entries/source-map?${query.toString()}`, { credentials: "include" });
  const data = (await response.json().catch(() => ({}))) as { data?: Record<string, GLSourceEntryRef>; error?: string; message?: string };
  if (!response.ok) {
    throw new Error(data.message || data.error || "请求失败");
  }
  return data.data ?? {};
}

export type GLEntryFromSourceInput = {
  source: string;
  source_ref_type: string;
  source_ref_id: number;
  entry_date?: string;
  memo?: string;
  reference?: string;
  lines: Array<{ account_id: number; debit?: number | string; credit?: number | string; description?: string }>;
};

export async function createGLEntryFromSource(payload: GLEntryFromSourceInput) {
  const response = await apiFetch("/api/gl/journal-entries/from-source", jsonInit("POST", payload));
  return parseJson<GLJournalEntry>(response);
}

export async function fetchGLCashSummary() {
  const response = await apiFetch("/api/gl/cash-summary", { credentials: "include" });
  return parseJson<GLCashSummary>(response);
}

export async function fetchGLTrialBalance(params: { start?: string; end?: string } = {}) {
  const query = new URLSearchParams();
  if (params.start) query.set("start", params.start);
  if (params.end) query.set("end", params.end);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await apiFetch(`/api/gl/reports/trial-balance${suffix}`, { credentials: "include" });
  return parseJson<GLTrialBalance>(response);
}

export async function fetchGLAccountLedger(accountId: number, params: { start?: string; end?: string } = {}) {
  const query = new URLSearchParams();
  if (params.start) query.set("start", params.start);
  if (params.end) query.set("end", params.end);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await apiFetch(`/api/gl/reports/account-ledger/${accountId}${suffix}`, { credentials: "include" });
  return parseJson<GLAccountLedger>(response);
}
