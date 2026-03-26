export type SongbookVersionOption = {
  kind: "base" | "user";
  label: string;
  user_id?: number | null;
  editor_name?: string | null;
  updated_at?: string | null;
  is_me?: boolean;
};

export type SongbookEntry = {
  id: number;
  song_number?: number | null;
  title: string;
  title_normalized?: string;
  variant: "C" | "G";
  heading_text?: string | null;
  original_key?: string | null;
  selected_key?: string | null;
  bpm?: string | null;
  time_signature?: string | null;
  source_doc?: string | null;
  published: boolean;
  sort_order?: number;
  created_at?: string | null;
  updated_at?: string | null;
  content?: string;
  has_user_override?: boolean;
  user_override_updated_at?: string | null;
  active_version?: "base" | "user";
  active_version_label?: string;
  active_editor_user_id?: number | null;
  active_editor_name?: string | null;
  versions?: SongbookVersionOption[];
};
