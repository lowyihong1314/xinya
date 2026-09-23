/**
 * 「这张表要显示哪些字段」的推导。
 *
 * ★ 报名字段是**动态**的，有两个来源：
 *     ① field_switches —— 内置字段的开关（邮箱、地址、医疗、家长…）
 *     ② extra_field_configs —— 每张表自定义的额外字段
 *   写死一份字段列表的后果是：勾了的不显示，没勾的显示一片空白。
 *   页面一律通过这里拿列表，不要在组件里自己列字段名。
 */
import type {
  ExtraFieldConfig,
  ExtraFieldType,
  FieldSwitchKey,
  FormMember,
  FormPayment,
  PaymentStatus,
  RegisFormSummary,
} from "../types";

export interface MemberField {
  /** 提交给 /form/edit_member 的 field 值 —— 就是 RegisMemberData 的列名。 */
  field: string;
  label: string;
  /** 长文本，编辑时用 Textarea。 */
  multiline?: boolean;
}

/** 与开关无关、每张表都收的基础资料（报名接口把这几个列为必填）。 */
const ALWAYS_ON: readonly MemberField[] = [
  { field: "name_cn", label: "中文姓名" },
  { field: "name", label: "英文姓名" },
  { field: "phone", label: "电话" },
  { field: "gender", label: "性别" },
];

/**
 * 开关 → 字段。
 * ★ parent_1 与 parent_1_phone 在后端是联动的（改一个另一个跟着改），但**显示**上
 *   是两行：姓名和电话是两个列。parent_2 同理。
 */
const BY_SWITCH: ReadonlyArray<readonly [FieldSwitchKey, MemberField]> = [
  ["email", { field: "email", label: "邮箱" }],
  ["address", { field: "address", label: "地址", multiline: true }],
  ["parent_1", { field: "parent_1", label: "家长一" }],
  ["parent_1_phone", { field: "parent_1_phone", label: "家长一电话" }],
  ["parent_2", { field: "parent_2", label: "家长二" }],
  ["parent_2_phone", { field: "parent_2_phone", label: "家长二电话" }],
  ["medical", { field: "medical", label: "医疗状况", multiline: true }],
  ["allergy", { field: "allergy", label: "过敏", multiline: true }],
  ["other_remark", { field: "other_remark", label: "其他备注", multiline: true }],
];

/** 建表/改表界面上给人勾的那几项。parent_*_phone 不在里面 —— 后端会自己补齐。 */
export const SWITCH_OPTIONS: ReadonlyArray<{ key: FieldSwitchKey; label: string; hint?: string }> = [
  { key: "email", label: "邮箱" },
  { key: "address", label: "地址" },
  { key: "medical", label: "医疗状况" },
  { key: "allergy", label: "过敏" },
  { key: "other_remark", label: "其他备注" },
  { key: "parent_1", label: "家长一", hint: "姓名与电话一起开关" },
  { key: "parent_2", label: "家长二", hint: "姓名与电话一起开关" },
  { key: "parental_form", label: "家长同意书" },
  { key: "flexible_time_slot", label: "弹性参加时段" },
];

/** 这张表实际会显示的内置字段。 */
export function memberFieldsOf(form: RegisFormSummary): MemberField[] {
  // 顶层平铺的同名键是 field_switches 的副本（models/form.py 的 `**field_switches`），
  // 读嵌套的那一份就够了。
  const on = form.field_switches;
  return [
    ...ALWAYS_ON,
    ...BY_SWITCH.filter(([key]) => Boolean(on?.[key])).map(([, field]) => field),
  ];
}

const KNOWN_TYPES: ReadonlySet<string> = new Set([
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "checkbox",
]);

/** 库里的 field_type 是自由字符串，收口成后端支持的那 6 种，认不出就当 text。 */
export function normalizeExtraFieldType(raw: string | undefined | null): ExtraFieldType {
  const value = String(raw ?? "").trim().toLowerCase();
  return (KNOWN_TYPES.has(value) ? value : "text") as ExtraFieldType;
}

