import { startTransition, useEffect, useMemo, useRef, useState } from "react";

import { fetchAllUsers, fetchDepartments } from "../../user_control/react/api";
import type { DepartmentRecord, UserRecord } from "../../user_control/react/types";
import { showConfirmDialog, showPromptDialog } from "../../../js/dialogs";
import { useEnsureDesignTokens } from "../../../theme/designTokens";
import * as api from "./api";
import type { DirectoryResult, FileDetail, PermissionRow, SelectableItem, Toast, TrashRow, TreeResponse } from "./types";
import { errorMessage, itemsPerPage, joinPath, triggerDownload } from "./utils";

export function useFileSystemController() {
  useEnsureDesignTokens();

  const [tree, setTree] = useState<TreeResponse>({ directories: [], files: [] });
  const [directory, setDirectory] = useState<DirectoryResult | null>(null);
  const [currentPath, setCurrentPath] = useState("/home");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [selectedDetail, setSelectedDetail] = useState<FileDetail | null>(null);
  const [selectedPermissions, setSelectedPermissions] = useState<PermissionRow[]>([]);
  const [trash, setTrash] = useState<TrashRow[]>([]);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [permissionTargetUsers, setPermissionTargetUsers] = useState<UserRecord[]>([]);
  const [permissionTargetDepartments, setPermissionTargetDepartments] = useState<DepartmentRecord[]>([]);
  const [directoryPermissionDialog, setDirectoryPermissionDialog] = useState<{
    open: boolean;
    dirPath: string;
    dirName: string;
    targetType: "user" | "department";
    targetId: string;
    permission: "read" | "read_write" | "read_public";
  }>({
    open: false,
    dirPath: "",
    dirName: "",
    targetType: "user",
    targetId: "",
    permission: "read",
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!directoryPermissionDialog.open) {
      return;
    }

    void (async () => {
      try {
        await loadPermissionTargets();
      } catch (error) {
        showToast("error", errorMessage(error));
      }
    })();
  }, [directoryPermissionDialog.open]);

  useEffect(() => {
    setPage(1);
  }, [currentPath, query]);

  const visibleItems = useMemo(() => {
    const all = directory
      ? [
          ...directory.directories.map((item) => ({ ...item, file_id: -1, type: "dir" as const })),
          ...directory.files,
        ]
      : [];
    const q = query.trim().toLowerCase();
    return all.filter((item) => !q || item.name.toLowerCase().includes(q) || item.path.toLowerCase().includes(q));
  }, [directory, query]);

  const pagedItems = useMemo(() => {
    const start = (page - 1) * itemsPerPage;
    return visibleItems.slice(start, start + itemsPerPage);
  }, [page, visibleItems]);

  const selectedItem = useMemo(() => {
    const selectedPath = selectedPaths[0];
    if (!selectedPath || !directory) return null;
    const selectedFile = directory.files.find((item) => item.path === selectedPath);
    if (selectedFile) {
      return selectedFile;
    }

    const selectedDirectory = directory.directories.find((item) => item.path === selectedPath);
    return (
      selectedDirectory
        ? { ...selectedDirectory, file_id: -1 as const, type: "dir" as const }
        : null
    );
  }, [selectedPaths, directory]);

  async function bootstrap() {
    setLoading(true);
    try {
      const historyData = await api.fetchHistoryViews();
      const initialPath = historyData.histories?.[0]?.path || "/home";
      await Promise.all([loadTree(), loadTrash(), loadPermissionTargets(), openDirectory(initialPath)]);
    } catch (error) {
      showToast("error", errorMessage(error));
      await Promise.all([loadTree(), loadTrash(), loadPermissionTargets(), openDirectory("/home")]);
    } finally {
      setLoading(false);
    }
  }

  async function loadPermissionTargets() {
    const [usersData, departmentsData] = await Promise.all([fetchAllUsers(), fetchDepartments()]);
    setPermissionTargetUsers(usersData.data || []);
    setPermissionTargetDepartments(departmentsData || []);
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
        setSelectedPaths([]);
        setSelectedDetail(null);
        setSelectedPermissions([]);
      });
    } catch (error) {
      showToast("error", errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  async function selectItem(item: SelectableItem) {
    if (item.type === "dir") {
      setSelectedPaths([item.path]);
      setSelectedDetail(null);
      setSelectedPermissions([]);
      return;
    }

    setSelectedPaths([item.path]);
    setLoading(true);
    try {
      const [detailData, permissionData] = await Promise.all([
        api.fetchFileDetail(item.file_id),
        api.fetchPermissions(item.file_id),
      ]);
      setSelectedDetail(detailData);
      setSelectedPermissions(permissionData.permissions || []);
    } catch (error) {
      showToast("error", errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  async function activateItem(item: SelectableItem) {
    if (item.type === "dir") {
      await openDirectory(item.path);
      return;
    }
    window.open(`/api/files/items/${item.file_id}/content`, "_blank");
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

  function showToast(tone: Toast["tone"], message: string) {
    setToast({ tone, message });
  }

  return {
    state: {
      tree,
      currentPath,
      selectedPaths,
      selectedItem,
      selectedDetail,
      selectedPermissions,
      trash,
      viewMode,
      page,
      query,
      loading,
      trashOpen,
      toast,
      permissionTargetUsers,
      permissionTargetDepartments,
      directoryPermissionDialog,
      pagedItems,
      visibleItemCount: visibleItems.length,
      fileInputRef,
      folderInputRef,
    },
    actions: {
      setTrashOpen,
      setQuery,
      setViewMode,
      setPage,
      showToast,
      setDirectoryPermissionDialog,
      openDirectory: (path: string) => void openDirectory(path),
      refreshCurrent: () => void refreshCurrent(),
      onUploadFiles: (files: FileList | null, asFolder: boolean) =>
        void runAction(async () => {
          if (!files || !files.length) return;
          const formData = new FormData();
          formData.append("folder_location", currentPath);
          Array.from(files).forEach((file) => {
            formData.append("files", file);
            formData.append("relative_paths[]", asFolder ? file.webkitRelativePath || file.name : file.name);
          });
          await api.uploadEntries(formData);
          showToast("success", "上传完成");
          await refreshCurrent();
        }),
      onCreateFolder: () =>
        void (async () => {
          const name = await showPromptDialog({
            title: "新建文件夹",
            message: "新文件夹名称",
            placeholder: "文件夹名称",
          });
          if (!name) return;
          await runAction(async () => {
            await api.createDirectory(joinPath(currentPath, name));
            showToast("success", "文件夹已创建");
            await refreshCurrent();
          });
        })(),
      onRename: () =>
        void (async () => {
          if (!selectedItem) return;
          const newName = await showPromptDialog({
            title: "重命名",
            message: "新的名称",
            initialValue: selectedItem.name,
            placeholder: "名称",
          });
          if (!newName || newName === selectedItem.name) return;
          await runAction(async () => {
            if (selectedItem.type === "dir") {
              await api.renameDirectory(selectedItem.path, newName);
            } else {
              await api.renameFile(selectedItem.file_id, newName);
            }
            showToast("success", "名称已更新");
            await refreshCurrent();
          });
        })(),
      onMove: () =>
        void (async () => {
          const selectedFile = selectedItem && selectedItem.type === "file" ? selectedItem : null;
          if (!selectedFile) return;
          const dirPath = await showPromptDialog({
            title: "移动文件",
            message: "移动到目录路径",
            initialValue: currentPath,
            placeholder: "/path/to/directory",
          });
          if (!dirPath) return;
          await runAction(async () => {
            await api.moveFile(selectedFile.path, dirPath);
            showToast("success", "文件已移动");
            await refreshCurrent();
          });
        })(),
      onDelete: () =>
        void (async () => {
          if (!selectedPaths.length || !(await showConfirmDialog({ message: "确认移动到回收站？", tone: "danger" }))) return;
          const selectedFiles = (directory?.files || []).filter((item) => selectedPaths.includes(item.path));
          const selectedDirs = (directory?.directories || []).filter((item) => selectedPaths.includes(item.path));
          await runAction(async () => {
            for (const dir of selectedDirs) await api.deleteDirectory(dir.path);
            if (selectedFiles.length) await api.deleteFiles(selectedFiles.map((item) => item.file_id));
            showToast("success", "已移动到回收站");
            await refreshCurrent();
            await loadTrash();
          });
        })(),
      onDownloadArchive: () =>
        void runAction(async () => {
          const ids = (directory?.files || [])
            .filter((item) => selectedPaths.includes(item.path))
            .map((item) => item.file_id);
          if (!ids.length) return;
          const blob = await api.downloadArchive(ids);
          triggerDownload(blob, "files.zip");
        }),
      onShare: () =>
        void (async () => {
          const selectedFile = selectedItem && selectedItem.type === "file" ? selectedItem : null;
          if (!selectedFile) return;
          const minutesInput = await showPromptDialog({
            title: "分享设置",
            message: "有效分钟数",
            initialValue: "30",
            placeholder: "30",
          });
          if (minutesInput === null) return;
          const creditInput = await showPromptDialog({
            title: "分享设置",
            message: "可下载次数",
            initialValue: "1",
            placeholder: "1",
          });
          if (creditInput === null) return;
          const minutes = Number(minutesInput || 30);
          const credit = Number(creditInput || 1);
          await runAction(async () => {
            const data = await api.createShare(selectedFile.file_id, minutes, credit);
            const shareUrl = `${window.location.origin}${data.share_url}`;
            await navigator.clipboard?.writeText(shareUrl).catch(() => undefined);
            showToast("success", `分享链接已生成${navigator.clipboard ? "并复制" : ""}`);
            await showPromptDialog({
              title: "分享链接",
              message: "请复制下面的链接",
              initialValue: shareUrl,
              readOnly: true,
              confirmText: "关闭",
            });
          });
        })(),
      onRestoreTrash: (trashId: number) =>
        void runAction(async () => {
          await api.restoreTrash(trashId);
          showToast("success", "文件已恢复");
          await Promise.all([loadTrash(), loadTree(), openDirectory(currentPath)]);
        }),
      onRemovePermission: (permissionId: number) =>
        void runAction(async () => {
          await api.removePermission(permissionId);
          showToast("success", "权限已删除");
          if (selectedItem && selectedItem.type === "file") await selectItem(selectedItem);
        }),
      onSetDirectoryPermission: () =>
        void (() => {
          if (!selectedItem || selectedItem.type !== "dir") return;
          setDirectoryPermissionDialog({
            open: true,
            dirPath: selectedItem.path,
            dirName: selectedItem.name,
            targetType: "user",
            targetId: "",
            permission: "read",
          });
        })(),
      onSubmitDirectoryPermission: () =>
        void runAction(async () => {
          const targetId = Number(directoryPermissionDialog.targetId);
          if (!directoryPermissionDialog.dirPath || !targetId) {
            throw new Error("请选择目录并填写有效的目标 ID");
          }
          await api.setDirectoryPermission(
            directoryPermissionDialog.dirPath,
            directoryPermissionDialog.targetType,
            targetId,
            directoryPermissionDialog.permission,
          );
          setDirectoryPermissionDialog((prev) => ({ ...prev, open: false }));
          showToast("success", "目录权限已更新");
        }),
      onSelect: (item: SelectableItem, additive: boolean) => {
        if (additive) {
          setSelectedPaths((prev) =>
            prev.includes(item.path) ? prev.filter((path) => path !== item.path) : [...prev, item.path],
          );
        } else {
          setSelectedPaths([item.path]);
        }
        void selectItem(item);
      },
      onActivate: (item: SelectableItem) => void activateItem(item),
      onDropOnDirectory: (dirPath: string, movedPath: string) =>
        void runAction(async () => {
          if (!movedPath || movedPath === dirPath) return;
          await api.moveFile(movedPath, dirPath);
          showToast("success", "文件已移动");
          await refreshCurrent();
        }),
    },
  };
}
