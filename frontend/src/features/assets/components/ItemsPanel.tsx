import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Pencil, Plus, Search, Trash2 } from "lucide-react";
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

import {
  assetKeys,
  createItem,
  createSubItem,
  deleteItem,
  deleteSubItem,
  updateItem,
  updateSubItem,
  type ItemInput,
  type SubItemInput,
} from "../api";
import { isActive } from "../format";
import type { AssetItem, AssetSubItem } from "../types";

/**
 * 物品与子物品。
 *
 * ★ 库存挂在**子物品**上，不是物品上 —— 「法会礼袋」是物品，「法会礼袋 size L」
 *   才是能入库、能出库、能盘点的那一行。所以这张表是「展开才看得到真正的库存单位」，
 *   物品那一层只是分类。没有子物品的物品在单据里是选不到的。
 */
export function ItemsPanel({ items, canEdit }: { items: AssetItem[]; canEdit: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [itemDialog, setItemDialog] = useState<AssetItem | null | undefined>(undefined);
  /** { itemId, sub } —— sub 为 null 表示在这个物品下新建一个子物品。 */
  const [subDialog, setSubDialog] = useState<{ itemId: number; sub: AssetSubItem | null } | undefined>(
    undefined,
  );

  const invalidate = () => void qc.invalidateQueries({ queryKey: assetKeys.all });

  const saveItem = useMutation({
    mutationFn: (input: ItemInput) => (itemDialog ? updateItem(itemDialog.id, input) : createItem(input)),
    onSuccess: () => {
      toast.success(itemDialog ? "资产 item 已更新" : "资产 item 已创建");
      setItemDialog(undefined);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "保存失败"),
  });

  const removeItem = useMutation({
    mutationFn: (id: number) => deleteItem(id),
    onSuccess: () => {
      toast.success("资产 item 已删除");
      invalidate();
    },
    // 「请先删除这个 Item 下的全部子 Item」来自后端，原样给用户
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "删除失败"),
  });

  const saveSub = useMutation({
    mutationFn: (input: SubItemInput) =>
      subDialog?.sub ? updateSubItem(subDialog.sub.id, input) : createSubItem(subDialog!.itemId, input),
    onSuccess: () => {
      toast.success(subDialog?.sub ? "子 item 已更新" : "子 item 已创建");
      setSubDialog(undefined);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "保存失败"),
  });

  const removeSub = useMutation({
    mutationFn: (id: number) => deleteSubItem(id),
    onSuccess: () => {
      toast.success("子 item 已删除");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "删除失败"),
  });

  const kw = keyword.trim().toLowerCase();
  const visible = kw
    ? items.filter((item) =>
        `${item.name} ${item.code} ${item.category ?? ""}`.toLowerCase().includes(kw),
      )
    : items;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索名称 / 编码 / 分类"
            className="pl-9"
            aria-label="搜索物品"
          />
        </div>
        {canEdit ? (
          <Button size="sm" onClick={() => setItemDialog(null)}>
            <Plus />
            新建物品
          </Button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <EmptyState title={kw ? "没有匹配的物品" : "还没有物品"} />
      ) : (
        <Card>
          <CardContent className="p-0 pt-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>名称</TableHead>
                  <TableHead>编码</TableHead>
                  <TableHead>分类</TableHead>
                  <TableHead>单位</TableHead>
                  <TableHead className="text-right">子物品</TableHead>
                  <TableHead>状态</TableHead>
                  {canEdit ? <TableHead /> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((item) => {
                  const open = expanded === item.id;
                  return (
                    <ItemRows
                      key={item.id}
                      item={item}
                      open={open}
                      canEdit={canEdit}
                      onToggle={() => setExpanded((v) => (v === item.id ? null : item.id))}
                      onEdit={() => setItemDialog(item)}
                      onAddSub={() => setSubDialog({ itemId: item.id, sub: null })}
                      onEditSub={(sub) => setSubDialog({ itemId: item.id, sub })}
                      onDelete={async () => {
                        const ok = await confirm({
                          title: `删除物品「${item.name}」？`,
                          description: "这一步不可撤销。还有子物品时后端会拒绝，要先把子物品删干净。",
                          tone: "danger",
                          confirmText: "删除",
                        });
                        if (ok) removeItem.mutate(item.id);
                      }}
                      onDeleteSub={async (sub) => {
                        const ok = await confirm({
                          title: `删除子物品「${sub.name}」？`,
                          description: "这一步不可撤销。已有库存、流水或出现在单据里的子物品后端会拒绝删除。",
                          tone: "danger",
                          confirmText: "删除",
                        });
                        if (ok) removeSub.mutate(sub.id);
                      }}
                    />
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {itemDialog !== undefined ? (
        <ItemFormDialog
          item={itemDialog}
          submitting={saveItem.isPending}
          onClose={() => setItemDialog(undefined)}
          onSubmit={(input) => saveItem.mutate(input)}
        />
      ) : null}

      {subDialog !== undefined ? (
        <SubItemFormDialog
          sub={subDialog.sub}
          items={items}
          submitting={saveSub.isPending}
          onClose={() => setSubDialog(undefined)}
          onSubmit={(input) => saveSub.mutate(input)}
        />
      ) : null}
    </div>
  );
}

/** 一个物品 = 主行 + （展开时）一行子物品明细。两行必须同父，所以包成一个片段组件。 */
function ItemRows({
  item,
  open,
  canEdit,
  onToggle,
  onEdit,
  onDelete,
  onAddSub,
  onEditSub,
  onDeleteSub,
}: {
  item: AssetItem;
  open: boolean;
  canEdit: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddSub: () => void;
  onEditSub: (sub: AssetSubItem) => void;
  onDeleteSub: (sub: AssetSubItem) => void;
}) {
  const columns = canEdit ? 8 : 7;

  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell className="pr-0 text-muted-foreground">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </TableCell>
        <TableCell className="font-medium">{item.name}</TableCell>
        <TableCell className="whitespace-nowrap font-mono text-muted-foreground">{item.code}</TableCell>
        <TableCell>{item.category || "—"}</TableCell>
        <TableCell>{item.unit || "—"}</TableCell>
        <TableCell className="text-right tabular-nums">{item.sub_items.length}</TableCell>
        <TableCell>
          {isActive(item.status) ? (
            <Badge variant="success">启用</Badge>
          ) : (
            <Badge variant="neutral">停用</Badge>
          )}
        </TableCell>
        {canEdit ? (
          <TableCell onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end gap-1">
              <Button variant="ghost" size="icon" aria-label={`修改 ${item.name}`} onClick={onEdit}>
                <Pencil />
              </Button>
              <Button variant="ghost" size="icon" aria-label={`删除 ${item.name}`} onClick={onDelete}>
                <Trash2 />
              </Button>
            </div>
          </TableCell>
        ) : null}
      </TableRow>

      {open ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={columns} className="bg-muted/40">
            <div className="space-y-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-xs font-medium text-muted-foreground">
                  子物品（库存就记在这一层）
                </h4>
                {canEdit ? (
                  <Button variant="outline" size="sm" onClick={onAddSub}>
                    <Plus />
                    加一个
                  </Button>
                ) : null}
              </div>

              {item.sub_items.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  还没有子物品。没有子物品的物品在单据里选不到。
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {item.sub_items.map((sub) => (
                    <li
                      key={sub.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius-sm)] bg-card px-3 py-2 text-sm"
                    >
                      <span className="font-medium">{sub.name}</span>
                      {sub.size ? <Badge variant="neutral">size {sub.size}</Badge> : null}
                      {sub.color ? <Badge variant="neutral">{sub.color}</Badge> : null}
                      {sub.sku ? (
                        <span className="font-mono text-xs text-muted-foreground">SKU {sub.sku}</span>
                      ) : null}
                      {sub.barcode ? (
                        <span className="font-mono text-xs text-muted-foreground">
                          条码 {sub.barcode}
                        </span>
                      ) : null}
                      {isActive(sub.status) ? null : <Badge variant="neutral">停用</Badge>}
                      {canEdit ? (
                        <span className="ml-auto flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`修改 ${sub.name}`}
                            onClick={() => onEditSub(sub)}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`删除 ${sub.name}`}
                            onClick={() => onDeleteSub(sub)}
                          >
                            <Trash2 />
                          </Button>
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function ItemFormDialog({
  item,
  onSubmit,
  onClose,
  submitting,
}: {
  item: AssetItem | null;
  onSubmit: (input: ItemInput) => void;
  onClose: () => void;
  submitting: boolean;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [code, setCode] = useState(item?.code ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [unit, setUnit] = useState(item?.unit ?? "");
  const [status, setStatus] = useState(item?.status ?? "active");
  const [remark, setRemark] = useState(item?.remark ?? "");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      name,
      code,
      category: category || null,
      unit,
      status,
      remark: remark || null,
    });
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? `修改物品 ${item.code}` : "新建物品"}</DialogTitle>
          <DialogDescription>
            编码留空时由系统按 ITM-0001 顺延；单位留空时后端按「件」算。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="item-name">名称</Label>
              <Input id="item-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-code">编码</Label>
              <Input
                id="item-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="留空自动生成"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-category">分类</Label>
              <Input
                id="item-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="法器 / 结缘品 / 办公"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-unit">单位</Label>
              <Input
                id="item-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="件"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="item-status">状态</Label>
              <Select id="item-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="active">启用</option>
                <option value="inactive">停用</option>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="item-remark">备注</Label>
              <Textarea
                id="item-remark"
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

function SubItemFormDialog({
  sub,
  items,
  onSubmit,
  onClose,
  submitting,
}: {
  /** null = 在当前物品下新建。 */
  sub: AssetSubItem | null;
  items: AssetItem[];
  onSubmit: (input: SubItemInput) => void;
  onClose: () => void;
  submitting: boolean;
}) {
  const [name, setName] = useState(sub?.name ?? "");
  const [sku, setSku] = useState(sub?.sku ?? "");
  const [size, setSize] = useState(sub?.size ?? "");
  const [color, setColor] = useState(sub?.color ?? "");
  const [barcode, setBarcode] = useState(sub?.barcode ?? "");
  const [status, setStatus] = useState(sub?.status ?? "active");
  const [remark, setRemark] = useState(sub?.remark ?? "");
  // 只有改的时候才谈得上「换一个所属物品」；新建时归属已经由调用方定了。
  const [itemId, setItemId] = useState(sub ? String(sub.item_id) : "");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      name,
      sku: sku || null,
      size: size || null,
      color: color || null,
      barcode: barcode || null,
      status,
      remark: remark || null,
      // 新建那条路由的物品 id 在 URL 上，请求体里带 item_id 没有意义，所以只在改的时候传。
      ...(sub && itemId ? { item_id: Number(itemId) } : {}),
    });
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{sub ? `修改子物品 ${sub.name}` : "新建子物品"}</DialogTitle>
          <DialogDescription>
            SKU 和条码填了就必须全站唯一（后端会查重）；尺码、颜色只是显示用。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {sub ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="sub-item">所属物品</Label>
                <Select id="sub-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                  {items.map((item) => (
                    <option key={item.id} value={String(item.id)}>
                      {item.code} {item.name}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="sub-name">名称</Label>
              <Input id="sub-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sub-sku">SKU</Label>
              <Input
                id="sub-sku"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sub-size">尺码</Label>
              <Input id="sub-size" value={size} onChange={(e) => setSize(e.target.value)} placeholder="M" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sub-color">颜色</Label>
              <Input id="sub-color" value={color} onChange={(e) => setColor(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sub-barcode">条码</Label>
              <Input
                id="sub-barcode"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sub-status">状态</Label>
              <Select id="sub-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="active">启用</option>
                <option value="inactive">停用</option>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="sub-remark">备注</Label>
              <Textarea
                id="sub-remark"
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
