import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, Settings, Users } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

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
  LoadingState,
  PageHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from "@/shared/ui";
import { fetchForm, formKeys, updateForm } from "../api";
import type { FormInput } from "../api";
import { FeesPanel } from "../components/FeesPanel";
import { FormSettingsDialog } from "../components/FormSettingsDialog";
import { MemberTable } from "../components/MemberTable";
import { OPEN_STATE_BADGE, formOpenState } from "../components/memberFields";

export function FormDetailPage() {
  const { formId } = useParams();
  const id = Number(formId);
  const { has } = useAuth();
  const canEdit = has("form_edit");
  const toast = useToast();
  const qc = useQueryClient();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const form = useApiQuery(formKeys.detail(id), () => fetchForm(id), {
    enabled: Number.isFinite(id),
  });

  const save = useMutation({
    mutationFn: (input: FormInput) => updateForm(id, input),
    onSuccess: () => {
      toast.success("表单已保存");
      setSettingsOpen(false);
      void qc.invalidateQueries({ queryKey: formKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: formKeys.list() });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "保存失败"),
  });

  if (form.isPending) return <LoadingState />;
  if (form.isError) return <ErrorState error={form.error} onRetry={() => void form.refetch()} />;
  // formId 不是数字时查询被禁用（enabled:false），会走到这里 —— 渲染 404 而不是永久转圈
  if (!form.data) return <EmptyState title="找不到这张表单" description="链接可能已经失效。" />;

  const data = form.data;
  const state = OPEN_STATE_BADGE[formOpenState(data)];

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        <Link to="/registrations">
          <ArrowLeft />
          表单报名
        </Link>
      </Button>

      <PageHeader
        title={data.title}
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Badge variant={state.variant}>{state.label}</Badge>
            <span className="flex items-center gap-1.5">
              <Users className="size-3.5" aria-hidden />
              {data.member_count} / {data.max_members ?? "∞"} 人
            </span>
            <span className="flex items-center gap-1.5">
              <CalendarDays className="size-3.5" aria-hidden />
              截止 {data.expired?.slice(0, 10) ?? "—"}
            </span>
            {data.events.map((ev) => (
              <span key={ev.id} className="text-muted-foreground">
                {ev.event_name || `活动 #${ev.id}`}
              </span>
            ))}
          </span>
        }
        actions={
          canEdit ? (
            <Button variant="outline" onClick={() => setSettingsOpen(true)}>
              <Settings />
              表单设置
            </Button>
          ) : null
        }
      />

      {data.detail ? (
        <Card className="mb-6">
          <CardContent className="whitespace-pre-wrap pt-5 leading-7">{data.detail}</CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">报名记录</TabsTrigger>
          <TabsTrigger value="fees">费用与缴费</TabsTrigger>
        </TabsList>

        <TabsContent value="members">
          <MemberTable form={data} />
        </TabsContent>

        <TabsContent value="fees">
          <FeesPanel form={data} />
        </TabsContent>
      </Tabs>

      {settingsOpen ? (
        <FormSettingsDialog
          form={data}
          submitting={save.isPending}
          onClose={() => setSettingsOpen(false)}
          onSubmit={(input) => save.mutate(input)}
        />
      ) : null}
    </div>
  );
}
