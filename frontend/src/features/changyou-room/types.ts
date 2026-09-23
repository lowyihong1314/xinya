/**
 * 后端 /changyou_room/* 的数据形状。见 backend/api/changyou_room/router.py
 * 与同目录 service.py 的 serialize_room / build_room_current_payload。
 *
 * ── 形状核对情况（scripts/api-shape.mjs 打的是 dev 站的真实响应）──────────
 *   ✔ GET /room/{id}/current —— **实测过**。这条故意没有 login_required
 *     （播放端是观众扫码打开的公开页），所以工具能直接看到。
 *     「空房间」和「有歌 + 有投屏」两个分支各跑了一遍，两种 projection 的
 *     null / 对象分支都确认了。
 *   ⚠ /list · /create · /room/{id} · push · project · marker · notify
 *     —— 需要登录，工具只拿得到 401，**形状来自后端代码的 return 语句，未实测**。
 *     好在三条写操作的成功体是 `{"success": true, **current_payload}`，
 *     current_payload 和 /current 是同一个函数拼的（build_room_current_payload），
 *     所以那部分等于实测过。
 */

/**
 * 投屏块：一段歌词（可能带它上方的和弦行和段落标题）。
 *
 * ★ 这个形状是**对客户端的承诺**，不是内部结构：前端 POST /project 时把它
 *   原样塞进请求体，后端 json.dumps 进 Redis，再推给所有播放端；
 *   线上还有一份没法逐个升级的 APK 老播放页按这些键读。改键名就是线上事故。
 */
export interface ProjectionBlock {
  id: string;
  lines: string[];
  /** = lines.join("\n")。两份都存是因为老播放端读的是 text。 */
  text: string;
  /** 段落名（"副歌:"）或首句歌词的前 20 字，控制台的分页列表显示它。 */
  label: string;
  /** 能不能被高亮。段落标题、纯和弦行是 false —— 标记跳过它们。 */
  highlightable: boolean;
  /** 估算的占版面权重，分页时用。 */
  weight: number;
}

/** 当前投屏的那一页。三者全空（没内容、没块、页数 0）时后端给 null。 */
export interface RoomProjection {
  page_index: number;
  page_count: number;
  page_label: string | null;
  content: string;
  blocks: ProjectionBlock[];
  /** 高亮到第几个块（在**本页的 blocks 数组**里的下标），没标记就是 null。 */
  marker_index: number | null;
}

/**
 * 推的是原版还是某个人的编辑版。
 * ⚠️ 后端**不做白名单**（push 里只是 `str(...).strip()`），任何字符串都存得进去；
 *    只是全仓只发这两个值。当成联合类型用，别当成后端保证。
 */
export type VersionKind = "base" | "user";

export interface ChangyouRoom {
  /** 8 位随机串。加上 24 小时 TTL，这就是房间全部的「鉴权」。 */
  room_id: string;
  /** 后端兜底成 "未命名房间"，不会是空串。 */
  topic: string;
  creator_id: number | null;
  creator_name: string | null;
  /** 秒级 unix 时间戳（不是 ISO 字符串）。 */
  created_at: number | null;
  expires_at: number | null;
  song_entry_id: number | null;
  version_kind: VersionKind;
  editor_user_id: number | null;
  /**
   * 播放端地址，形如 `/changyou-room/{room_id}`。
   * ⚠️ **不带 BASE_PATH**（后端逐字保留了 Flask 时代的拼法，见 service.py 的 TODO），
   *    直接拿去跳转在 BASE_PATH=/UTBA_DEMO 的环境会 404。
   *    要用 shared/config/paths 的 publicUrl() 补前缀 —— 那个函数是幂等的。
   */
  playback_url: string;
  projection: RoomProjection | null;
  /**
   * 只有 GET /room/{id} 带这个字段 —— /list 和 /create 的房间对象里**没有**它。
   * 「房主 or 有 changyou_contorl 权限」= controller，其余是 player。
   */
  role?: "controller" | "player";
}

/**
 * 房间里当前那首歌。
 *
 * ⚠️ 两个和 features/songbook 的 SongEntry 长得像但**不一样**的地方，
 *    所以这里单独定义而不是 import 那个类型：
 *      ① `active_version` 在这里是**版本种类**（"base"/"user"），
 *         而 songbook 详情里的 `active_version` 装的是**歌词正文**。
 *         同名不同义，混用的后果是把 "base" 当歌词渲染出来。
 *         本模块的歌词一律读 `content`。
 *      ② 没有 has_user_override / user_override_updated_at
 *         （那两个是 songbook router 自己加的，本模块的 entry 来自
 *         SongbookEntry.to_dict(include_content=True) + 四个 active_* 字段）。
 */
export interface RoomSongEntry {
  id: number;
  song_number: number | null;
  title: string;
  title_normalized: string;
  variant: string | null;
  heading_text: string | null;
  original_key: string | null;
  selected_key: string | null;
  /** 库里是 String(32)，实测也是字符串 —— 别按数字用。 */
  bpm: string | null;
  time_signature: string | null;
  source_doc: string | null;
  published: boolean;
  sort_order: number | null;
  created_at: string | null;
  updated_at: string | null;
  /** 歌词正文。已经按 version_kind / 投屏内容算好，直接渲染。 */
  content: string;
  /** 见上面 ①：这是版本种类，不是正文。 */
  active_version: VersionKind;
  /** "原版" 或 "{某人} 的编辑版"。 */
  active_version_label: string;
  active_editor_user_id: number | null;
  active_editor_name: string | null;
}

/** GET /room/{id}/current 的响应体，也是三条写操作推给播放端的 data。 */
export interface RoomCurrent {
  room: ChangyouRoom;
  /** 没推歌、或者歌被删了 → null。前端按 null 显示空态。 */
  entry: RoomSongEntry | null;
  /** 和 room.projection 同一个对象，后端冗余给了一份。 */
  projection: RoomProjection | null;
}

/** 全场通知。**纯广播，不落 Redis** —— 刷新页面就没了，只有 SSE 收得到。 */
export interface RoomNotification {
  kind: "text" | "qr";
  /** 后端会截断：text 最长 140 字，qr 最长 1200 字（它装的是 URL）。 */
  content: string;
  updated_at: number;
}

// ── 各接口的外层信封 ──────────────────────────────────────────────────
// 别按其中一个的形状猜另一个：/list 是 {rooms:[...]}，/room/{id} 是 {room:{...}}。

export interface RoomListResponse {
  rooms: ChangyouRoom[];
}

export interface RoomDetailResponse {
  room: ChangyouRoom;
}

export interface CreateRoomResponse {
  success: boolean;
  room: ChangyouRoom;
}

/** push / project / marker 三条共用：success + 一份完整的 current。 */
export type RoomMutationResponse = { success: boolean } & RoomCurrent;

export interface NotifyResponse {
  success: boolean;
  notification: RoomNotification;
}
