import { FileText } from "lucide-react";
import { Link } from "react-router-dom";

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
} from "@/shared/ui";

import { assetKeys, fetchAssetDashboard } from "../api";
import { DocumentStatusBadge, DocumentTypeBadge } from "../components/DocumentBadges";
import { InventoryPanel, isBelowThreshold } from "../components/InventoryPanel";
import { ItemsPanel } from "../components/ItemsPanel";
import { PartnersPanel } from "../components/PartnersPanel";
import { WarehousesPanel } from "../components/WarehousesPanel";
import { documentTotal, formatDateTime, formatMoney, subItemLabel } from "../format";

/**
 * 资产主页：概览 + 库存 + 物品 + 仓库 + 往来单位。
 *
 * 整页只发**一个**请求（/asset/dashboard）。它确实比 /asset/inventory +
 * /asset/master-data 重一些（多带了最近 30 张单据的明细和流水），但概览那一屏本来
 * 就要显示最近单据和库存预警 —— 那些单据不是白拿的，而两条轻接口加起来要两个请求、
 * metrics 还得自己算，口径迟早和后端漂移。
 *
 * 所有过滤都在前端做：后端这几条只读接口**一个查询参数都没有**。数据量在这个场景下
 * 是几百行的量级，够用；真到了要翻页那天，得先给后端加参数。
 */
export function AssetsPage() {
  const { has } = useAuth();
  // 后端写权限认 asset_edit | account_edit（见 api/asset/permissions.py），照抄它。
  const canEdit = has("asset_edit") || has("account_edit");

  const dashboard = useApiQuery(assetKeys.dashboard(), fetchAssetDashboard);

  if (dashboard.isPending) return <LoadingState />;
  if (dashboard.isError)
    return <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />;
  // isPending 为 false 不等于一定有数据（查询被禁用时也是 false，见 useApiQuery）
  if (!dashboard.data) return <EmptyState title="没有数据" />;

  const { metrics, warehouses, partners, items, inventory, documents } = dashboard.data;
  const lowRows = inventory.filter(isBelowThreshold);

  return (
    <div>
      <PageHeader
        title="资产"
        description="物品 → 子物品 → 库存。数量只能由单据确认产生的流水改动。"
        actions={
          <Button asChild variant="outline" size="sm">
            {/* asChild 只能有单一子节点 —— 图标和文字都放进 <Link> 里 */}
            <Link to="/assets/documents">
              <FileText />
              库存单据
            </Link>
          </Button>
        }
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="inventory">库存</TabsTrigger>
          <TabsTrigger value="items">物品</TabsTrigger>
          <TabsTrigger value="warehouses">仓库</TabsTrigger>
          <TabsTrigger value="partners">往来单位</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="space-y-6">
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Metric label="仓库" value={metrics.warehouse_count} />
              <Metric label="物品" value={metrics.item_count} />
              <Metric label="子物品" value={metrics.sub_item_count} />
              <Metric label="库存总件数" value={metrics.inventory_unit_count} />
              <Metric label="草稿单据" value={metrics.draft_document_count} />
            </section>

            <section className="space-y-2">
              <h2 className="flex flex-wrap items-center gap-2 text-sm font-medium">
                库存预警
                {lowRows.length > 0 ? (
                  <Badge variant="danger">{lowRows.length} 行</Badge>
                ) : (
                  <Badge variant="success">都在预警线以上</Badge>
                )}
              </h2>
              {lowRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  没有低于最低库存的行。（没设过最低库存的行不参与预警。）
                </p>
              ) : (
                <Card>
                  <CardContent className="divide-y divide-border p-0 pt-0">
                    {/* 只列前 8 行，剩下的去库存页看 —— 概览的作用是「要不要去看」，不是全表 */}
                    {lowRows.slice(0, 8).map((row) => (
                      <div
                        key={row.id}
                        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm"
                      >
                        <span className="min-w-0">
                          <span className="font-medium">{row.item_name || "—"}</span>
                          <span className="ml-1.5 text-muted-foreground">
                            {subItemLabel({
                              name: row.sub_item_name || "—",
                              size: row.size,
                              color: row.color,
                            })}
                          </span>
                          <span className="ml-1.5 text-muted-foreground">· {row.warehouse_name}</span>
                        </span>
                        <span className="shrink-0 font-mono tabular-nums">
                          <span className="text-destructive">{row.available_quantity}</span>
                          <span className="text-muted-foreground"> / {row.min_quantity}</span>
                        </span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-medium">最近单据</h2>
              {documents.length === 0 ? (
                <p className="text-sm text-muted-foreground">还没有库存单据。</p>
              ) : (
                <Card>
                  <CardContent className="divide-y divide-border p-0 pt-0">
                    {documents.slice(0, 5).map((doc) => (
                      <Link
                        key={doc.id}
                        to="/assets/documents"
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm hover:bg-muted/60"
                      >
                        <span className="font-mono text-xs">{doc.document_no}</span>
                        <DocumentTypeBadge type={doc.document_type} />
                        <DocumentStatusBadge status={doc.status} />
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {doc.counterparty_name || doc.destination_text || ""}
                        </span>
                        <span className="font-mono tabular-nums">{formatMoney(documentTotal(doc.lines))}</span>
                        <span className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatDateTime(doc.created_at)}
                        </span>
                      </Link>
                    ))}
                  </CardContent>
                </Card>
              )}
            </section>
          </div>
        </TabsContent>

        <TabsContent value="inventory">
          <InventoryPanel inventory={inventory} warehouses={warehouses} canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="items">
          <ItemsPanel items={items} canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="warehouses">
          <WarehousesPanel warehouses={warehouses} canEdit={canEdit} />
        </TabsContent>

        <TabsContent value="partners">
          <PartnersPanel partners={partners} canEdit={canEdit} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="space-y-0.5 py-4">
        <p className="font-mono text-2xl tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
