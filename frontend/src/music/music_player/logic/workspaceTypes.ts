export type Toast = { type: "success" | "error"; text: string } | null;

export type AlbumDraft = {
  name: string;
  description: string;
};

export type TrackDraft = {
  title: string;
  album_id: string;
};

export type MusicUploadDraft = {
  title: string;
  file: File;
};

export type PlaylistDraft = {
  name: string;
  description: string;
};

export type WorkspaceScreen = "albums" | "tracks" | "editor";

export type EditorMode = "album" | "track" | null;

export const EMPTY_ALBUM_DRAFT: AlbumDraft = { name: "", description: "" };
export const EMPTY_TRACK_DRAFT: TrackDraft = { title: "", album_id: "" };
export const EMPTY_PLAYLIST_DRAFT: PlaylistDraft = { name: "", description: "" };
