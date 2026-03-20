import type {
  DirectoryResult,
  FileDetail,
  PermissionRow,
  TrashRow,
  TreeResponse,
} from "./types";

async function parseJson(response: Response) {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || data.message || "Request failed");
  }
  return data;
}

export async function fetchHistoryViews() {
  const response = await fetch("/api/files/history/views");
  return parseJson(response);
}

export async function fetchTree(): Promise<TreeResponse> {
  const response = await fetch("/api/files/tree");
  return parseJson(response);
}

export async function fetchDirectory(path: string): Promise<DirectoryResult> {
  const response = await fetch("/api/files/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  return parseJson(response);
}

export async function fetchFileDetail(fileId: number): Promise<FileDetail> {
  const response = await fetch(`/api/files/items/${fileId}`);
  return parseJson(response);
}

export async function fetchPermissions(fileId: number): Promise<{ permissions: PermissionRow[] }> {
  const response = await fetch(`/api/files/items/${fileId}/permissions`);
  return parseJson(response);
}

export async function fetchTrash(): Promise<{ items: TrashRow[] }> {
  const response = await fetch("/api/files/trash");
  return parseJson(response);
}

export async function createDirectory(path: string) {
  const response = await fetch("/api/files/directories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  return parseJson(response);
}

export async function renameDirectory(oldPath: string, newName: string) {
  const response = await fetch("/api/files/directories/rename", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ old_path: oldPath, new_name: newName }),
  });
  return parseJson(response);
}

export async function renameFile(fileId: number, newName: string) {
  const response = await fetch(`/api/files/items/${fileId}/rename`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ new_name: newName }),
  });
  return parseJson(response);
}

export async function moveFile(filePath: string, dirPath: string) {
  const response = await fetch("/api/files/items/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_path: filePath, dir_path: dirPath }),
  });
  return parseJson(response);
}

export async function deleteDirectory(path: string) {
  const response = await fetch("/api/files/directories", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  return parseJson(response);
}

export async function deleteFiles(ids: number[]) {
  const response = await fetch("/api/files/items", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  return parseJson(response);
}

export async function createShare(fileId: number, minutes: number, credit: number) {
  const response = await fetch("/api/files/shares", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: fileId, minutes, credit }),
  });
  return parseJson(response);
}

export async function restoreTrash(trashId: number) {
  const response = await fetch(`/api/files/trash/${trashId}/restore`, { method: "POST" });
  return parseJson(response);
}

export async function removePermission(permissionId: number) {
  const response = await fetch(`/api/files/permissions/${permissionId}`, { method: "DELETE" });
  return parseJson(response);
}

export async function setDirectoryPermission(
  dirPath: string,
  type: string,
  id: number,
  permission: string,
) {
  const response = await fetch("/api/files/directories/permissions", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dir_path: dirPath, type, id, permission }),
  });
  return parseJson(response);
}

export async function uploadEntries(formData: FormData) {
  const response = await fetch("/api/files/uploads", {
    method: "POST",
    body: formData,
  });
  return parseJson(response);
}

export async function downloadArchive(ids: number[]) {
  const response = await fetch("/api/files/items/archive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "下载失败");
  }
  return response.blob();
}
