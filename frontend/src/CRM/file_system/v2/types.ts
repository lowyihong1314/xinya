export type {
  DirectoryNode,
  DirectoryResult,
  FileDetail,
  FileRow,
  PermissionRow,
  SelectableItem,
  Toast,
  TrashRow,
  TreeResponse,
} from "../react/types";

import type { FileRow, SelectableItem } from "../react/types";

export type SortKey = "name" | "size" | "updated_at" | "owner";

export type SortState = {
  key: SortKey;
  dir: "asc" | "desc";
};

export type SearchResult = {
  query: string;
  items: FileRow[];
  truncated: boolean;
};

export type BatchDeleteItem =
  | { type: "file"; id: number }
  | { type: "dir"; path: string };

export type BatchDeleteResult = {
  results: Array<{ key: number | string; success: boolean; error?: string }>;
  deleted: number;
};

export type ContextMenuState = {
  x: number;
  y: number;
  item: SelectableItem;
};

export type ActiveDialog =
  | { kind: "rename"; item: SelectableItem }
  | { kind: "newFolder" }
  | { kind: "share"; item: SelectableItem }
  | { kind: "move"; items: SelectableItem[] }
  | { kind: "dirPermission"; dir: SelectableItem };

export type DirTreeNode = {
  name: string;
  path: string;
  children: DirTreeNode[];
};
