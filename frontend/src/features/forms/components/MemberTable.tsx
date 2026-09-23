import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Trash2 } from "lucide-react";
import { Fragment, useDeferredValue, useMemo, useState } from "react";

import { ApiError } from "@/shared/api/errors";
import { useAuth } from "@/shared/auth/AuthProvider";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useConfirm,
  useToast,
} from "@/shared/ui";
import { formKeys, removeMember } from "../api";
import type { FormMember, RegisFormDetail } from "../types";
import { MemberDetailPanel } from "./MemberDetailPanel";
import {
  PAYMENT_STATUS,
  formatDateTime,
  latestPayment,
  memberDisplayName,
} from "./memberFields";

/** 一张表的报名记录：表格 + 展开明细。字段是动态的，见 memberFields.ts。 */
export function MemberTable({ form }: { form: RegisFormDetail }) {
  const { has } = useAuth();
  const canEdit = has("form_edit");
  // 后端 include_members 的判据就是这两个权限之一（router.py get_form_detail）。
  // 没有的话 members 会是**空数组**而不是 403，所以要自己区分「没人报名」和「看不到」。
  const canSeeMembers = has("member_detail") || canEdit;

  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const search = useDeferredValue(keyword);
  const [expanded, setExpanded] = useState<number | null>(null);

  const members = useMemo(() => {
    const all = form.members ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((m) =>
      [memberDisplayName(m), m.name, m.nric, m.phone]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [form.members, search]);

  const remove = useMutation({
    mutationFn: (memberId: number) => removeMember(form.id, memberId),
    onSuccess: () => {
      toast.success("已从本表移除");
      setExpanded(null);
      void qc.invalidateQueries({ queryKey: formKeys.detail(form.id) });
      // 列表页那一行的报名人数也要跟着变
      void qc.invalidateQueries({ queryKey: formKeys.list() });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "移除失败"),
  });

  if (!canSeeMembers) {
    return (
      <EmptyState
        title="看不到报名成员"
        description="报名记录含身份证、家长与医疗等敏感资料，需要 member_detail 或 form_edit 权限。"
      />
    );
  }

  if ((form.members ?? []).length === 0) {
    return <EmptyState title="还没有人报名" />;
  }

  async function askRemove(member: FormMember) {
    const ok = await confirm({
      title: `把「${memberDisplayName(member)}」移出这张表？`,
      // 有付款记录时后端会直接拒（400 + 中文说明），这里先提醒一句，省一次往返
      description: "成员本身和他在别的表里的报名都还在。有处理中/已确认付款的成员无法移除。",
      tone: "danger",
      confirmText: "移除",
    });
    if (ok) remove.mutate(member.id);
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索姓名 / NRIC / 电话"
          className="pl-9"
          aria-label="搜索报名成员"
        />
      </div>

      {members.length === 0 ? (
        <EmptyState title="没有匹配的报名记录" />
      ) : (
        <Card>
          <CardContent className="p-0 pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>姓名</TableHead>
                  <TableHead>NRIC</TableHead>
                  <TableHead>电话</TableHead>
                  <TableHead>缴费</TableHead>
                  <TableHead>报名时间</TableHead>
                  {canEdit ? <TableHead /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => {
                  const payment = latestPayment(member);
                  const open = expanded === member.id;
                  return (
                    // Fragment 要带 key：一行数据渲染成「主行 + 展开行」两个 <tr>，
                    // 简写的 <> 接不了 key，React 会报 list key 警告。
                    <Fragment key={member.id}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() => setExpanded((v) => (v === member.id ? null : member.id))}
                      >
                        <TableCell className="max-w-[14rem] truncate font-medium">
                          {memberDisplayName(member)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-sm">
                          {member.nric || "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{member.phone || "—"}</TableCell>
                        <TableCell>
                          {payment ? (
                            <Badge variant={PAYMENT_STATUS[payment.status].variant}>
                              {PAYMENT_STATUS[payment.status].label}
                            </Badge>
                          ) : (
                            <span className="text-sm text-muted-foreground">未缴</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDateTime(member.registered_at)}
                        </TableCell>
                        {canEdit ? (
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`移除 ${memberDisplayName(member)}`}
                              onClick={() => void askRemove(member)}
                            >
                              <Trash2 className="text-destructive" />
                            </Button>
                          </TableCell>
                        ) : null}
                      </TableRow>

                      {open ? (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={canEdit ? 6 : 5} className="bg-muted/40">
                            <MemberDetailPanel form={form} member={member} canEdit={canEdit} />
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
