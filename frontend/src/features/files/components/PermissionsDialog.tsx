import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/shared/api/errors";
import { useApiQuery } from "@/shared/api/useApiQuery";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Label,
  LoadingState,
  Select,
  useConfirm,
  useToast,
} from "@/shared/ui";
// 跨模块取用户/部门清单：这两条接口的路径归 users 模块的 api.ts 管，
// 在这里再写一遍 "/user_control/…" 就成了第二个知道它们的地方。
// 复用它的 queryKey 还能和「用户与权限」页共享同一份缓存。
import { fetchDepartments, fetchUsers, userKeys } from "@/features/users/api";

import { fetchItemPermissions, fileKeys, removePermission, setPathPermission } from "../api";
import { permissionLabel, PERMISSION_LABELS } from "../format";
import type { FilePermissionValue, FileTarget } from "../types";

const PERMISSION_OPTIONS: FilePermissionValue[] = ["read", "read_write", "read_public"];

/**
 * 谁能看、谁能改。
 *
 * 两件必须先讲清楚的后端事实，否则这个对话框会显得很奇怪：
 *
 * ① **「设权限」只有一条接口**：PUT /files/directories/permissions，作用范围是
 *    「这条路径**及其整棵子树**」。给单个文件设权限时就把 dir_path 传成文件自己的
 *    路径 —— 后端的 subtree_filter 是 `path == x OR path LIKE x/%`，正好只命中它自己。
 *
 * ② **目录没有 file_id**（列表行里就没有这个键），而「列出已有权限」只有
 *    GET /files/items/{id}/permissions 这一条。所以目录这边**列不出**现有权限，
 *    只能设。这不是这里偷懒，是后端没有按路径查权限的接口。
 *
 * ③ 后端对没有写权限的条目是**静默跳过**并照样回 200「目录权限批量设置成功」——
 *    「设置成功」不等于真的写进去了。所以文件这一支设完会重新拉一次列表，以列表为准；
 *    目录那一支没法验证，界面上如实说明。
 */
export function PermissionsDialog({ target, onClose }: { target: FileTarget; onClose: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const fileId = target.type === "file" ? target.file_id : null;
  const [targetType, setTargetType] = useState<"user" | "department">("user");
  const [targetId, setTargetId] = useState("");
  const [permission, setPermission] = useState<FilePermissionValue>("read");

  const permissions = useApiQuery(
    fileKeys.permissions(fileId ?? 0),
    () => fetchItemPermissions(fileId ?? 0),
    { enabled: fileId !== null },
  );
  const users = useApiQuery(userKeys.list(), fetchUsers);
  const departments = useApiQuery(userKeys.departments(), fetchDepartments);

  const userName = (id: number) => {
    const found = users.data?.data.find((user) => user.id === id);
    return found ? found.display_name || found.username : `用户 #${id}`;
  };
  const departmentName = (id: number) => {
    const found = departments.data?.find((dept) => dept.id === id);
    return found ? found.name : `部门 #${id}`;
  };

  const refresh = () => {
    if (fileId !== null) void qc.invalidateQueries({ queryKey: fileKeys.permissions(fileId) });
  };

  const grant = useMutation({
    mutationFn: () =>
      setPathPermission({
        dirPath: target.path,
        targetType,
        targetId: Number(targetId),
        permission,
      }),
    onSuccess: (res) => {
      // 后端这条回的是 {status,message}，message 就是给人看的那句话。
      toast.success(res.message || "已设置");
      refresh();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "设置失败"),
  });

  const revoke = useMutation({
    mutationFn: (permissionId: number) => removePermission(permissionId),
    onSuccess: () => {
      toast.success("已移除");
      refresh();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "移除失败"),
  });

  const rows = permissions.data?.permissions ?? [];

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>权限</DialogTitle>
          <DialogDescription>
            {target.type === "dir"
              ? `目录「${target.name}」—— 设置会套到它下面的每一项`
              : target.name}
          </DialogDescription>
        </DialogHeader>

        {target.type === "file" ? (
          <section className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">已有权限</h3>
            {permissions.isPending ? (
              <LoadingState className="min-h-20" />
            ) : permissions.isError ? (
              <ErrorState error={permissions.error} onRetry={() => void permissions.refetch()} />
            ) : rows.length === 0 ? (
              <EmptyState title="还没有分配给别人" className="min-h-20" />
            ) : (
              <ul className="space-y-1">
                {rows.map((row) => (
                  <li
                    key={row.id}
                    className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-muted/60 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {row.user_id !== null
                        ? userName(row.user_id)
                        : row.department_id !== null
                          ? `${departmentName(row.department_id)}（部门）`
                          : "—"}
                    </span>
                    <Badge variant={row.permission === "read_write" ? "primary" : "neutral"}>
                      {permissionLabel(row.permission)}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="移除这条权限"
                      disabled={revoke.isPending}
                      onClick={async () => {
                        const ok = await confirm({
                          title: "移除这条权限？",
                          description: "被移除的人立刻就看不到这个文件了。",
                          tone: "danger",
                          confirmText: "移除",
                        });
                        if (ok) revoke.mutate(row.id);
                      }}
                    >
                      <Trash2 className="text-destructive" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : (
          <p className="rounded-[var(--radius-sm)] bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            目录没有 id，后端也没有「按路径列权限」的接口，所以这里只能设、列不出来。
            设完之后可以点开目录里的任意一个文件核对。
          </p>
        )}

        <form
          className="mt-4 space-y-3 border-t border-border pt-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (targetId) grant.mutate();
          }}
        >
          <h3 className="text-xs font-medium text-muted-foreground">授予权限</h3>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="perm-type">授予对象</Label>
              <Select
                id="perm-type"
                value={targetType}
                onChange={(event) => {
                  setTargetType(event.target.value === "department" ? "department" : "user");
                  // 换了类型，原来选中的 id 属于另一张表，必须清掉
                  setTargetId("");
                }}
              >
                <option value="user">用户</option>
                <option value="department">部门</option>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="perm-target">{targetType === "user" ? "选择用户" : "选择部门"}</Label>
              <Select
                id="perm-target"
                value={targetId}
                onChange={(event) => setTargetId(event.target.value)}
              >
                <option value="">请选择</option>
                {targetType === "user"
                  ? (users.data?.data ?? []).map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.display_name || user.username}
                      </option>
                    ))
                  : (departments.data ?? []).map((dept) => (
                      <option key={dept.id} value={dept.id}>
                        {dept.name}
                      </option>
                    ))}
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="perm-value">权限</Label>
            <Select
              id="perm-value"
              value={permission}
              onChange={(event) => setPermission(event.target.value as FilePermissionValue)}
            >
              {PERMISSION_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {PERMISSION_LABELS[value]}
                </option>
              ))}
            </Select>
            {permission === "read_public" ? (
              // 这条不是吓唬人：check_permission 的最后一道是「文件上只要存在任意一条
              // read_public，所有人都能读」——挂在谁身上都一样。
              <p className="text-xs text-destructive">
                「公开可读」是挂在文件上的标记：只要有这么一条，所有登录用户都能读，
                不只上面选中的这一个。
              </p>
            ) : null}
          </div>

          <div className="flex justify-end">
            <Button type="submit" loading={grant.isPending} disabled={!targetId}>
              授予
            </Button>
          </div>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
