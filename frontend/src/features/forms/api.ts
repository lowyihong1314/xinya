/**
 * 表单报名。后端 backend/api/form/router.py（挂载前缀 /form，76 条路由，
 * 整个项目里最大的单体模块）。
 *
 * ⚠️ 前端页面地址是 `/registrations`，不是 `/forms` —— 后端 public_api 有一条
 *    `GET /forms`（报名表全量导出，permission_required("member_edit")）。
 *    前端用 /forms 的话请求会被后端接走，用户点菜单会下载一坨 JSON
 *    （未登录时更糟：那条路由没垫 login_required，返回的是 500）。
 *    见 src/app/routes.ts 与 scripts/check-route-collisions.mjs。
 *
 * 这里只接了管理端核心的那一组路由，其余 60 多条（AI 分组、评分面板、点名、
 * 公开报名页、青少年佛学班）还没接。
 */
import { http } from "@/shared/api/client";
import { API_ROOT } from "@/shared/config/env";

import type {
  FeeListResponse,
  FormDetailResponse,
  FormListResponse,
  PaymentStatus,
  RegisFormDetail,
} from "./types";

export const formKeys = {
  all: ["forms"] as const,
  list: () => [...formKeys.all, "list"] as const,
  detail: (id: number) => [...formKeys.all, "detail", id] as const,
  fees: (id: number) => [...formKeys.all, "fees", id] as const,
};

// ─────────────────────────── 表单本体 ───────────────────────────

/**
 * 全部报名表。**不分页**，后端一次全给（RegisForm.query.all()），按创建时间倒序。
 * 读权限比别处宽：form_read / form_edit / member_detail 之外还放行财政
 * （account_read / account_edit），因为财政要按表分组看收入。
 */
export const fetchForms = () => http.get<FormListResponse>("/form/get_all_form");

/** ⚠️ 详情回 {"status":"success","form":{…}}，这里剥掉外层，让调用方拿到和列表一致的形状。 */
export const fetchForm = async (id: number): Promise<RegisFormDetail> =>
  (await http.get<FormDetailResponse>(`/form/get_form/${id}`)).form;

export interface FormInput {
  title?: string;
  detail?: string;
  notes?: string;
  /** "YYYY-MM-DD"。create 走 fromisoformat、edit 走 strptime("%Y-%m-%d")，这个格式两边都吃。 */
  expired?: string;
  /** 空串 = 不限人数（后端 _normalize_max_members 把空串/None/<=0 一律当 null）。 */
  max_members?: string | number | null;
  closed_manually?: boolean;
  /** 只传要改的开关即可；parent_1 / parent_1_phone 后端会互相补齐。 */
  field_switches?: Partial<Record<string, boolean>>;
}

/** 建表。title / detail / expired 三个是必填，缺一个后端回「缺少字段: x」。 */
export const createForm = (input: FormInput) =>
  http.post<{ status: string; message: string; form: RegisFormDetail }>("/form/create", input);

/** ⚠️ 改表是 **POST**（不是 PUT），而且只回 {status, message, form_id}，不回整张表。 */
export const updateForm = (formId: number, input: FormInput) =>
  http.post<{ status: string; message: string; form_id: number }>(
    `/form/edit_form/${formId}`,
    input,
  );

/** ⚠️ 删表是 POST + body，**不是** DELETE /form/{id}。整张表连同成员关联一起级联删。 */
export const deleteForm = (formId: number) =>
  http.post<{ status: string; message: string }>("/form/remove_form", { form_id: formId });

// ─────────────────────────── 报名费 ───────────────────────────

/**
 * 某张表的收费项。
 * ★ 和 form.fees 是同一批数据 —— 详情接口已经带了 fees，单独拉是为了增删改之后
 *   只失效这一小块，不用把整张表（含全部成员）重新拉一遍。
 */
