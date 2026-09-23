import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { ApiError } from "@/shared/api/errors";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  useConfirm,
  useToast,
} from "@/shared/ui";

import { assetKeys, createPartner, deletePartner, updatePartner, type PartnerInput } from "../api";
import { PARTNER_TYPE_LABELS, PARTNER_TYPE_OPTIONS, isActive } from "../format";
import type { AssetPartner, PartnerType } from "../types";

/**
 * 往来单位（供应商 / 客户）。单据上的「往来对象」就是从这张表里选。
 *
 * ★ 和仓库、物品不一样：**编号是必填的**，后端不会自动生成（而且会转成大写）。
 */
export function PartnersPanel({ partners, canEdit }: { partners: AssetPartner[]; canEdit: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<AssetPartner | null | undefined>(undefined);

  const invalidate = () => void qc.invalidateQueries({ queryKey: assetKeys.all });

  const save = useMutation({
    mutationFn: (input: PartnerInput) =>
      dialog ? updatePartner(dialog.id, input) : createPartner(input),
    onSuccess: () => {
      toast.success(dialog ? "往来对象已更新" : "往来对象已创建");
      setDialog(undefined);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "保存失败"),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deletePartner(id),
    onSuccess: () => {
      toast.success("往来对象已删除");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "删除失败"),
  });

  return (
    <div className="space-y-3">
      {canEdit ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setDialog(null)}>
            <Plus />
            新建往来单位
          </Button>
        </div>
      ) : null}

      {partners.length === 0 ? (
        <EmptyState title="还没有往来单位" description="采购和销售单据上的「往来对象」从这里选。" />
      ) : (
        <Card>
          <CardContent className="p-0 pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>编号</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>联系人</TableHead>
                  <TableHead>电话</TableHead>
                  <TableHead>状态</TableHead>
                  {canEdit ? <TableHead /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {partners.map((partner) => (
                  <TableRow key={partner.id}>
                    <TableCell className="font-medium">{partner.name}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-muted-foreground">
                      {partner.code}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {PARTNER_TYPE_LABELS[partner.partner_type] ?? partner.partner_type}
                    </TableCell>
                    <TableCell>{partner.contact_person || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{partner.phone || "—"}</TableCell>
                    <TableCell>
                      {isActive(partner.status) ? (
                        <Badge variant="success">启用</Badge>
                      ) : (
                        <Badge variant="neutral">停用</Badge>
                      )}
                    </TableCell>
                    {canEdit ? (
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`修改 ${partner.name}`}
                            onClick={() => setDialog(partner)}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`删除 ${partner.name}`}
                            onClick={async () => {
                              const ok = await confirm({
                                title: `删除往来单位「${partner.name}」？`,
                                description: "这一步不可撤销。已经被单据引用的往来单位后端会拒绝删除。",
                                tone: "danger",
                                confirmText: "删除",
                              });
                              if (ok) remove.mutate(partner.id);
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {dialog !== undefined ? (
        <PartnerFormDialog
          partner={dialog}
          submitting={save.isPending}
          onClose={() => setDialog(undefined)}
          onSubmit={(input) => save.mutate(input)}
        />
      ) : null}
    </div>
  );
}

function PartnerFormDialog({
  partner,
  onSubmit,
  onClose,
  submitting,
}: {
  partner: AssetPartner | null;
  onSubmit: (input: PartnerInput) => void;
  onClose: () => void;
  submitting: boolean;
}) {
  const [name, setName] = useState(partner?.name ?? "");
  const [code, setCode] = useState(partner?.code ?? "");
  const [partnerType, setPartnerType] = useState<PartnerType>(partner?.partner_type ?? "supplier");
  const [contactPerson, setContactPerson] = useState(partner?.contact_person ?? "");
  const [phone, setPhone] = useState(partner?.phone ?? "");
  const [address, setAddress] = useState(partner?.address ?? "");
  const [status, setStatus] = useState(partner?.status ?? "active");
  const [remark, setRemark] = useState(partner?.remark ?? "");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      name,
      code,
      partner_type: partnerType,
      contact_person: contactPerson || null,
      phone: phone || null,
      address: address || null,
      status,
      remark: remark || null,
    });
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{partner ? `修改 ${partner.name}` : "新建往来单位"}</DialogTitle>
          <DialogDescription>编号必填且全站唯一，保存时会自动转成大写。</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="partner-name">名称</Label>
              <Input id="partner-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="partner-code">编号</Label>
              <Input
                id="partner-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="SUP-001"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="partner-type">类型</Label>
              <Select
                id="partner-type"
                value={partnerType}
                onChange={(e) => setPartnerType(e.target.value as PartnerType)}
              >
                {PARTNER_TYPE_OPTIONS.map((type) => (
                  <option key={type} value={type}>
                    {PARTNER_TYPE_LABELS[type]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="partner-status">状态</Label>
              {/* 后端不校验这个字段，只是在留空时补 "active"。停用的往来单位仍然选得到，
                  停用只是给人看的标记 —— 不要在前端自己加一层「停用就不让选」的规则。 */}
              <Select id="partner-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="active">启用</option>
                <option value="inactive">停用</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="partner-contact">联系人</Label>
              <Input
                id="partner-contact"
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="partner-phone">电话</Label>
              <Input
                id="partner-phone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="partner-address">地址</Label>
              <Input id="partner-address" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="partner-remark">备注</Label>
              <Textarea
                id="partner-remark"
                rows={2}
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" loading={submitting}>
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
