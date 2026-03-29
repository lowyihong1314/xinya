export type AboutEntry = {
  id: number;
  username: string;
  created_at: string;
  text: string;
};

export type HistoryEntry = {
  id: number;
  text: string;
  img: string | null;
  date: string;
};

export type InfoUser = {
  username?: string;
};

export type TreeHoleEntry = {
  id: number;
  created_at?: string | null;
  updated_at?: string | null;
  author_name?: string | null;
  message: string;
  ip?: string | null;
  phone?: string | null;
  is_spam?: boolean | null;
  display?: boolean | null;
};
