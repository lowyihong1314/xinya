import { startTransition, useEffect, useMemo, useRef, useState } from "react";

import { useUserState } from "../../../app/UserState";
import { fetchAllUsers, fetchDepartments } from "../../user_control/react/api";
import type { DepartmentRecord, UserRecord } from "../../user_control/react/types";
import { showConfirmDialog } from "../../../js/dialogs";
import { downloadUrlOrShare } from "../../../js/browserActions";
import { useEnsureDesignTokens } from "../../../theme/designTokens";
import * as api from "./api";
import type {
  ActiveDialog,
  BatchDeleteItem,
  ContextMenuState,
  DirectoryResult,
  FileDetail,
  PermissionRow,
  SearchResult,
  SelectableItem,
  SortState,
  Toast,
  TrashRow,
  TreeResponse,
} from "./types";
import { LOAD_MORE_STEP, errorMessage, isPreviewable, joinPath, sortItems, triggerDownload } from "./utils";

export type DrawerState = {
  open: boolean;
  item: SelectableItem | null;
  detail: FileDetail | null;
  dirDetail: api.DirectoryDetail | null;
  permissions: PermissionRow[];
};

const CLOSED_DRAWER: DrawerState = { open: false, item: null, detail: null, dirDetail: null, permissions: [] };

