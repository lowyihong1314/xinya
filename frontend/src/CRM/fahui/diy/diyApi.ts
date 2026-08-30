import { apiFetch } from "../../../js/apiFetch";

// D.I.Y 牌位的接口封装。
//
// 坐标约定和后端一致（app/fahui/YLP/diy_paiwei.py 顶部有完整说明）：
// x / y 单位是 PDF 点，原点在页面左上角、y 向下为正 —— 和浏览器画布同向，
// 所以画布坐标 ×(1/scale) 就是这里的值，不用翻转。

export type DiyTemplate = {
  source_name: string;
  label: string;
  width: number;
  height: number;
  /** 底图 PDF 的 MediaBox 下边距。画布要补上它才和印出来的位置一致，见 diy_paiwei.py 的说明。 */
  offset_y: number;
};

/** 正常牌位每个字段印在哪。拖动吸附和「一键落位」都用这份坐标。 */
export type DiyAnchor = {
  key: string;
  block: string;
  field: string;
  label: string;
  x: number;
  y: number;
  font_size: number;
  spacing: number;
};

export type DiyElement = {
  id: string;
  text: string;
  x: number;
  y: number;
  font_size: number;
  spacing: number;
  /** true = 竖排（默认），false = 横排 */
  vertical: boolean;
  /** 字体 id，见 listDiyFonts() */
  font: string;
  /** 没有真正的粗体字重，后端用「填充 + 描边」加粗笔画 */
  bold: boolean;
  /** 只收后端白名单里的颜色 */
  color: string;
};

export type DiyFont = {
  id: string;
  label: string;
  /** true = 有字体文件可以给浏览器做 @font-face，画布和 PDF 才是同一套字形 */
  web: boolean;
  size_kb: number;
};

export type DiyPaiweiSummary = {
  id: number;
  title: string;
  source_name: string;
  note: string;
  created_at: string | null;
  updated_at: string | null;
  element_count: number;
};

export type DiyPaiweiDetail = DiyPaiweiSummary & { elements: DiyElement[] };

async function parseJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & { message?: string; error?: string };
  if (!response.ok) {
    throw new Error(data.error || data.message || "请求失败");
  }
  return data;
}

const BASE = "/api/diy_paiwei";

export async function listDiyTemplates() {
  const response = await apiFetch(`${BASE}/templates`, { credentials: "include" });
  return parseJson<{ status?: string; data?: DiyTemplate[] }>(response);
}

export function diyTemplateImageUrl(sourceName: string) {
  return `${BASE}/templates/${encodeURIComponent(sourceName)}/image`;
}

export async function listDiyAnchors(sourceName: string) {
  const response = await apiFetch(`${BASE}/templates/${encodeURIComponent(sourceName)}/anchors`, {
    credentials: "include",
  });
  return parseJson<{ status?: string; data?: DiyAnchor[] }>(response);
}

/** 新建时先摆好的默认字块（佛力超度 / 阳上 / 拜荐 / 莲位，冤亲债主那张还多一个中心主文）。 */
export async function listDiyDefaults(sourceName: string) {
  const response = await apiFetch(`${BASE}/templates/${encodeURIComponent(sourceName)}/defaults`, {
    credentials: "include",
  });
  return parseJson<{ status?: string; data?: DiyElement[] }>(response);
}

export async function listDiyFonts() {
  const response = await apiFetch(`${BASE}/fonts`, { credentials: "include" });
  return parseJson<{ status?: string; data?: DiyFont[]; default?: string; colors?: string[] }>(response);
}

/** @font-face 用的字体文件地址；后端缓存 30 天，大字体只有第一次要等。 */
export function diyFontFileUrl(fontId: string) {
  return `${BASE}/fonts/${encodeURIComponent(fontId)}/file`;
}

export async function listDiyPaiwei(value = "") {
  const search = value ? `?value=${encodeURIComponent(value)}` : "";
  const response = await apiFetch(`${BASE}${search}`, { credentials: "include" });
  return parseJson<{ status?: string; data?: { items: DiyPaiweiSummary[]; total: number } }>(response);
}

export async function getDiyPaiwei(id: number) {
  const response = await apiFetch(`${BASE}/${id}`, { credentials: "include" });
  return parseJson<{ status?: string; data?: DiyPaiweiDetail }>(response);
}

export async function createDiyPaiwei(payload: {
  title: string;
  source_name: string;
  note?: string;
  elements: DiyElement[];
}) {
  const response = await apiFetch(BASE, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{ status?: string; data?: DiyPaiweiDetail }>(response);
}

export async function updateDiyPaiwei(
  id: number,
  payload: { title?: string; source_name?: string; note?: string; elements?: DiyElement[] },
) {
  const response = await apiFetch(`${BASE}/${id}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJson<{ status?: string; data?: DiyPaiweiDetail }>(response);
}

export async function deleteDiyPaiwei(id: number) {
  const response = await apiFetch(`${BASE}/${id}`, { method: "DELETE", credentials: "include" });
  return parseJson<{ status?: string }>(response);
}

export async function copyDiyPaiwei(id: number) {
  const response = await apiFetch(`${BASE}/${id}/copy`, { method: "POST", credentials: "include" });
  return parseJson<{ status?: string; data?: DiyPaiweiDetail }>(response);
}

/** 已存好的那张，直接出 PDF。 */
export async function downloadDiyPaiweiPdf(id: number) {
  const response = await apiFetch(`${BASE}/${id}/pdf`, { credentials: "include" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message || "生成 PDF 失败");
  }
  return response.blob();
}

/** 编辑中直接打印，不用先存 —— 当天赶时间的时候用这个。 */
export async function previewDiyPaiweiPdf(payload: { source_name: string; elements: DiyElement[] }) {
  const response = await apiFetch(`${BASE}/preview`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(data.message || "生成 PDF 失败");
  }
  return response.blob();
}
