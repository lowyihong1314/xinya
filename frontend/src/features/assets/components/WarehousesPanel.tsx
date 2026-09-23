import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";

import { ApiError } from "@/shared/api/errors";
import {
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

import { assetKeys, createWarehouse, deleteWarehouse, updateWarehouse, type WarehouseInput } from "../api";
import type { AssetWarehouse } from "../types";
import { UserSelect } from "./UserSelect";

/**
 * 仓库。库存是「某个仓库里某个子物品的数量」，所以这张表是整个模块的地基 ——
 * 没有仓库就开不了任何单据。
 *
 * 编号留空时后端自动发 `WH-0001`，所以表单里它是选填的。
 */
export function WarehousesPanel({
  warehouses,
  canEdit,
}: {
  warehouses: AssetWarehouse[];
  canEdit: boolean;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  // undefined = 对话框关着；null = 新建；对象 = 改这一条。
  // 用「关着就不挂载」而不是 open 开关，保证每次打开都是干净的表单。
  const [dialog, setDialog] = useState<AssetWarehouse | null | undefined>(undefined);

  const invalidate = () => void qc.invalidateQueries({ queryKey: assetKeys.all });

  const save = useMutation({
    mutationFn: (input: WarehouseInput) =>
      dialog ? updateWarehouse(dialog.id, input) : createWarehouse(input),
    onSuccess: () => {
      toast.success(dialog ? "仓库已更新" : "仓库已创建");
      setDialog(undefined);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "保存失败"),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteWarehouse(id),
    onSuccess: () => {
      toast.success("仓库已删除");
      invalidate();
    },
    // 「仓库已有库存记录，不能删除」这类文案来自后端，原样给用户
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "删除失败"),
  });

  return (
    <div className="space-y-3">
      {canEdit ? (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setDialog(null)}>
            <Plus />
            新建仓库
          </Button>
        </div>
      ) : null}

      {warehouses.length === 0 ? (
        <EmptyState title="还没有仓库" description="先建一个仓库，才能开单据、记库存。" />
      ) : (
        <Card>
          <CardContent className="p-0 pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>编号</TableHead>
                  <TableHead>位置</TableHead>
                  <TableHead>负责人</TableHead>
                  <TableHead>备注</TableHead>
                  {canEdit ? <TableHead /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {warehouses.map((warehouse) => (
                  <TableRow key={warehouse.id}>
                    <TableCell className="font-medium">{warehouse.name}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-muted-foreground">
                      {warehouse.code}
                    </TableCell>
                    <TableCell>{warehouse.location || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{warehouse.manager_name || "—"}</TableCell>
                    <TableCell className="max-w-[16rem] truncate text-muted-foreground">
                      {warehouse.remark || "—"}
                    </TableCell>
                    {canEdit ? (
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`修改 ${warehouse.name}`}
                            onClick={() => setDialog(warehouse)}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`删除 ${warehouse.name}`}
                            onClick={async () => {
                              const ok = await confirm({
                                title: `删除仓库「${warehouse.name}」？`,
                                description: "这一步不可撤销。已经有库存、流水或单据的仓库后端会拒绝删除。",
                                tone: "danger",
                                confirmText: "删除",
                              });
                              if (ok) remove.mutate(warehouse.id);
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
        <WarehouseFormDialog
          warehouse={dialog}
          submitting={save.isPending}
          onClose={() => setDialog(undefined)}
          onSubmit={(input) => save.mutate(input)}
        />
      ) : null}
    </div>
  );
}

function WarehouseFormDialog({
  warehouse,
  onSubmit,
  onClose,
  submitting,
}: {
  /** null = 新建。 */
  warehouse: AssetWarehouse | null;
  onSubmit: (input: WarehouseInput) => void;
  onClose: () => void;
  submitting: boolean;
}) {
  const [name, setName] = useState(warehouse?.name ?? "");
  const [code, setCode] = useState(warehouse?.code ?? "");
  const [location, setLocation] = useState(warehouse?.location ?? "");
  const [remark, setRemark] = useState(warehouse?.remark ?? "");
  // ★ 负责人必须进表单：后端是**无条件覆盖**这个字段的，
  //   表单不带它的话，随便改一下名字就把原来的负责人清掉了。
  const [managerId, setManagerId] = useState(
    warehouse?.manager_user_id != null ? String(warehouse.manager_user_id) : "",
  );

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      name,
      code,
      location: location || null,
      remark: remark || null,
      manager_user_id: managerId ? Number(managerId) : null,
    });
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{warehouse ? `修改仓库 ${warehouse.code}` : "新建仓库"}</DialogTitle>
          <DialogDescription>
            编号留空时由系统按 WH-0001 顺延；改的时候留空表示保留原编号。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="warehouse-name">仓库名称</Label>
              <Input
                id="warehouse-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="大殿储藏室"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="warehouse-code">编号</Label>
              <Input
                id="warehouse-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="留空自动生成"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="warehouse-location">位置</Label>
              <Input
                id="warehouse-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="二楼东侧"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="warehouse-manager">负责人</Label>
              <UserSelect
                id="warehouse-manager"
                value={managerId}
                onChange={setManagerId}
                fallbackLabel={warehouse?.manager_name}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="warehouse-remark">备注</Label>
              <Textarea
                id="warehouse-remark"
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
