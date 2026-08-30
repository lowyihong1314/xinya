import { apiFetch } from "../../../js/apiFetch";
import type { YlpOrderSummary } from "../types";

export type BoardSlotOrder = {
  order_item_id?: number | null;
  order_id: number;
  customer_name?: string | null;
  owner_or_deceased?: string | null;
};

export type BoardSlot = {
  print_pdf_id?: number | null;
  side_id: number; // = board_data.id
  location: number | null;
  orders: BoardSlotOrder[];
};

export type Board = {
  board_id: number;
  board_name: string;
  board_width?: number | null;
  board_height?: number | null;
  version?: string | null;
  board_data: BoardSlot[];
};

export type BoardLocation = {
  board_id?: number | null;
  board_name?: string | null;
  location?: number | null;
  board_data_id?: number | null;
};

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { message?: string; error?: string };
  if (!response.ok) {
    throw new Error((data as { error?: string; message?: string }).error || (data as { message?: string }).message || "请求失败");
  }
  return data as T;
}

export async function listBoards(version?: string) {
  const q = version ? `?version=${encodeURIComponent(version)}` : "";
  const res = await apiFetch(`/api/board_router/boards${q}`, { credentials: "include" });
  return readJson<{ all_board: Board[] }>(res);
}

export async function createBoard(payload: { board_name: string; board_width?: number | null; board_height?: number | null; version?: string }) {
  const res = await apiFetch("/api/board_router/boards", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJson<{ success?: boolean; board_id?: number; all_board: Board[] }>(res);
}

export async function updateBoard(boardId: number, payload: { board_name?: string; board_width?: number | null; board_height?: number | null }) {
  const res = await apiFetch(`/api/board_router/boards/${boardId}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJson<{ success?: boolean; all_board: Board[] }>(res);
}

export async function deleteBoard(boardId: number) {
  const res = await apiFetch(`/api/board_router/boards/${boardId}`, { method: "DELETE", credentials: "include" });
  return readJson<{ success?: boolean; all_board: Board[] }>(res);
}

export async function resetYearBarcodes(version: string) {
  const res = await apiFetch("/api/board_router/print-pdfs/reset", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version }),
  });
  return readJson<{ success?: boolean; message?: string; all_board: Board[] }>(res);
}

export async function attachPdfToBoard(payload: { board_id: number; pdf_id: number }) {
  const res = await apiFetch("/api/board_router/boards/entries", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJson<{ side_id?: number | null; all_board: Board[]; error?: string }>(res);
}

export async function reorderBoardEntry(payload: { board_id: number; pdf_id: number; location: number }) {
  const res = await apiFetch("/api/board_router/boards/entries/reorder", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJson<{ success?: boolean; all_board: Board[] }>(res);
}

export async function deleteBoardEntry(boardDataId: number) {
  const res = await apiFetch(`/api/board_router/boards/entries/${boardDataId}`, { method: "DELETE", credentials: "include" });
  return readJson<{ status?: string; all_board: Board[] }>(res);
}

export type BoardScanResult = {
  status: "attached" | "duplicate" | "unknown" | "error";
  pdf_id?: number;
  side_id?: number;
  board_id?: number;
  board_name?: string;
  same_board?: boolean;
  location?: number;
  orders?: BoardSlotOrder[];
  message?: string;
  code?: string;
};

/** 扫码上板。回包很轻（不带整棵看板树）—— 手机一秒可能扫好几次。 */
export async function scanAttachToBoard(payload: { board_id: number; code: string }) {
  const res = await apiFetch("/api/board_router/boards/scan", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as BoardScanResult;
  // 409/404 是正常业务结果（已上板 / 认不出），不当异常抛，交给调用方提示
  return data.status ? data : ({ status: "error", message: "请求失败" } as BoardScanResult);
}

export async function getPrintPdf(pdfId: number) {
  const res = await apiFetch(`/api/board_router/print-pdfs/${pdfId}`, { credentials: "include" });
  return readJson<{ status?: string; data?: { id: number; boards: BoardLocation[]; page_data?: unknown[] } }>(res);
}

/** 一个牌位单号在「合并」面板里的样子：什么类型、装了谁、贴在哪块板。 */
export type MergePdfEntry = {
  pdf_id: number;
  code?: string | null;
  codes: string[];
  source_name?: string | null;
  type_label?: string | null;
  count: number;
  orders: BoardSlotOrder[];
  versions: string[];
  boards: BoardLocation[];
};

/** 合并方案：能不能合、合完几张、为什么不能合。预览和真正提交用的是后端同一段判断。 */
export type MergePlan = {
  entries: MergePdfEntry[];
  missing_ids: number[];
  code?: string | null;
  source_name?: string | null;
  type_label?: string | null;
  capacity: number;
  total: number;
  /** 同一个牌位挂在两个单号下的重复数，合并时会被去掉 */
  duplicates: number;
  target_id?: number | null;
  can_merge: boolean;
  reason: string;
};

export async function previewMergePrintPdfs(pdfIds: number[], targetId?: number | null) {
  const res = await apiFetch("/api/board_router/print-pdfs/merge/preview", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pdf_ids: pdfIds, target_id: targetId ?? null }),
  });
  return readJson<{ status?: string; data: MergePlan }>(res);
}

export async function mergePrintPdfs(pdfIds: number[], targetId: number) {
  const res = await apiFetch("/api/board_router/print-pdfs/merge", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pdf_ids: pdfIds, target_id: targetId }),
  });
  return readJson<{ status?: string; message?: string; target_id?: number; merged_ids?: number[]; total?: number }>(res);
}

export type UnattachedPdf = {
  id: number;
  orders: BoardSlotOrder[];
};

export async function listUnattachedPdfs(version: string, page = 1, perPage = 12) {
  const search = new URLSearchParams();
  search.set("version", version);
  search.set("page", String(page));
  search.set("per_page", String(perPage));
  const res = await apiFetch(`/api/board_router/print-pdfs/unattached?${search.toString()}`, { credentials: "include" });
  return readJson<{
    success?: boolean;
    items: UnattachedPdf[];
    pagination?: { page?: number; per_page?: number; total?: number; pages?: number };
  }>(res);
}

export async function clearUnattachedPdfs(version: string) {
  const res = await apiFetch("/api/board_router/print-pdfs/unattached/clear", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version }),
  });
  return readJson<{ success?: boolean; message?: string; removed?: number }>(res);
}

export async function quickSearchBoards(keyword: string, version?: string) {
  const res = await apiFetch("/api/board_router/orders/quick-search", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keyword, version }),
  });
  return readJson<{ success?: boolean; results: BoardSearchOrder[] }>(res);
}

export type BoardSearchItem = {
  id: number;
  code?: string | null;
  item_name?: string | null;
  item_form_data?: Record<string, { val?: string | null }[]> | null;
  item_location?: { print_pdf?: { id?: number | null } | null; boards?: BoardLocation[] | null }[] | null;
};

// ---- 终端联动（第二显示器） ----

export type BoardHighlightHit = {
  board_id: number;
  board_name?: string | null;
  location: number;
  print_pdf_id?: number | null;
};

export type BoardHighlightPayload = {
  order_id?: number | null;
  order_label?: string | null;
  hits: BoardHighlightHit[];
  active_index: number;
  version?: string | null;
};

export async function createBoardTerminalLink() {
  const res = await apiFetch("/api/board_router/terminal-link", { method: "POST", credentials: "include" });
  return readJson<{ status?: string; message?: string; token?: string; expires_in?: number }>(res);
}

export async function fetchTerminalBoards(token: string, version?: string) {
  const search = new URLSearchParams();
  search.set("token", token);
  if (version) {
    search.set("version", version);
  }
  const res = await apiFetch(`/api/board_router/terminal/boards?${search.toString()}`, { credentials: "include" });
  return readJson<{ status?: string; message?: string; all_board?: Board[]; room?: string; version?: string }>(res);
}

export async function sendBoardHighlight(payload: BoardHighlightPayload) {
  const res = await apiFetch("/api/board_router/terminal/highlight", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJson<{ success?: boolean; message?: string }>(res);
}

export type BoardSearchOrder = YlpOrderSummary & {
  order_items?: BoardSearchItem[];
};
