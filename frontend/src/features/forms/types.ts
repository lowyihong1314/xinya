/**
 * 表单报名。后端 backend/api/form/router.py（挂载前缀 /form）。
 *
 * ★ **形状来自后端代码，未实测。** /form/get_all_form 和 /form/get_form/{id} 都挂了
 *   permission_required_any，未登录是 401，`node scripts/api-shape.mjs` 拿不到响应体。
 *   下面每个字段都是逐字照抄这几处的 return：
 *     backend/api/form/router.py     _serialize_form_list_item / _serialize_form_detail
 *     backend/models/form.py         RegisForm.to_dict / .to_dict_event
 *                                    NRIC_Asset.to_dict(form_id=…)
 *                                    RegisPayment.to_dict / RegistrationFee.to_dict
 *                                    RegisFormExtraFieldConfig.to_dict
 *   改那几个 to_dict 时要同步改这里；有条件跑通登录后请用 api-shape.mjs 复核一遍。
 *
 * 只覆盖管理端最核心的一块（表单列表 / 报名记录 / 费用与缴费）。
 * AI 分组、评分面板、点名、公开报名页、青少年佛学班都还没接。
 */

// ─────────────────────────── 表单配置 ───────────────────────────

/**
 * 「这张表要收哪些字段」的开关。
 * ★ 报名字段是**动态**的：渲染成员资料时必须照这份开关来推导要显示哪几行，
 *   写死一份字段列表的后果是「勾了没显示」或者「没勾却显示一堆空值」。
 */
export interface FormFieldSwitches {
  email: boolean;
  parental_form: boolean;
  parent_1: boolean;
  parent_2: boolean;
  /**
   * ★ parent_1 / parent_1_phone 在后端是**联动**的（service._extract_field_switches：
   *   只传其中一个，另一个会被设成同样的值）。界面上给一个勾就够了。
   */
  parent_1_phone: boolean;
  parent_2_phone: boolean;
  address: boolean;
  medical: boolean;
  allergy: boolean;
  other_remark: boolean;
  flexible_time_slot: boolean;
}

export type FieldSwitchKey = keyof FormFieldSwitches;

/** 后端 SUPPORTED_EXTRA_FIELD_TYPES（service.py:141）。别的值建表时就会被 400 掉。 */
export type ExtraFieldType = "text" | "textarea" | "number" | "date" | "select" | "checkbox";

/** 每张表自定义的额外字段（籍贯、职业、是否皈依…）。**这是第二处动态字段来源。** */
export interface ExtraFieldConfig {
  id: number;
  regis_form_id?: number;
  label: string;
  /** 库里是自由字符串，所以放宽成 string；取值前用 normalizeExtraFieldType 收口。 */
  field_type: ExtraFieldType | string;
  /** 仅 select 用得上；其余类型是 null。 */
  options: string[] | null;
  order: number | null;
  created_at?: string | null;
}

export interface FormFee {
  id: number;
  regis_form_id: number | null;
  /** 恒为 "form" —— 会员费和青少年班的费率同住一张表，靠它分开。 */
  fee_scope: string;
  category: string;
  /** 适用年龄区间，两端都可能为空（= 不限）。 */
  age_range_from: number | null;
  age_range_to: number | null;
  amount: number;
  description: string | null;
  image_path: string | null;
  created_at: string | null;
}

/** 关联活动。只取用得上的几个键，活动本身的完整形状在 features/events/types.ts。 */
export interface FormLinkedEvent {
  id: number;
  event_name?: string | null;
  event_code?: string | null;
  datetime?: string | null;
  end_datetime?: string | null;
  [key: string]: unknown;
}

// ─────────────────────────── 缴费 ───────────────────────────

/** 后端是 DB 枚举，只有这三个值（models/form.py:773）。 */
export type PaymentStatus = "process" | "checked" | "fail";

export interface FormPayment {
  id: number;
  regis_form_id: number | null;
  payment_scope: string;
  nric_asset_id: number;
  /** 当前 NRIC（跟着成员走）。nric_snapshot 是下单当时的快照，两者可能不一样。 */
  nric: string;
  nric_snapshot: string;
  name: string;
  phone: string;
  payment_mode: string;
  /** price 与 amount 是**同一个数**，后端两个键都发（老前端各认一个）。 */
  price: number;
  amount: number;
  date: string | null;
  time: string | null;
  created_at: string | null;
  status: PaymentStatus;
  /** 收款柜台。update_status 时可以一并改。 */
  counter: string | null;
  /**
   * ★ 名字叫 path，值其实是**接口地址**（models/form.py proof_image_url()），
   *   而且带着旧的 `/api` 前缀。别直接拿去拼 URL —— 用 api.ts 的 paymentProofUrl(id)。
   *   没上传截图时两个键都是 null。
   */
  proof_image_path: string | null;
  proof_image_url: string | null;
  [key: string]: unknown;
}

