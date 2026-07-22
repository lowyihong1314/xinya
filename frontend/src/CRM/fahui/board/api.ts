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

export async function getPrintPdf(pdfId: number) {
  const res = await apiFetch(`/api/board_router/print-pdfs/${pdfId}`, { credentials: "include" });
  return readJson<{ status?: string; data?: { id: number; boards: BoardLocation[]; page_data?: unknown[] } }>(res);
}

export async function quickSearchBoards(keyword: string) {
  const res = await apiFetch("/api/board_router/orders/quick-search", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keyword }),
  });
  return readJson<{ success?: boolean; results: BoardSearchOrder[] }>(res);
}

export type BoardSearchItem = {
  id: number;
  code?: string | null;
  item_name?: string | null;
  item_form_data?: Record<string, { val?: string | null }[]> | null;
  item_location?: { boards?: BoardLocation[] | null }[] | null;
};

export type BoardSearchOrder = YlpOrderSummary & {
  order_items?: BoardSearchItem[];
};
