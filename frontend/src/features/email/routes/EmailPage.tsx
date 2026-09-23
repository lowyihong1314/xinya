import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Mail, Send } from "lucide-react";
import { useState, type FormEvent } from "react";

import { useApiQuery } from "@/shared/api/useApiQuery";
import { ApiError } from "@/shared/api/errors";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Input,
  Label,
  LoadingState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  useToast,
} from "@/shared/ui";
import { emailKeys, fetchEmails, sendEmail, type SendEmailInput } from "../api";
import type { EmailLog } from "../types";

const STATUS_LABEL: Record<EmailLog["status"], { text: string; variant: "success" | "danger" | "warning" }> = {
  success: { text: "已发送", variant: "success" },
  failed: { text: "失败", variant: "danger" },
  pending: { text: "发送中", variant: "warning" },
};

export function EmailPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [composing, setComposing] = useState(false);

  const list = useApiQuery(emailKeys.list(), fetchEmails);

  const send = useMutation({
    mutationFn: sendEmail,
    onSuccess: () => {
      toast.success("邮件已发送");
      setComposing(false);
      // 失效而不是手工往列表里塞一条：后端会补上 message_id、status 等字段，
      // 本地拼出来的那条迟早和真实数据对不上。
      void qc.invalidateQueries({ queryKey: emailKeys.list() });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "发送失败"),
  });

  return (
    <div>
      <PageHeader
        title="公司邮箱"
        description={list.data?.from_email ? `发件人 ${list.data.from_email}` : undefined}
        actions={
          <Button onClick={() => setComposing(true)}>
            <Send />
            写邮件
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0 pt-0">
          {list.isPending ? (
            <LoadingState />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : list.data?.data.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>收件人</TableHead>
                  <TableHead>主题</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.data.map((log) => {
                  const s = STATUS_LABEL[log.status];
                  return (
                    <TableRow key={log.id}>
                      <TableCell className="max-w-[14rem] truncate">{log.to_email}</TableCell>
                      <TableCell className="max-w-[18rem] truncate">{log.subject}</TableCell>
                      <TableCell>
                        <Badge variant={s.variant}>{s.text}</Badge>
                        {/* 失败原因要能看到，否则用户只知道"失败"却不知道为什么 */}
                        {log.status === "failed" && log.error_message ? (
                          <p className="mt-1 max-w-[18rem] truncate text-xs text-muted-foreground">
                            {log.error_message}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {log.created_at}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              title="还没有发过邮件"
              description="点右上角「写邮件」开始"
              className="py-12"
            />
          )}
        </CardContent>
      </Card>

      <ComposeDialog
        open={composing}
        onOpenChange={setComposing}
        onSubmit={(input) => send.mutate(input)}
        submitting={send.isPending}
      />
    </div>
  );
}

function ComposeDialog({
  open,
  onOpenChange,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: SendEmailInput) => void;
  submitting: boolean;
}) {
  const [form, setForm] = useState<SendEmailInput>({ to_email: "", subject: "", body: "" });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit(form);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="size-4" />
            写邮件
          </DialogTitle>
        </DialogHeader>
        {/* 校验交给后端：它的中文文案（「请输入有效的收件人邮箱」等）是唯一来源，
            前端再写一套迟早和后端漂移，用户会看到两种说法。
            这里只用 type=email/required 拦最明显的笔误。 */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="to">收件人</Label>
            <Input
              id="to"
              type="email"
              required
              value={form.to_email}
              onChange={(e) => setForm({ ...form, to_email: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="subject">主题</Label>
            <Input
              id="subject"
              required
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="body">内容</Label>
            <Textarea
              id="body"
              required
              className="min-h-40"
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" loading={submitting}>
              发送
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
