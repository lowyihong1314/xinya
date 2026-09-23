/** 后端 /info/* 的数据形状。字段名与 backend/api/content/router.py 的响应逐字对应。 */

export interface AboutUsEntry {
  id: number;
  username: string;
  created_at: string;
  text: string;
}

export interface HistoryEntry {
  id: number;
  text: string;
  /** 历史条目可以配图，没有时为 null。 */
  image_url?: string | null;
  [key: string]: unknown;
}

export interface TreeHoleMessage {
  id: number;
  content: string;
  created_at: string;
  [key: string]: unknown;
}