// ─────────────────────────── 报名成员 ───────────────────────────

/** 家长同意书。只有 field_switches.parental_form 为真的表才会有。 */
export interface ParentalData {
  id: number;
  regis_member_data_id: number;
  parent_cn: string | null;
  parent_en: string | null;
  parent_nric: string | null;
  parent_phone: string | null;
  child_cn: string | null;
  child_en: string | null;
  child_nric: string | null;
  child_phone: string | null;
  /** 签名缩写，如 "AD"。sign_json_data 是笔迹大对象，界面用不上。 */
  sign: string | null;
  sign_date: string | null;
  created_at: string | null;
  [key: string]: unknown;
}

export interface MemberExtraFieldValue {
  id: number;
  regis_member_data_id: number;
  field_config_id: number;
  label: string | null;
  field_type: string | null;
  /** 原样回的 JSON：字符串 / 数字 / 布尔 / 数组都可能。 */
  field_value: unknown;
  created_at: string | null;
}

/**
 * 一条报名记录。
 *
 * ★ 结构是「成员（NRIC_Asset）+ 最新一份资料版本（RegisMemberData）摊平」——
 *   资料版本是**可能不存在**的（只建了 NRIC 没填过表），那时下面带 `?` 的键
 *   一个都不会出现。所以除了 id / nric / name_nric / payments，其余全是可选。
 */
export interface FormMember {
  id: number;
  nric: string | null;
  name_nric: string | null;

  // ── 以下来自最新资料版本（member.latest_data()）──────────────
  name_cn?: string | null;
  name?: string | null;
  phone?: string | null;
  gender?: string | null;
  email?: string | null;
  address?: string | null;
  parent_1?: string | null;
  parent_2?: string | null;
  parent_1_phone?: string | null;
  parent_2_phone?: string | null;
  medical?: string | null;
  allergy?: string | null;
  other_remark?: string | null;
  /** 弹性时段（flexible_time_slot 开着才有意义）。形状随报名页而定，不解析。 */
  available_time_slot_json?: unknown;
  edit_at?: string | null;
  parental_data?: ParentalData | null;
  extra_fields?: MemberExtraFieldValue[];

  // ── 以下只在按表单取（to_dict(form_id=…)）时才有 ──────────────
  /** 报名时间，来自 regis_form_member 中间表。 */
  registered_at?: string | null;
  /** 所属小组，null = 未分组。分组界面还没做。 */
  group_id?: number | null;

  /** ★ 已按 id 倒序（最新的在 [0]）。 */
  payments: FormPayment[];

  /**
   * ★ 动态键：`extra_field_<配置id>` = 该配置下所有值用 "," 拼成的字符串。
   *   **没填过的配置这个键压根不存在**，不是空串。取值一律走
   *   components/memberFields.ts 的 extraFieldText()，别自己拼键名。
   */
  [key: string]: unknown;
}

// ─────────────────────────── 表单本体 ───────────────────────────

/**
 * 列表里的一张表。
 * ★ 注意 field_switches 在响应里出现了**两次**：一次是嵌套对象，一次是把同名键
 *   平铺到顶层（models/form.py 的 `**field_switches`）。读嵌套那份就好。
 */
export interface RegisFormSummary extends FormFieldSwitches {
  id: number;
  title: string;
  detail: string;
  notes: string | null;
  fees: FormFee[];
  /** "YYYY-MM-DD"。截止判定在后端（按马来西亚时区），前端的标签只是提示。 */
  expired: string | null;
  created_at: string | null;
  /** null = 不限人数。 */
  max_members: number | null;
  /** 手动终止报名（可以再开回去）。 */
  closed_manually: boolean;
  member_count: number;
  field_switches: FormFieldSwitches;
  extra_field_configs: ExtraFieldConfig[];
  events: FormLinkedEvent[];
  /** ★ 只有**财政**（account_read / account_edit）才拿得到这一键，别的人是 undefined。 */
  payments?: FormPayment[];
  [key: string]: unknown;
}

export interface RegisFormDetail extends RegisFormSummary {
  /**
   * ★ 没有 member_detail / form_edit 权限时后端给的是**空数组**，不是 403
   *   （router.py get_form_detail 的 include_members）。所以「空」有两种含义：
   *   真的没人报名，或者你看不到。界面要把这两种分开说。
   */
  members: FormMember[];
}

// ─────────────────────────── 响应信封 ───────────────────────────

export interface FormListResponse {
  status: string;
  forms: RegisFormSummary[];
}

/** ⚠️ 详情把内容包在 form 里，和列表的 forms 数组不是一回事。 */
export interface FormDetailResponse {
  status: string;
  form: RegisFormDetail;
}

export interface FeeListResponse {
  status: string;
  fees: FormFee[];
}
