import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Search, SlidersHorizontal } from "lucide-react";
import { useState, type FormEvent } from "react";

import { ApiError } from "@/shared/api/errors";
import { cn } from "@/shared/lib/cn";
import {
  Button,
  Card,
  CardContent,
  Checkbox,
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
  useToast,
} from "@/shared/ui";

import { assetKeys, updateInventoryThreshold } from "../api";
import { formatDateTime, subItemLabel } from "../format";
import type { AssetInventoryRow, AssetWarehouse } from "../types";

/**
 * 低于（或等于）预警线，且确实设了预警线。min_quantity 为 0 时一切都算「够」。
 * 概览那一屏也要数「有几行在预警线下」，所以判定导出去一份，避免两边各写一遍。
 */
export function isBelowThreshold(row: AssetInventoryRow): boolean {
  return row.min_quantity > 0 && row.available_quantity <= row.min_quantity;
}

/**
 * 库存。
 *
 * ★ 这一屏**改不了库存数量** —— 数量只能由单据确认产生的流水来动。
 *   唯一能直接写的是「最低库存」（预警线），它不影响账，只影响这里的红色标记。
 *   要调数量得开一张「盘点调整」单据。
 *
 * 过滤全部在前端做：后端这几条只读接口**一个查询参数都没有**，一次性把全部库存发过来。
 */
export function InventoryPanel({
  inventory,
  warehouses,
  canEdit,
}: {
  inventory: AssetInventoryRow[];
  warehouses: AssetWarehouse[];
  canEdit: boolean;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const [warehouseId, setWarehouseId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);
  const [editing, setEditing] = useState<AssetInventoryRow | null>(null);

  const saveThreshold = useMutation({
    mutationFn: ({ id, minQuantity }: { id: number; minQuantity: number }) =>
      updateInventoryThreshold(id, minQuantity),
    onSuccess: () => {
      toast.success("最低库存已更新");
      setEditing(null);
      void qc.invalidateQueries({ queryKey: assetKeys.all });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "保存失败"),
  });

  const kw = keyword.trim().toLowerCase();
  const visible = inventory.filter((row) => {
    if (warehouseId && String(row.warehouse_id) !== warehouseId) return false;
    if (onlyLow && !isBelowThreshold(row)) return false;
    if (!kw) return true;
    return `${row.item_name ?? ""} ${row.item_code ?? ""} ${row.sub_item_name ?? ""} ${row.size ?? ""} ${row.color ?? ""}`
      .toLowerCase()
      .includes(kw);
  });

  const lowCount = inventory.filter(isBelowThreshold).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索物品 / 子物品"
            className="pl-9"
            aria-label="搜索库存"
          />
        </div>
        <div className="min-w-[10rem]">
          <Select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            aria-label="按仓库过滤"
          >
            <option value="">全部仓库</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={String(warehouse.id)}>
                {warehouse.name}
              </option>
            ))}
          </Select>
        </div>
        <Label className="flex h-10 items-center gap-2 whitespace-nowrap">
          <Checkbox checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} />
          只看预警{lowCount > 0 ? `（${lowCount}）` : ""}
        </Label>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={inventory.length === 0 ? "还没有库存记录" : "没有匹配的库存"}
          description={
            inventory.length === 0 ? "库存会在第一张单据确认之后自动出现，不用手工建。" : undefined
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0 pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>仓库</TableHead>
                  <TableHead>物品</TableHead>
                  <TableHead>子物品</TableHead>
                  <TableHead className="text-right">数量</TableHead>
                  <TableHead className="text-right">预留</TableHead>
                  <TableHead className="text-right">可用</TableHead>
                  <TableHead className="text-right">最低</TableHead>
                  <TableHead>更新</TableHead>
                  {canEdit ? <TableHead /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((row) => {
                  const low = isBelowThreshold(row);
                  return (
                    <TableRow key={row.id} className={cn(low && "bg-destructive-soft/40")}>
                      <TableCell className="whitespace-nowrap">{row.warehouse_name || "—"}</TableCell>
                      <TableCell>
                        <span className="font-medium">{row.item_name || "—"}</span>
                        {row.item_code ? (
                          <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                            {row.item_code}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {subItemLabel({
                          name: row.sub_item_name || "—",
                          size: row.size,
                          color: row.color,
                        })}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{row.quantity}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {row.reserved_quantity}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        <span className="inline-flex items-center gap-1.5">
                          {low ? (
                            <AlertTriangle className="size-3.5 text-destructive" aria-label="低于预警线" />
                          ) : null}
                          {row.available_quantity}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {row.min_quantity || "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDateTime(row.updated_at)}
                      </TableCell>
                      {canEdit ? (
                        <TableCell>
                          <div className="flex justify-end">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`设置 ${row.sub_item_name ?? ""} 的最低库存`}
                              onClick={() => setEditing(row)}
                            >
                              <SlidersHorizontal />
                            </Button>
                          </div>
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

      {editing ? (
        <ThresholdDialog
          row={editing}
          submitting={saveThreshold.isPending}
          onClose={() => setEditing(null)}
          onSubmit={(minQuantity) => saveThreshold.mutate({ id: editing.id, minQuantity })}
        />
      ) : null}
    </div>
  );
}

function ThresholdDialog({
  row,
  onSubmit,
  onClose,
  submitting,
}: {
  row: AssetInventoryRow;
  onSubmit: (minQuantity: number) => void;
  onClose: () => void;
  submitting: boolean;
}) {
  const [value, setValue] = useState(String(row.min_quantity));

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // 空串 / 非数字交给后端判（「最低库存 必须是整数」「不能小于 0」都是它的文案）。
    onSubmit(Number(value));
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>设置最低库存</DialogTitle>
          <DialogDescription>
            {row.warehouse_name} ·{" "}
            {subItemLabel({ name: row.sub_item_name || "—", size: row.size, color: row.color })}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="threshold-value">最低库存</Label>
            <Input
              id="threshold-value"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="text-right font-mono tabular-nums"
            />
            <p className="text-xs text-muted-foreground">
              当前可用 <span className="font-mono">{row.available_quantity}</span>。
              填 0 表示不预警 —— 它只影响这张表上的红色标记，不影响任何账。
            </p>
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
