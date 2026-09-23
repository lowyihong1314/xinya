import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Trash2, Users } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/shared/api/errors";
import { useApiQuery } from "@/shared/api/useApiQuery";
import { useAuth } from "@/shared/auth/AuthProvider";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useConfirm,
  useToast,
} from "@/shared/ui";
import { createForm, deleteForm, fetchForms, formKeys } from "../api";
import type { FormInput } from "../api";
import { FormSettingsDialog } from "../components/FormSettingsDialog";
import { OPEN_STATE_BADGE, formOpenState } from "../components/memberFields";
import type { RegisFormSummary } from "../types";

export function FormsPage() {
  const { has } = useAuth();
  const canEdit = has("form_edit");
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const search = useDeferredValue(keyword);
  const [creating, setCreating] = useState(false);

  // 后端 /form/get_all_form 一次全给（不分页），所以筛选在前端做。
  const list = useApiQuery(formKeys.list(), fetchForms);

  const forms = useMemo(() => {
    const all = list.data?.forms ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((form) => form.title.toLowerCase().includes(q));
  }, [list.data, search]);

  const create = useMutation({
    mutationFn: (input: FormInput) => createForm(input),
    onSuccess: () => {
      toast.success("表单已创建");
      setCreating(false);
      void qc.invalidateQueries({ queryKey: formKeys.list() });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "创建失败"),
  });

  const remove = useMutation({
    mutationFn: (formId: number) => deleteForm(formId),
    onSuccess: () => {
      toast.success("表单已删除");
      void qc.invalidateQueries({ queryKey: formKeys.list() });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "删除失败"),
  });

  async function askRemove(form: RegisFormSummary) {
    const ok = await confirm({
      title: `删除「${form.title}」？`,
      description: `这张表下的 ${form.member_count} 条报名记录、收费项和分组会一起删掉，无法撤销。`,
      tone: "danger",
      confirmText: "删除",
    });
    if (ok) remove.mutate(form.id);
  }

  return (
    <div>
      <PageHeader
        title="表单报名"
        description={list.data ? `共 ${list.data.forms.length} 张表` : undefined}
        actions={
          canEdit ? (
            <Button onClick={() => setCreating(true)}>
              <Plus />
              新建表单
            </Button>
          ) : null
        }
      />

      <div className="relative mb-4">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索表单名称"
          className="pl-9"
          aria-label="搜索表单名称"
        />
      </div>

      {list.isPending ? (
        <div className="space-y-1.5">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : forms.length === 0 ? (
        <EmptyState
          title={keyword ? "没有匹配的表单" : "还没有报名表"}
          description={keyword ? undefined : canEdit ? "点右上角新建一张。" : undefined}
        />
      ) : (
        <Card>
          <CardContent className="p-0 pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>表单</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">报名</TableHead>
                  <TableHead>截止</TableHead>
                  {canEdit ? <TableHead /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {forms.map((form) => {
                  const state = OPEN_STATE_BADGE[formOpenState(form)];
                  return (
                    <TableRow key={form.id}>
                      <TableCell className="max-w-[24rem]">
                        <Link
                          to={`/registrations/${form.id}`}
                          className="block truncate font-medium hover:text-primary"
                        >
                          {form.title}
                        </Link>
                        {form.events.length > 0 ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {form.events.map((ev) => ev.event_name || `活动 #${ev.id}`).join("、")}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant={state.variant}>{state.label}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono">
                        {form.member_count}
                        {/* 上限为 null 就是不限人数，显示 "/∞" 比留白更清楚 */}
                        <span className="text-muted-foreground">
                          /{form.max_members ?? "∞"}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {form.expired?.slice(0, 10) ?? "—"}
                      </TableCell>
                      {canEdit ? (
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`删除 ${form.title}`}
                            onClick={() => void askRemove(form)}
                          >
                            <Trash2 className="text-destructive" />
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* 没有报名记录查看权的人看到的是一张空名单，先把话说在前面 */}
      {!has("member_detail") && !canEdit && forms.length > 0 ? (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="size-3.5 shrink-0" aria-hidden />
          你只能看到表单本身；报名成员名单需要 member_detail 或 form_edit 权限。
        </p>
      ) : null}

      {creating ? (
        <FormSettingsDialog
          form={null}
          submitting={create.isPending}
          onClose={() => setCreating(false)}
          onSubmit={(input) => create.mutate(input)}
        />
      ) : null}
    </div>
  );
}
