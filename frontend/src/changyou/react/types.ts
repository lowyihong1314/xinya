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
};