/** 扩展字段配置的显示顺序（order 可能为 null，那就按 id 兜底，保证顺序稳定）。 */
export function sortedExtraFields(form: RegisFormSummary): ExtraFieldConfig[] {
  return [...(form.extra_field_configs ?? [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id,
  );
}

/**
 * 某个成员在某个扩展字段上填的值（给人看的文本）。
 *
 * ★ 后端把同一配置下的多个值用 "," 拼成字符串放在 `extra_field_<id>` 上，
 *   **没填过时这个键压根不存在**。拿不到就退回 extra_fields 数组里找原始值。
 */
export function extraFieldText(member: FormMember, config: ExtraFieldConfig): string {
  const type = normalizeExtraFieldType(config.field_type);
  const flat = member[`extra_field_${config.id}`];
  const raw =
    typeof flat === "string" && flat !== ""
      ? flat
      : member.extra_fields?.find((v) => v.field_config_id === config.id)?.field_value;

  if (raw === undefined || raw === null || raw === "") return "";
  // 勾选框存的是 JSON 布尔，摊平后是字符串 "true"/"false" —— 直接显示那两个词很难看。
  if (type === "checkbox") return isTruthyExtraValue(raw) ? "是" : "否";
  if (Array.isArray(raw)) return raw.join("、");
  return String(raw);
}

/** 勾选框的当前值。后端 _coerce_extra_field_value 认 {1,true,yes,on}，这里保持同一套判据。 */
export function isTruthyExtraValue(raw: unknown): boolean {
  if (typeof raw === "string") return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
  return Boolean(raw);
}

/** 编辑框里要显示的原始值（和 extraFieldText 不同：这里不做「是/否」这种美化）。 */
export function extraFieldRawText(member: FormMember, config: ExtraFieldConfig): string {
  const type = normalizeExtraFieldType(config.field_type);
  if (type === "checkbox") {
    const flat = member[`extra_field_${config.id}`];
    const raw =
      flat ?? member.extra_fields?.find((v) => v.field_config_id === config.id)?.field_value;
    return isTruthyExtraValue(raw) ? "1" : "0";
  }
  return extraFieldText(member, config);
}

// ─────────────────────────── 展示用的小工具 ───────────────────────────

/** 成员的显示名。资料版本可能不存在，所以一路往下兜。 */
export function memberDisplayName(member: FormMember): string {
  return (
    member.name_cn?.trim() ||
    member.name?.trim() ||
    member.name_nric?.trim() ||
    member.nric?.trim() ||
    `成员 #${member.id}`
  );
}

/** 最近一笔付款。后端已按 id 倒序，[0] 就是最新的。 */
export function latestPayment(member: FormMember): FormPayment | null {
  return member.payments?.[0] ?? null;
}

export const PAYMENT_STATUS: Record<
  PaymentStatus,
  { label: string; variant: "success" | "warning" | "danger" }
> = {
  checked: { label: "已确认", variant: "success" },
  process: { label: "处理中", variant: "warning" },
  fail: { label: "失败", variant: "danger" },
};

export type FormOpenState = "open" | "closed" | "expired" | "full";

/**
 * 报名开着没有。
 * ★ 只是给人看的标签 —— **真正的截止判定在后端**（service._is_form_registration_closed，
 *   按马来西亚时区比日期，而且 force 链接可以绕过）。这里用浏览器本地日期近似，
 *   跨时区时可能差一天，别拿它去挡提交。
 */
export function formOpenState(form: RegisFormSummary): FormOpenState {
  if (form.closed_manually) return "closed";
  if (form.expired && todayIso() > form.expired) return "expired";
  if (form.max_members != null && form.member_count >= form.max_members) return "full";
  return "open";
}

export const OPEN_STATE_BADGE: Record<
  FormOpenState,
  { label: string; variant: "success" | "neutral" | "warning" | "danger" }
> = {
  open: { label: "报名中", variant: "success" },
  closed: { label: "已终止", variant: "neutral" },
  expired: { label: "已过期", variant: "danger" },
  full: { label: "已满员", variant: "warning" },
};

function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 金额。后端 float 化过（RegistrationFee/RegisPayment 的 to_dict），但仍要防 NaN。 */
export function formatAmount(value: number | string | null | undefined): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 收费项的年龄区间文案。两端都可能为空。 */
export function feeAgeRange(from: number | null, to: number | null): string {
  if (from == null && to == null) return "不限年龄";
  if (from != null && to != null) return `${from}–${to} 岁`;
  if (from != null) return `${from} 岁以上`;
  return `${to} 岁以下`;
}

/** 后端给的是 ISO 串（有的带 T，有的是日期）。只取到分钟，秒没人看。 */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 16).replace("T", " ");
}
