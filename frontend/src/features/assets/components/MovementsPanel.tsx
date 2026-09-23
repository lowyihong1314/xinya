import { useApiQuery } from "@/shared/api/useApiQuery";
import {
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui";

import { assetKeys, fetchAssetMovements } from "../api";
import { formatDateTime, formatDelta, movementTypeLabel, subItemLabel } from "../format";
import type { AssetStockDocument, AssetStockMovement } from "../types";

/**
 * 库存流水。
 *
 * ★ **流水是只增不减的账。** 作废一张已确认的单据不会删掉原来的流水，而是按 id 倒序
 *   再写一批 `cancel` 的反向流水。所以同一个子物品会出现「入库 +10」「作废回滚 -10」
 *   两行，这不是重复记账。
 *
 * ★ 后端 `/asset/movements` 返回的还是**单据**，流水挂在 documents[].movements 里，
 *   而且那一档的 documents 的 `lines` 是空数组（接口没给，不是真没有明细）。
 *   要一张平的流水表得自己 flatMap —— 顺带把单据类型带下来，
 *   因为「盘盈 / 盘亏」「调拨出 / 调拨入」要看单据类型 + 数量符号才说得清。
 *
 * 单独一个文件：它有自己的一条查询，而 Tabs 默认不挂载未选中的分页 ——
 * 放在这里等于「点开流水才发请求」，不用自己写 enabled 开关。
 */
export function MovementsPanel() {
  const query = useApiQuery(assetKeys.movements(), fetchAssetMovements);

  if (query.isPending) {
    return (
      <div className="space-y-1.5">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );
  }
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  // isPending 为 false 不等于一定有数据（查询被禁用时也是 false，见 useApiQuery）
  if (!query.data) return <EmptyState title="没有数据" />;

  // 变量名用 doc 不用 document：后者会在回调里把全局的 `document` 遮掉。
  const rows: Array<{ movement: AssetStockMovement; doc: AssetStockDocument }> =
    query.data.documents.flatMap((doc) => doc.movements.map((movement) => ({ movement, doc })));

  // 后端按单据排序（created_at desc），单据内部的流水是插入顺序。
  // 整张表要按时间倒序才读得下去，所以这里再排一次：同一单据内按 id 倒序。
  rows.sort((a, b) => {
    const at = a.movement.created_at ?? "";
    const bt = b.movement.created_at ?? "";
    if (at !== bt) return at < bt ? 1 : -1;
    return b.movement.id - a.movement.id;
  });

  if (rows.length === 0) {
    return (
      <EmptyState
        title="还没有库存流水"
        description="流水在单据被「确认」的那一刻产生 —— 草稿单据不会出现在这里。"
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0 pt-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>时间</TableHead>
              <TableHead>单号</TableHead>
              <TableHead>动作</TableHead>
              <TableHead>仓库</TableHead>
              <TableHead>物品</TableHead>
              <TableHead className="text-right">变动</TableHead>
              <TableHead className="text-right">变动后</TableHead>
              <TableHead>领用人</TableHead>
              <TableHead>经办</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ movement, doc }) => (
              <TableRow key={movement.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDateTime(movement.created_at)}
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono text-xs">
                  {doc.document_no}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {movementTypeLabel(movement.movement_type, doc.document_type, movement.quantity_delta)}
                </TableCell>
                <TableCell className="whitespace-nowrap">{movement.warehouse_name || "—"}</TableCell>
                <TableCell>
                  <span className="font-medium">{movement.item_name || "—"}</span>
                  <span className="ml-1.5 text-muted-foreground">
                    {subItemLabel({ name: movement.sub_item_name || "—" })}
                  </span>
                </TableCell>
                <TableCell
                  className={
                    movement.quantity_delta >= 0
                      ? "text-right font-mono tabular-nums text-success"
                      : "text-right font-mono tabular-nums text-destructive"
                  }
                >
                  {formatDelta(movement.quantity_delta)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {movement.quantity_after}
                </TableCell>
                <TableCell className="whitespace-nowrap">{movement.taken_by_name || "—"}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {movement.created_by_name || "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
