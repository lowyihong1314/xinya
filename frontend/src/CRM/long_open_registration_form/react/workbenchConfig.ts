import { apiFetch } from "../../../js/apiFetch";
import type { FeeDraft } from "../../form/react/FeePanel";

export const PUBLIC_ORIGIN = "https://utbabuddha.com";

export function registrationStatusLabel(status: string | undefined): string {
  if (status === "paid") return "已生效";
  if (status === "reject") return "已退回";
  return "处理中";
}

export function toPublicUrl(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const parsed = new URL(url, PUBLIC_ORIGIN);
    return `${PUBLIC_ORIGIN}${parsed.pathname}${parsed.search}`;
  } catch {
    return url.replace(/^https?:\/\/[^/]+/, PUBLIC_ORIGIN);
  }
}

export type PaymentRecord = {
  id: number;
  amount?: number;
  status?: "process" | "checked" | "fail" | string;
  counter?: string | null;
  created_at?: string | null;
  date?: string | null;
  time?: string | null;
  proof_image_url?: string | null;
};

export type SignStrokes = { strokes?: Array<{ points?: Array<{ x: number; y: number; t?: number }> }> };

export type CouncilSignature = {
  id: number;
  user_id: number;
  signer_name?: string | null;
  signer_username?: string | null;
  signed_at?: string | null;
  method?: string | null;
  signature?: SignStrokes | null;
};

export type CouncilState = {
  required: number;
  max: number;
  count: number;
  approved: boolean;
  full: boolean;
  signatures: CouncilSignature[];
  viewer_can_sign: boolean;
  viewer_signed: boolean;
};

export type FeeOptionRecord = {
  id?: number | null;
  category?: string | null;
  age_range_from?: number | string | null;
  age_range_to?: number | string | null;
  amount?: number | string | null;
  description?: string | null;
  image_path?: string | null;
  label?: string | null;
};

// 共用的报名条目：审批 / 付款 / 状态字段固定类型，模块特有的描述字段通过配置的 key 读取。
export type WorkbenchEntry = {
  id: number;
  submitted_at?: string | null;
  status?: "process" | "paid" | "reject" | string;
  selected_fee?: FeeOptionRecord | null;
  payment_url?: string | null;
  latest_payment?: PaymentRecord | null;
  payments?: PaymentRecord[];
  finance_approved?: boolean;
  activated?: boolean;
  council?: CouncilState | null;
  council_sign_url?: string | null;
  [key: string]: unknown;
};

export type Settings = {
  id?: number | null;
  description?: string | null;
  image_path?: string | null;
  fees?: FeeDraft[];
  fee_options?: FeeDraft[];
};

export type ListColumn = {
  header: string;
  value: (entry: WorkbenchEntry) => string;
  sub?: (entry: WorkbenchEntry) => string;
  mono?: boolean;
};

export type DetailField = {
  label: string;
  key?: string;
  value?: (entry: WorkbenchEntry) => string; // computed readonly display
  editable?: boolean;
  putKey?: string;
  kind?: "text" | "link" | "multiline";
  placeholder?: string;
};

export type SocketConfig = {
  origin: string;
  room: string;
  event: string;
  noticeText?: string;
};

export type WorkbenchEndpoints = {
  fetchEntries: () => Promise<{ entries?: WorkbenchEntry[] }>;
  fetchSettings: () => Promise<{ settings?: Settings }>;
  saveSettings: (payload: Settings) => Promise<{ message?: string; settings?: Settings }>;
  updatePaymentStatus: (paymentId: number, status: string) => Promise<{ message?: string }>;
  signCouncil: (registrationId: number, signature: SignStrokes) => Promise<{ message?: string }>;
  updateFields: (registrationId: number, patch: Record<string, string>) => Promise<{ message?: string }>;
  remove: (registrationId: number) => Promise<{ message?: string }>;
  batchSignUrl: (registrationIds: number[]) => Promise<{ url?: string; count?: number; message?: string }>;
};

export type WorkbenchConfig = {
  scope: string;
  endpoints: WorkbenchEndpoints;
  canRead: boolean;
  canEdit: boolean;
  detailEyebrowPrefix: string;
  pageTitleFor: (entry: WorkbenchEntry) => string;
  detailSubline: (entry: WorkbenchEntry) => string;
  emptyListText: string;
  feesTitle: string;
  feesSaveLabel: string;
  feesSavedNotice: string;
  feePanel: {
    addButtonLabel: string;
    saveButtonLabel: string;
    emptyText: string;
    imageLabel: string;
    descriptionPlaceholder: string;
  };
  publicFormPath: string;
  paymentPageTitle: string;
  listColumns: ListColumn[];
  detailFields: DetailField[];
  socket?: SocketConfig;
  // 可选：已生效时显示的「升级为会员」动作（仅青少年佛学班配置）。
  upgradeToMembership?: (registrationId: number) => Promise<{ message?: string }>;
};

async function parseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & {
    message?: string;
    error?: string;
    status?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || payload.message || "请求失败");
  }
  return payload;
}

// 会员与青少年佛学班的接口路径结构一致，只是 base 不同，因此用一个工厂函数复用。
export function makeEndpoints(base: string): WorkbenchEndpoints {
  return {
    async fetchEntries() {
      return parseJson(await apiFetch(`${base}/entries`, { credentials: "include" }));
    },
    async fetchSettings() {
      return parseJson(await apiFetch(`${base}/settings`, { credentials: "include" }));
    },
    async saveSettings(payload) {
      return parseJson(
        await apiFetch(`${base}/settings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        }),
      );
    },
    async updatePaymentStatus(paymentId, status) {
      return parseJson(
        await apiFetch(`${base}/payment/${paymentId}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ status }),
        }),
      );
    },
    async signCouncil(registrationId, signature) {
      return parseJson(
        await apiFetch(`${base}/${registrationId}/council-sign`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ signature }),
        }),
      );
    },
    async updateFields(registrationId, patch) {
      return parseJson(
        await apiFetch(`${base}/${registrationId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(patch),
        }),
      );
    },
    async remove(registrationId) {
      return parseJson(
        await apiFetch(`${base}/${registrationId}/remove`, { method: "POST", credentials: "include" }),
      );
    },
    async batchSignUrl(registrationIds) {
      return parseJson(
        await apiFetch(`${base}/council-sign/batch-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ registration_ids: registrationIds }),
        }),
      );
    },
  };
}
