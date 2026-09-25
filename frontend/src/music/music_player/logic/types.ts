export type AlbumRecord = {
  id: number;
  name: string;
  cover_url?: string | null;
  image?: string | null;
  album_total_minutes?: number | null;
  description?: string | null;
  created_at?: string;
  music_list?: MusicRecord[];
};

export type MusicRecord = {
  id: number;
  title: string;
  album_id?: number | null;
  artist_id?: number | null;
  file_name?: string;
  file_type?: string;
  file_size?: number;
  duration?: number | null;
  cover_url?: string | null;
  play_minutes?: number | null;
  created_at?: string;
  album?: AlbumRecord | null;
  // 伴奏版音频（可选）
  has_accompaniment?: boolean;
  accompaniment_file_name?: string | null;
  accompaniment_file_type?: string | null;
  accompaniment_file_size?: number | null;
};

export type MinuteLogRecord = {
  id: number;
  created_at?: string | null;
  music_user_play_minute_id?: number | null;
  music_id?: number | null;
  music_title?: string | null;
  user_id?: number | null;
  username?: string | null;
  display_name?: string | null;
};

export type MinuteLogsResponse = {
  items?: MinuteLogRecord[];
  page?: number;
  per_page?: number;
  total?: number;
  total_pages?: number;
  timezone?: string;
};

export type LastPlayedMusicRecord = {
  music_user_play_minute_id?: number | null;
  music_id?: number | null;
  music_title?: string | null;
  user_id?: number | null;
  username?: string | null;
  display_name?: string | null;
  play_minutes?: number | null;
  played_at?: string | null;
};

export type LastPlayedMusicResponse = {
  last_played?: LastPlayedMusicRecord | null;
  timezone?: string;
};

export type PlaybackDeviceRecord = {
  device_id: string;
  device_name: string;
  kind: "web" | "android" | string;
  last_seen: number;
  is_playing: boolean;
  is_active: boolean;
};

/** 服务端「当前出声设备」状态 + 在线设备列表。 */
export type PlaybackDeviceState = {
  active_device_id: string | null;
  active_device_name: string | null;
  music_id: number | null;
  position_ms: number;
  duration_ms: number;
  is_playing: boolean;
  updated_at?: number | null;
  server_time?: number;
  stale: boolean;
  /** 只有带 device_id 的请求才会返回。 */
  is_active?: boolean;
  devices?: PlaybackDeviceRecord[];
  /** transfer 时：从哪台切过来、目标是否应接着播。 */
  from_device_id?: string | null;
  resume?: boolean;
};

export type PlaybackCommandAction = "play" | "pause" | "toggle" | "next" | "previous" | "seek" | "play_music" | "set_queue";

export type PlaybackCommandMessage = {
  target_device_id: string;
  action: PlaybackCommandAction;
  payload?: Record<string, unknown>;
  requested_by?: string | null;
};

export type PlaylistMemberRecord = {
  id: number;
  username?: string | null;
  display_name?: string | null;
  is_owner?: boolean;
};

export type PlaylistRecord = {
  id: number;
  name: string;
  description?: string | null;
  user_id?: number | null;
  owner_id?: number | null;
  is_owner?: boolean;
  /** 公开歌单：所有登录用户可见可播，只有成员能改。 */
  is_public?: boolean;
  owner_name?: string | null;
  can_edit?: boolean;
  created_at?: string;
  updated_at?: string;
  music_ids?: number[];
  members?: PlaylistMemberRecord[];
  musics?: MusicRecord[];
};
