/**
 * 报销。后端 backend/api/account/router.py（挂载前缀 /account）。
 */
import { http } from "@/shared/api/client";

import type { Claim, ClaimListResponse } from "./types";

export const claimKeys = {
  all: ["claims"] as const,
  list: () => [...claimKeys.all, "list"] as const,
};

export const fetchClaims = () => http.get<ClaimListResponse>("/account/get_all_claim");

export const submitClaim = (payload: Record<string, unknown>) =>
  http.post<{ status: string; data?: Claim }>("/account/submit_new_claim", payload);

export const updateClaim = (id: number, payload: Record<string, unknown>) =>
  http.put(`/account/claim/${id}`, payload);

export const deleteClaim = (id: number) => http.delete(`/account/delete_claim/${id}`);

/** 审批：通过 / 否决。后端按审批人身份累计成 status 的 "通过数/否决数"。 */
export const decideClaim = (id: number, payload: Record<string, unknown>) =>
  http.post(`/account/claim_decision/${id}`, payload);

/** 撤回自己已经做过的审批决定。 */
export const withdrawDecision = (id: number) =>
  http.post(`/account/claim/${id}/withdraw_decision`);