export const fetchFees = (formId: number) =>
  http.get<FeeListResponse>(`/form/fee/list/${formId}`);

export interface FeeInput {
  category: string;
  /** 后端直接塞进 Numeric(10,2)，字符串也吃。 */
  amount: string | number;
  age_range_from?: string | number | null;
  age_range_to?: string | number | null;
  description?: string | null;
  image_path?: string | null;
}

export const addFee = (formId: number, input: FeeInput) =>
  http.post(`/form/fee/add/${formId}`, input);

/** ⚠️ 改收费项是 PUT，加是 POST，删是 DELETE —— 同一组路由三种方法，别照着抄。 */
export const updateFee = (feeId: number, input: Partial<FeeInput>) =>
  http.put(`/form/fee/edit/${feeId}`, input);

export const deleteFee = (feeId: number) => http.delete(`/form/fee/delete/${feeId}`);

// ─────────────────────────── 报名记录 ───────────────────────────

export interface MemberFieldInput {
  form_id: number;
  member_id: number;
  /**
   * 要改的字段：
   *   · RegisMemberData 的列名（name_cn / phone / medical …）→ 改资料
   *   · 扩展字段配置的 **id**（数字或数字字符串）→ 改那一格自定义字段
   *   · "parental_data" → 整份家长同意书
   * ★ 一次只能改**一个**字段，后端没有批量口。改三个就是三次请求。
   */
  field: string | number;
  value: unknown;
}

/**
 * 改一条报名记录的某个字段。
 * ★ field 传 "nric" 会走「改身份证 / 合并成员」那条路（可能把两个成员合成一个），
 *   要先调 /form/preview_member_nric_change 给人看影响。这里**有意不做**，
 *   所以界面上 NRIC 是只读的。
 */
export const updateMemberField = (input: MemberFieldInput) =>
  http.post<{ status: string; message: string; target?: string }>("/form/edit_member", input);

/**
 * 把成员从这张表里移除（成员本身和别的表的报名都还在）。
 * 后端会拦：有「处理中 / 已确认」的付款记录时不许移除，回 400 + 中文说明。
 */
export const removeMember = (formId: number, memberId: number) =>
  http.post<{ status: string; message: string }>("/form/remove_regis_form_member", {
    form_id: formId,
    member_id: memberId,
  });

// ─────────────────────────── 缴费 ───────────────────────────

/**
 * 改缴费状态。
 * ★ 权限只认 **account_edit**（财政），form_edit 改不了 —— 这是有意的不对称：
 *   报名表管理员不能自己把自己的付款点成「已确认」。别为了对称放宽界面。
 */
export const updatePaymentStatus = (
  paymentId: number,
  status: PaymentStatus,
  counter?: string,
) =>
  http.post(
    `/form/payment/update_status/${paymentId}`,
    // counter 只在真的要改时才传：后端是 `if "counter" in data`，
    // 传 undefined 会被 JSON.stringify 丢掉，传 null 却会把柜台清空。
    counter === undefined ? { status } : { status, counter },
  );

/** 只有 status === "fail" 的记录能删，其余后端回 400。同样只认 account_edit。 */
export const deletePayment = (paymentId: number) =>
  http.delete(`/form/payment/${paymentId}`);

/**
 * 付款截图地址。
 * ★ 不能用 payment.proof_image_path —— 那个值带着旧的 `/api` 前缀（models/form.py
 *   proof_image_url()），拿去拼会得到 {BASE}/api/form/…，404。
 * ★ 必须用 API_ROOT：APK 里裸路径会去找 capacitor://localhost/form/…。
 * ⚠️ 这条接口要权限，网页版靠会话 Cookie 能直接开；**APK 里带不上 Bearer**
 *   （<img> / <a> 没法设请求头），壳里点开会是 401。见 blockers。
 */
export const paymentProofUrl = (paymentId: number) =>
  `${API_ROOT}/form/payment/proof_image/${paymentId}`;
