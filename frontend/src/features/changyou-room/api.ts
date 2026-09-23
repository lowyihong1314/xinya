/**
 * 唱游房间。后端 backend/api/changyou_room/router.py（挂载前缀 /changyou_room）。
 *
 * ⚠️ 前端页面地址是 /changyou（控制台）和 /changyou-room/:roomId（播放端），
 *    和后端的 /changyou_room/* **不冲突** —— 比的是完整路径，而后端没有
 *    /changyou 也没有 /changyou-room 这两条。见 src/app/routes.ts 的说明。
 *    播放端故意用 /changyou-room：后端 serialize_room 发出去的 playback_url
 *    就是这个形状，已经印成二维码发出去的链接得继续能打开。
 *
 * ⚠️ 错误体是 `{"error": "..."}`（这批路由是从 Flask 逐字搬过来的，
 *    没改成 {"status":"error","message":...}）。shared/api/errors 的
 *    extractMessage 认 message/error/detail 三个键，所以 ApiError.message
 *    拿到的仍然是后端那句中文，页面不用特殊处理。
 */
import { http } from "@/shared/api/client";

import type {
  ChangyouRoom,
  CreateRoomResponse,
  NotifyResponse,
  ProjectionBlock,
  RoomCurrent,
  RoomDetailResponse,
  RoomListResponse,
  RoomMutationResponse,
  RoomNotification,
  VersionKind,
} from "./types";

// ── SSE ────────────────────────────────────────────────────────────────
// app 段必须和后端 service.py 的 REALTIME_APP 逐字一致，事件名同理
// （core/realtime.py 用 ^[a-z][a-z0-9_]*$ 校验 app 名，写成 changyou-room 会一直 404）。
export const CHANGYOU_REALTIME_APP = "changyou_room";
export const ROOM_UPDATE_EVENT = "changyou_room_update";
export const ROOM_NOTIFICATION_EVENT = "changyou_room_notification";

export const changyouKeys = {
  all: ["changyou-room"] as const,
  rooms: () => [...changyouKeys.all, "rooms"] as const,
  /** 房间元信息（**只有这条带 role**）。 */
  room: (roomId: string) => [...changyouKeys.all, "room", roomId] as const,
  /** 当前状态：房间 + 歌 + 投屏。SSE 来消息时直接 setQueryData 这个键。 */
  current: (roomId: string) => [...changyouKeys.all, "current", roomId] as const,
};

// room_id 是后端生成的 8 位 [A-Za-z0-9]，本来不用转义；但地址栏里的 roomId
// 是用户可改的，不转义的话 "a/b" 会把路径拼歪（变成另一条路由）。
const roomPath = (roomId: string) => `/changyou_room/room/${encodeURIComponent(roomId)}`;

/** 最近 100 个未过期的房间，按创建时间倒序。 */
export const fetchRooms = async (): Promise<ChangyouRoom[]> =>
  (await http.get<RoomListResponse>("/changyou_room/list")).rooms;

/** 建房。任何登录用户都能建，建的人自动是房主（房主永远能控制自己的房间）。 */
export const createRoom = async (topic: string): Promise<ChangyouRoom> =>
  (await http.post<CreateRoomResponse>("/changyou_room/create", { topic })).room;

/** 房间元信息。**这是拿 role 的唯一途径** —— 别在前端自己算「我是不是房主」。 */
export const fetchRoom = async (roomId: string): Promise<ChangyouRoom> =>
  (await http.get<RoomDetailResponse>(roomPath(roomId))).room;

/** 当前状态。公开接口（没有 login_required），播放端靠它。 */
export const fetchRoomCurrent = (roomId: string) =>
  http.get<RoomCurrent>(`${roomPath(roomId)}/current`);

export interface PushSongInput {
  song_entry_id: number;
  version_kind: VersionKind;
  /** version_kind === "user" 时必填，指「谁的编辑版」。 */
  editor_user_id?: number | null;
}

/**
 * 推一首歌到房间。
 * ★ 后端会**顺手清空上一首的投屏和标记** —— 不清的话播放端会拿旧投屏盖住新歌。
 */
export const pushSong = (roomId: string, input: PushSongInput) =>
  http.post<RoomMutationResponse>(`${roomPath(roomId)}/push`, input);

export interface ProjectPageInput extends PushSongInput {
  page_index: number;
  page_count: number;
  page_label?: string | null;
  content: string;
  blocks: ProjectionBlock[];
  marker_index?: number | null;
}

/** 投一页（歌词块 + 可选的高亮行）。 */
export const projectPage = (roomId: string, input: ProjectPageInput) =>
  http.post<RoomMutationResponse>(`${roomPath(roomId)}/project`, input);

/**
 * 只挪高亮行，不动投屏内容 —— 演出时点得最频繁的一条，所以单独一个接口。
 * 传 null 取消高亮。
 */
export const updateMarker = (roomId: string, markerIndex: number | null) =>
  http.post<RoomMutationResponse>(`${roomPath(roomId)}/marker`, { marker_index: markerIndex });

export interface NotifyInput {
  kind: RoomNotification["kind"];
  content: string;
}

/**
 * 全场通知：一行字或一个二维码，弹在所有播放端上。
 * **不落 Redis**，纯广播 —— 后进来的人看不到，刷新也没了。
 */
export const notifyRoom = (roomId: string, input: NotifyInput) =>
  http.post<NotifyResponse>(`${roomPath(roomId)}/notify`, input);
