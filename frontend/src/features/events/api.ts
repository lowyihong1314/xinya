/**
 * 活动与相册。后端 backend/api/event/router.py（挂载前缀 /event_data）
 * + backend/api/media/router.py（照片爱心、上传）。
 *
 * ⚠️ 前端页面地址用 /events（复数），后端是 /event_data —— 不冲突，
 *    而且避开了 public_api 那条 /event_data/{id:int}。
 */
import { http } from "@/shared/api/client";

import type { EventDetailResponse, EventItem, EventListResponse } from "./types";

export const eventKeys = {
  all: ["events"] as const,
  list: (params: EventListParams) => [...eventKeys.all, "list", params] as const,
  detail: (id: number) => [...eventKeys.all, "detail", id] as const,
};

export interface EventListParams {
  page?: number;
  search?: string;
}

export const fetchEvents = (params: EventListParams = {}) =>
  http.get<EventListResponse>("/event_data/get_all_event", {
    query: { page_num: params.page, search_value: params.search || undefined },
  });

/**
 * 单个活动。
 * ⚠️ 走的是 public_api 的 `GET /event_data/{id:int}`（公开，匿名可看公开活动），
 *    不是 event 模块自己的具名路由。两者同处一个命名空间，靠 :int 转换器区分。
 */
export const fetchEvent = async (id: number): Promise<EventItem> =>
  (await http.get<EventDetailResponse>(`/event_data/${id}`)).data;

/** 照片点爱心（再按一次取消）。活动公开时匿名访客也能按。 */
export const toggleHeart = (fileId: number, visitorToken?: string) =>
  http.post<{ status: string; hearted: boolean; heart_count: number }>(
    `/media/album_file/${fileId}/heart`,
    visitorToken ? { visitor_token: visitorToken } : {},
  );
