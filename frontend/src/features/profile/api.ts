/**
 * 我的资料。后端 backend/api/user_control/router.py。
 *
 * ⚠️ 登录/登出/当前用户不在这里 —— 那是**会话**，归 @/shared/auth 管，
 *    全仓只有一处知道登录接口长什么样。这里只放「我的资料页」用到的读接口。
 */
import { http } from "@/shared/api/client";

import type { FootprintsResponse, MembershipContextResponse } from "./types";

export const profileKeys = {
  all: ["profile"] as const,
  footprints: () => [...profileKeys.all, "footprints"] as const,
  membership: () => [...profileKeys.all, "membership"] as const,
};

/** 我参加过的活动、报过的名、交过的钱。 */
export const fetchFootprints = () => http.get<FootprintsResponse>("/user_control/my_footprints");

/** 会员状态与可办理的升级/续期路径。 */
export const fetchMembershipContext = () =>
  http.get<MembershipContextResponse>("/user_control/membership/context");

/**
 * 改个人资料。收的是**整份字段**（后端 edit_user_data），
 * 所以调用方要把当前值一起带上，不能只发改动的那几个。
 */
export const saveProfile = (payload: Record<string, unknown>) =>
  http.post("/user_control/edit_user_data", payload);

export const changePassword = (payload: { old_password: string; new_password: string }) =>
  http.post("/user_control/change_password", payload);
