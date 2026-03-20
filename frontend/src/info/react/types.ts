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