export function useFileSystemV2Controller() {
  useEnsureDesignTokens();
  const { isMobile } = useUserState();

  const [tree, setTree] = useState<TreeResponse>({ directories: [], files: [] });
  const [directory, setDirectory] = useState<DirectoryResult | null>(null);
  const [currentPath, setCurrentPath] = useState("/home");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [sort, setSort] = useState<SortState>({ key: "name", dir: "asc" });
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(LOAD_MORE_STEP);
  const [treeCollapsed, setTreeCollapsed] = useState(isMobile);
  const [searchInput, setSearchInput] = useState("");
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [drawer, setDrawer] = useState<DrawerState>(CLOSED_DRAWER);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [activeDialog, setActiveDialog] = useState<ActiveDialog | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trash, setTrash] = useState<TrashRow[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [departments, setDepartments] = useState<DepartmentRecord[]>([]);
  const [previewItem, setPreviewItem] = useState<SelectableItem | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // 全局搜索：输入 ≥2 字符时防抖 300ms 调服务端搜索
  useEffect(() => {
    const q = searchInput.trim();
    if (q.length < 2) {
      setSearchResult(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const data = await api.searchFiles(q);
          setSearchResult(data);
        } catch (error) {
          showToast("error", errorMessage(error));
        } finally {
          setSearching(false);
        }
      })();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setVisibleCount(LOAD_MORE_STEP);
  }, [currentPath, sort, searchResult]);

  const items = useMemo<SelectableItem[]>(() => {
    if (!directory) return [];
    const all: SelectableItem[] = [
      ...directory.directories.map((item) => ({ ...item, file_id: -1, type: "dir" as const })),
      ...directory.files,
    ];
    return sortItems(all, sort);
  }, [directory, sort]);

  const visibleItems = useMemo(() => items.slice(0, visibleCount), [items, visibleCount]);

  const selectedItems = useMemo(() => items.filter((item) => selection.has(item.path)), [items, selection]);

  function showToast(tone: Toast["tone"], message: string) {
    setToast({ tone, message });
  }

  async function bootstrap() {
    setLoading(true);
    try {
      const historyData = await api.fetchHistoryViews().catch(() => null);
      const initialPath = historyData?.histories?.[0]?.path || "/home";
      await Promise.all([loadTree(), loadTrash(), loadTargets(), openDirectory(initialPath)]);
    } catch (error) {
      showToast("error", errorMessage(error));
      await openDirectory("/home").catch(() => undefined);
    } finally {
      setLoading(false);
    }
  }

  async function loadTargets() {
    try {
      const [usersData, departmentsData] = await Promise.all([fetchAllUsers(), fetchDepartments()]);
      setUsers(usersData.data || []);
      setDepartments(departmentsData || []);
    } catch {
      // 用户/部门列表仅用于名称显示与权限对话框，失败不阻塞浏览
    }
  }

  async function loadTree() {
    setTree(await api.fetchTree());
  }

  async function loadTrash() {
    const data = await api.fetchTrash();
    setTrash(data.items || []);
  }

  async function openDirectory(path: string) {
    setLoading(true);
    try {
      const data = await api.fetchDirectory(path);
      startTransition(() => {
        setCurrentPath(path);
        setDirectory(data);
        setSelection(new Set());
        setSelectionAnchor(null);
        setDrawer(CLOSED_DRAWER);
        setSearchInput("");
        setSearchResult(null);
      });
    } catch (error) {
      showToast("error", errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  async function refreshCurrent() {
    await Promise.all([loadTree(), openDirectory(currentPath)]);
  }

  async function runAction(task: () => Promise<void>) {
    setLoading(true);
    try {
      await task();
    } catch (error) {
      showToast("error", errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  function select(item: SelectableItem, options?: { additive?: boolean; range?: boolean }) {
    const path = item.path;
    if (options?.range && selectionAnchor) {
      const anchorIndex = items.findIndex((entry) => entry.path === selectionAnchor);
      const targetIndex = items.findIndex((entry) => entry.path === path);
      if (anchorIndex !== -1 && targetIndex !== -1) {
        const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
        const rangePaths = items.slice(start, end + 1).map((entry) => entry.path);
        setSelection((prev) => {
          const next = options.additive ? new Set(prev) : new Set<string>();
          rangePaths.forEach((entry) => next.add(entry));
          return next;
        });
        return;
      }
    }
    if (options?.additive) {
      setSelection((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      });
    } else {
      setSelection(new Set([path]));
    }
    setSelectionAnchor(path);
  }

  function clearSelection() {
    setSelection(new Set());
    setSelectionAnchor(null);
  }

  async function activate(item: SelectableItem) {
    if (item.type === "dir") {
      await openDirectory(item.path);
      return;
    }
    if (isPreviewable(item.name)) {
      setPreviewItem(item);
      return;
    }
    await downloadItem(item);
  }

  async function downloadItem(item: SelectableItem) {
    if (item.type === "dir" || item.file_id < 0) return;
    await downloadUrlOrShare(`/api/files/items/${item.file_id}/content`, item.name, {
      isMobile,
      title: item.name,
      text: item.name,
      fallbackUrl: `${window.location.origin}/api/files/items/${item.file_id}/content`,
    });
  }

  async function openDrawerFor(item: SelectableItem) {
    setDrawer({ open: true, item, detail: null, dirDetail: null, permissions: [] });
    try {
      if (item.type === "dir") {
        const dirDetail = await api.fetchDirectoryDetail(item.path);
        setDrawer((prev) => (prev.item?.path === item.path ? { ...prev, dirDetail } : prev));
      } else {
        const [detail, permissionData] = await Promise.all([
          api.fetchFileDetail(item.file_id),
          api.fetchPermissions(item.file_id),
        ]);
        setDrawer((prev) =>
          prev.item?.path === item.path
            ? { ...prev, detail, permissions: permissionData.permissions || [] }
            : prev,
        );
      }
    } catch (error) {
      showToast("error", errorMessage(error));
    }
  }

  function closeDrawer() {
    setDrawer(CLOSED_DRAWER);
  }

  async function uploadFileList(files: File[], relativePaths: string[]) {
    if (!files.length) return;
    await runAction(async () => {
      const formData = new FormData();
      formData.append("folder_location", currentPath);
      files.forEach((file, index) => {
        formData.append("files", file);
        formData.append("relative_paths[]", relativePaths[index] || file.name);
      });
      await api.uploadEntries(formData);
      showToast("success", `已上传 ${files.length} 个文件`);
      await refreshCurrent();
    });
  }

  async function moveItemsTo(paths: string[], dirPath: string) {
    const movable = paths.filter((path) => path !== dirPath && !dirPath.startsWith(`${path}/`));
    if (!movable.length) return;
    await runAction(async () => {
      let failed = 0;
      for (const path of movable) {
        try {
          await api.moveFile(path, dirPath);
        } catch (error) {
          failed += 1;
          showToast("error", `移动 ${path} 失败：${errorMessage(error)}`);
        }
      }
      if (failed === 0) {
        showToast("success", movable.length > 1 ? `已移动 ${movable.length} 项` : "已移动");
      }
      await refreshCurrent();
    });
  }

  async function deleteItems(itemsToDelete: SelectableItem[]) {
    if (!itemsToDelete.length) return;
    const label =
      itemsToDelete.length === 1 ? `「${itemsToDelete[0].name}」` : `选中的 ${itemsToDelete.length} 项`;
    const confirmed = await showConfirmDialog({
      message: `确认把${label}移动到回收站？`,
      tone: "danger",
    });
    if (!confirmed) return;
    await runAction(async () => {
      const payload: BatchDeleteItem[] = itemsToDelete.map((item) =>
        item.type === "dir" ? { type: "dir", path: item.path } : { type: "file", id: item.file_id },
      );
      const data = await api.batchDelete(payload);
      const failures = data.results.filter((entry) => !entry.success);
      if (failures.length) {
        showToast("error", `已删除 ${data.results.length - failures.length} 项，失败 ${failures.length} 项：${failures[0].error || ""}`);
      } else {
        showToast("success", "已移动到回收站");
      }
      clearSelection();
      await refreshCurrent();
      await loadTrash();
    });
  }

  async function downloadArchiveOf(itemsToArchive: SelectableItem[]) {
    const ids = itemsToArchive.filter((item) => item.type === "file" && item.file_id > 0).map((item) => item.file_id);
    if (!ids.length) {
      showToast("info", "请选择文件（目录请进入后选择文件打包）");
      return;
    }
    await runAction(async () => {
      const blob = await api.downloadArchive(ids);
      await triggerDownload(blob, "files.zip", isMobile);
    });
  }

  // —— 对话框提交 ——

  async function submitNewFolder(name: string) {
    await runAction(async () => {
      await api.createDirectory(joinPath(currentPath, name));
      showToast("success", "文件夹已创建");
      setActiveDialog(null);
      await refreshCurrent();
    });
  }

  async function submitRename(item: SelectableItem, newName: string) {
    if (!newName || newName === item.name) {
      setActiveDialog(null);
      return;
    }
    await runAction(async () => {
      if (item.type === "dir") {
        await api.renameDirectory(item.path, newName);
      } else {
        await api.renameFile(item.file_id, newName);
      }
      showToast("success", "名称已更新");
      setActiveDialog(null);
      await refreshCurrent();
    });
  }

  async function submitMove(itemsToMove: SelectableItem[], dirPath: string) {
    setActiveDialog(null);
    await moveItemsTo(itemsToMove.map((item) => item.path), dirPath);
  }

  async function submitShare(item: SelectableItem, minutes: number, credit: number): Promise<string | null> {
    if (item.type === "dir" || item.file_id < 0) return null;
    try {
      const data = await api.createShare(item.file_id, minutes, credit);
      return `${window.location.origin}${data.share_url}`;
    } catch (error) {
      showToast("error", errorMessage(error));
      return null;
    }
  }

  async function submitDirPermission(
    dirPath: string,
    targetType: "user" | "department",
    targetId: number,
    permission: string,
  ) {
    await runAction(async () => {
      await api.setDirectoryPermission(dirPath, targetType, targetId, permission);
      showToast("success", "目录权限已更新");
      setActiveDialog(null);
    });
  }

  async function removePermission(permissionId: number) {
    await runAction(async () => {
      await api.removePermission(permissionId);
      showToast("success", "权限已删除");
      if (drawer.item && drawer.item.type === "file") {
        await openDrawerFor(drawer.item);
      }
    });
  }

  // —— 回收站 ——

  async function restoreTrashItem(trashId: number) {
    await runAction(async () => {
      await api.restoreTrash(trashId);
      showToast("success", "已恢复");
      await Promise.all([loadTrash(), loadTree(), openDirectory(currentPath)]);
    });
  }

  async function purgeTrashItem(trashId: number, name: string) {
    const confirmed = await showConfirmDialog({
      message: `确认永久删除「${name}」？此操作不可恢复。`,
      tone: "danger",
    });
    if (!confirmed) return;
    await runAction(async () => {
      await api.purgeTrash(trashId);
      showToast("success", "已永久删除");
      await loadTrash();
    });
  }

  async function purgeAllTrashItems() {
    if (!trash.length) return;
    const confirmed = await showConfirmDialog({
      message: `确认清空回收站（${trash.length} 项）？此操作不可恢复。`,
      tone: "danger",
    });
    if (!confirmed) return;
    await runAction(async () => {
      const data = await api.purgeAllTrash();
      showToast("success", `已清空回收站（${data.purged} 项）`);
      await loadTrash();
    });
  }

  const state = {
    isMobile,
    tree,
    directory,
    currentPath,
    loading,
    toast,
    viewMode,
    sort,
    selection,
    selectedItems,
    items,
    visibleItems,
    totalCount: items.length,
    visibleCount,
    treeCollapsed,
    searchInput,
    searchResult,
    searching,
    drawer,
    contextMenu,
    activeDialog,
    trashOpen,
    trash,
    users,
    departments,
    previewItem,
    fileInputRef,
    folderInputRef,
  };

  const actions = {
    showToast,
    openDirectory: (path: string) => void openDirectory(path),
    refreshCurrent: () => void refreshCurrent(),
    setViewMode,
    setSort: (key: SortState["key"]) =>
      setSort((prev) => ({ key, dir: prev.key === key && prev.dir === "asc" ? "desc" : "asc" })),
    toggleTree: () => setTreeCollapsed((prev) => !prev),
    select,
    clearSelection,
    activate: (item: SelectableItem) => void activate(item),
    downloadItem: (item: SelectableItem) => void downloadItem(item),
    openDrawerFor: (item: SelectableItem) => void openDrawerFor(item),
    closeDrawer,
    setContextMenu,
    openDialog: setActiveDialog,
    closeDialog: () => setActiveDialog(null),
    setSearchInput,
    loadMore: () => setVisibleCount((prev) => prev + LOAD_MORE_STEP),
    uploadFileList: (files: File[], relativePaths: string[]) => void uploadFileList(files, relativePaths),
    moveItemsTo: (paths: string[], dirPath: string) => void moveItemsTo(paths, dirPath),
    deleteItems: (itemsToDelete: SelectableItem[]) => void deleteItems(itemsToDelete),
    downloadArchiveOf: (itemsToArchive: SelectableItem[]) => void downloadArchiveOf(itemsToArchive),
    submitNewFolder,
    submitRename,
    submitMove,
    submitShare,
    submitDirPermission,
    removePermission: (permissionId: number) => void removePermission(permissionId),
    setTrashOpen,
    restoreTrashItem: (trashId: number) => void restoreTrashItem(trashId),
    purgeTrashItem: (trashId: number, name: string) => void purgeTrashItem(trashId, name),
    purgeAllTrashItems: () => void purgeAllTrashItems(),
    setPreviewItem,
  };

  return { state, actions };
}

export type FsState = ReturnType<typeof useFileSystemV2Controller>["state"];
export type FsActions = ReturnType<typeof useFileSystemV2Controller>["actions"];
