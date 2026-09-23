import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useState } from "react";

import { ApiError } from "@/shared/api/errors";
import { useApiQuery } from "@/shared/api/useApiQuery";
import { useAuth } from "@/shared/auth/AuthProvider";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  useConfirm,
  useToast,
} from "@/shared/ui";
import {
  addPermission,
  fetchDepartments,
  fetchPermissionCatalog,
  fetchUsers,
  removePermission,
  userKeys,
} from "../api";
import type { Department } from "../types";

export function UsersPage() {
  const { has } = useAuth();
  const canEditPermissions = has("permission_edit");

  const departments = useApiQuery(userKeys.departments(), fetchDepartments);
  const users = useApiQuery(userKeys.list(), fetchUsers);
  // 权限清单要 permission 权限才能读；没权限就不发这个请求，
  // 否则控制台会多一条 401，而界面本来就不该显示编辑入口。
  const catalog = useApiQuery(userKeys.catalog(), fetchPermissionCatalog, {
    enabled: has("permission") || canEditPermissions,
  });

  const [selected, setSelected] = useState<number | null>(null);
  const current = departments.data?.find((d) => d.id === selected) ?? null;

  return (
    <div>
      <PageHeader
        title="用户与权限"
        description={
          users.data ? `${users.data.data.length} 位成员 · ${departments.data?.length ?? 0} 个部门` : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle>部门</CardTitle>
          </CardHeader>
          <CardContent className="p-2 pt-0">
            {departments.isPending ? (
              <div className="space-y-1 p-2">
                {Array.from({ length: 5 }, (_, i) => (
                  <Skeleton key={i} className="h-9" />
                ))}
              </div>
            ) : departments.isError ? (
              <ErrorState error={departments.error} onRetry={() => void departments.refetch()} />
            ) : departments.data?.length ? (
              <ul className="space-y-0.5">
                {departments.data.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(d.id)}
                      className={
                        "flex w-full items-center justify-between rounded-[var(--radius-sm)] px-3 py-2 text-left text-sm transition-colors " +
                        (selected === d.id
                          ? "bg-primary-soft font-medium text-primary-strong"
                          : "hover:bg-accent hover:text-accent-foreground")
                      }
                    >
                      <span className="min-w-0 truncate">{d.name}</span>
                      {/* 没有读权限时后端只给 {id,name}，permissions 是 undefined —— 这时不显示计数 */}
                      {d.permissions ? (
                        <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                          {d.permissions.length}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="还没有部门" className="min-h-24" />
            )}
          </CardContent>
        </Card>

        {current ? (
          <DepartmentPanel
            department={current}
            catalog={catalog.data?.permissions ?? []}
            canEdit={canEditPermissions}
          />
        ) : (
          <Card>
            <CardContent className="pt-5">
              <EmptyState title="选一个部门" description="左侧点击部门查看它的权限与成员" />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function DepartmentPanel({
  department,
  catalog,
  canEdit,
}: {
  department: Department;
  catalog: { name: string; description: string }[];
  canEdit: boolean;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const owned = new Set((department.permissions ?? []).map((p) => p.name));
  const invalidate = () => void qc.invalidateQueries({ queryKey: userKeys.departments() });

  const add = useMutation({
    mutationFn: (name: string) => addPermission(department.id, name),
    onSuccess: () => {
      toast.success("已添加权限");
      setAdding(false);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "添加失败"),
  });

  const remove = useMutation({
    mutationFn: (name: string) => removePermission(department.id, name),
    onSuccess: () => {
      toast.success("已移除权限");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "移除失败"),
  });

  if (!department.permissions) {
    return (
      <Card>
        <CardContent className="pt-5">
          <EmptyState
            title="没有查看权限"
            description="查看部门的权限与成员需要额外授权，请联系管理员。"
          />
        </CardContent>
      </Card>
    );
  }

  const available = catalog.filter((c) => !owned.has(c.name));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{department.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground">
              权限 · {department.permissions.length}
            </h3>
            {canEdit && available.length > 0 ? (
              <Button variant="outline" size="sm" onClick={() => setAdding((v) => !v)}>
                {adding ? <X /> : <Plus />}
                {adding ? "取消" : "添加"}
              </Button>
            ) : null}
          </div>

          {adding ? (
            <ul className="mb-3 grid gap-1.5 rounded-[var(--radius-sm)] border border-border p-2 sm:grid-cols-2">
              {available.map((c) => (
                <li key={c.name}>
                  <button
                    type="button"
                    disabled={add.isPending}
                    onClick={() => add.mutate(c.name)}
                    className="flex w-full items-start gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
                  >
                    <Plus className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    <span className="min-w-0">
                      <span className="block font-mono text-xs">{c.name}</span>
                      {c.description ? (
                        <span className="block text-xs text-muted-foreground">{c.description}</span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {department.permissions.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {department.permissions.map((p) => (
                <li key={p.name}>
                  <Badge variant="primary" className="gap-1.5 py-1">
                    <span className="font-mono">{p.name}</span>
                    {canEdit ? (
                      <button
                        type="button"
                        aria-label={`移除 ${p.name}`}
                        disabled={remove.isPending}
                        onClick={async () => {
                          if (
                            await confirm({
                              title: `移除权限 ${p.name}？`,
                              description: `「${department.name}」的所有成员会立刻失去这项权限。`,
                              tone: "danger",
                              confirmText: "移除",
                            })
                          ) {
                            remove.mutate(p.name);
                          }
                        }}
                        className="opacity-60 transition-opacity hover:opacity-100"
                      >
                        <X className="size-3" />
                      </button>
                    ) : null}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">这个部门还没有分配权限</p>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-sm font-medium text-muted-foreground">
            成员 · {department.users?.length ?? 0}
          </h3>
          {department.users?.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {department.users.map((u) => (
                <li key={u.id}>
                  <Badge>{u.display_name || u.username}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">还没有成员</p>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
