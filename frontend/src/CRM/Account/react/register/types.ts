import type { FormPayment, FormRecord } from "../../../form/react/types";

export type RegisterPaymentStatus = "process" | "checked" | "fail" | "all";
export type FinanceScope = "form" | "membership" | "youth_class" | "fahui_ylp" | "fahui_lamp" | "sales";

export type RegisterPaymentForm = FormRecord & {
  payments?: FormPayment[];
};

// 财政收款：跨 scope 的付款记录（后端 RegisPayment.to_dict + source 字段）。
export type FinancePayment = {
  id: number;
  payment_scope: string;
  regis_form_id?: number | null;
  membership_registration_id?: number | null;
  youth_class_registration_id?: number | null;
  nric_asset_id?: number | null;
  nric?: string | null;
  nric_snapshot?: string | null;
  name?: string | null;
  phone?: string | null;
  payment_mode?: string | null;
  price?: number;
  amount?: number;
  created_at?: string | null;
  date?: string | null;
  time?: string | null;
  status?: "process" | "checked" | "fail" | string | null;
  counter?: string | null;
  proof_image_path?: string | null;
  proof_image_url?: string | null;
  source_scope?: FinanceScope | string;
  source_scope_label?: string;
  source_label?: string | null;
  registration_id?: number | null;
};

export const SCOPE_FILTERS: { key: FinanceScope | "all"; label: string }[] = [
  { key: "all", label: "全部来源" },
  { key: "form", label: "报名表单" },
  { key: "membership", label: "会员" },
  { key: "youth_class", label: "青少年佛学班" },
  { key: "fahui_ylp", label: "法会 YLP" },
  { key: "fahui_lamp", label: "法会 Lamp" },
  { key: "sales", label: "销售收入" },
];

export const STATUS_FILTERS: { key: RegisterPaymentStatus; label: string }[] = [
  { key: "process", label: "处理中" },
  { key: "checked", label: "已确认" },
  { key: "fail", label: "失败" },
  { key: "all", label: "全部" },
];
