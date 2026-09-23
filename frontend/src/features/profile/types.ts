/**
 * 后端 /user_control/* 里与「我」有关的部分。
 *
 * ⚠️ 形状来自后端代码（backend/api/user_control/router.py + service.py），
 *    这些接口都要登录，api-shape.mjs 实测不到。字段以后端 return 语句为准。
 */

export interface FootprintSummary {
  registration_form_count: number;
  event_count: number;
  youth_class_count: number;
  payment_count: number;
  total_count: number;
}

export interface FootprintsResponse {
  status: string;
  /** 没绑 NRIC 的账号这里是 null，但 summary 仍然是结构完整的全 0 —— 不用写第二套渲染分支。 */
  member: Record<string, unknown> | null;
  summary: FootprintSummary;
  registrations: Array<Record<string, unknown>>;
  youth_class_registrations: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface MembershipContext {
  user: Record<string, unknown> | null;
  member: Record<string, unknown> | null;
  age: number | null;
  is_minor: boolean;
  registration_route: {
    target: string | null;
    target_label: string | null;
    eligible: boolean;
    message: string;
  };
  [key: string]: unknown;
}

export interface MembershipContextResponse {
  status: string;
  context: MembershipContext;
}
