/**
 * 后端 /event_data/* 的数据形状。
 * 用 `node scripts/api-shape.mjs /event_data/get_all_event` 实测过。
 */

export interface AlbumFile {
  id: number;
  event_id: number;
  file_name: string;
  /** 相册内的序号，以及前后张的 id（灯箱翻页用）。 */
  no: number;
  prev_id: number | null;
  next_id: number | null;
  title: string | null;
  info: string | null;
  /** image / video / …。决定用 <img> 还是 <video>。 */
  file_type: string;
  is_public: boolean;
  created_at: string;
  username: string;
  user_display_name: string | null;
  /**
   * 爱心数与「我按过没」。后端 /media/album_file/{id}/heart 维护。
   * ★ 字段名是 hearted_by_me（**不是** hearted）—— 实测过，别凭直觉写。
   */
  heart_count?: number;
  hearted_by_me?: boolean;
  [key: string]: unknown;
}

export interface OrganizingUnit {
  id: number;
  name?: string | null;
  [key: string]: unknown;
}

export interface EventItem {
  id: number;
  event_name: string;
  event_code: string;
  datetime: string;
  end_datetime: string | null;
  location: string | null;
  location_name: string | null;
  lat: number | null;
  lng: number | null;
  purpose: string | null;
  target: string | null;
  type: string | null;
  /** 有没有相册。false 时详情页不显示照片区。 */
  album: boolean;
  /** 公开的活动匿名访客也能看（分享链接靠它）。 */
  is_public: boolean;
  event_image: string | null;
  brochure_path: string | null;
  brochure_name: string | null;
  organizing_units: OrganizingUnit[];
  album_files: AlbumFile[];
  user_id: number;
  username: string;
  display_name: string | null;
  /** 上一个 / 下一个活动，详情页用来做翻页。 */
  prev_event_id: number | null;
  next_event_id: number | null;
  [key: string]: unknown;
}

/** 列表接口是**分页**的，这些字段要用上，不要一次拉全部。 */
export interface EventListResponse {
  status: string;
  login: boolean;
  page_num: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
  search_value: string;
  data: EventItem[];
}

/** 详情接口把内容包在 data 里（与列表的 data 数组不是一回事）。 */
export interface EventDetailResponse {
  status: string;
  data: EventItem;
}
