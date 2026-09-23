import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, CheckCircle2, ChevronDown, ChevronRight, Landmark, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { ApiError } from "@/shared/api/errors";
import { useApiQuery } from "@/shared/api/useApiQuery";
import { useAuth } from "@/shared/auth/AuthProvider";
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useConfirm,
  useToast,
} from "@/shared/ui";

import {
  assetKeys,
  cancelStockDocument,
  confirmStockDocument,
  createStockDocument,
  deleteStockDocument,
  fetchAssetPartners,
  fetchStockDocuments,
  postStockDocumentToFinance,
  updateStockDocument,
  type StockDocumentInput,
} from "../api";
import { DocumentStatusBadge, DocumentTypeBadge, FinanceStatusBadge } from "../components/DocumentBadges";
import { InvoiceUpload } from "../components/InvoiceUpload";
import { MovementsPanel } from "../components/MovementsPanel";
import { StockDocumentFormDialog } from "../components/StockDocumentFormDialog";
import {
  DOCUMENT_TYPE_LABELS,
  documentTotal,
  formatDateTime,
  formatMoney,
  subItemLabel,
} from "../format";
import type { AssetStockDocument, DocumentStatus, DocumentType } from "../types";

/**
 * 出入库单据。
 *
 * 状态机（后端 service.py 定的，界面照着它显示按钮，别多给）：
 *   草稿 draft     → 可改、可删、可确认、可作废
 *   已确认 confirmed → 只能作废（作废会按原流水逐条写反向流水把库存退回去）
 *                     销售单据还能「推送到收款审核」，且只能推一次
 *   已作废 cancelled → 终点，什么都不能做
 *
 * ★ 没有做单据详情页，是因为后端**没有「取单条单据」的接口** —— 列表那条写死
 *   `limit=30` 也没有翻页。详情页只能靠列表里找，第 31 张单据的链接就会是 404，
 *   那种页面不如不做。所以这里用展开行：看到的永远是列表里确实有的那几张。
 */
export function StockDocumentsPage() {
  const { has } = useAuth();
  // 后端写权限认 asset_edit | account_edit（见 api/asset/permissions.py），照抄它，
  // 不要只判 asset_edit —— 那会让财政同事看得见单据却点不动任何按钮。
  const canEdit = has("asset_edit") || has("account_edit");
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<DocumentStatus | "">("");
  const [typeFilter, setTypeFilter] = useState<DocumentType | "">("");
  const [keyword, setKeyword] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  // undefined = 对话框关着；null = 新建；对象 = 改这一张。
  // 「关着就不挂载」保证每次打开都是干净的表单。
  const [dialog, setDialog] = useState<AssetStockDocument | null | undefined>(undefined);

  const list = useApiQuery(assetKeys.documents(), fetchStockDocuments);
  // 单据列表那条接口给了 warehouses 和 items，**没给 partners** —— 往来对象要单独拉。
  // 这个列表很小，而且表单一打开就要用，等到那时候再拉会让下拉空着闪一下。
  const partners = useApiQuery(assetKeys.partners(), fetchAssetPartners);

  const invalidateAll = () => void qc.invalidateQueries({ queryKey: assetKeys.all });

  const save = useMutation({
    mutationFn: (input: StockDocumentInput) =>
      dialog ? updateStockDocument(dialog.id, input) : createStockDocument(input),
    onSuccess: (doc) => {
      toast.success(dialog ? "库存单据已更新" : `库存单据 ${doc.document_no} 已创建`);
      setDialog(undefined);
      invalidateAll();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "保存失败"),
  });

  const approve = useMutation({
    mutationFn: (id: number) => confirmStockDocument(id),
    onSuccess: () => {
      toast.success("库存单据已确认");
      invalidateAll();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "确认失败"),
  });

  const discard = useMutation({
    mutationFn: (id: number) => cancelStockDocument(id),
    onSuccess: () => {
      toast.success("库存单据已作废");
      invalidateAll();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "作废失败"),
  });

  const pushToFinance = useMutation({
    mutationFn: (id: number) => postStockDocumentToFinance(id),
    onSuccess: () => {
      toast.success("已推送到收款审核");
      invalidateAll();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "推送失败"),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteStockDocument(id),
    onSuccess: () => {
      toast.success("库存单据已删除");
      invalidateAll();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "删除失败"),
  });

  if (list.isPending) return <LoadingState />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  // isPending 为 false 不等于一定有数据（查询被禁用时也是 false，见 useApiQuery）
  if (!list.data) return <EmptyState title="没有数据" />;

  const { documents, warehouses, items } = list.data;
  const kw = keyword.trim().toLowerCase();
  const visible = documents.filter((doc) => {
    if (statusFilter && doc.status !== statusFilter) return false;
    if (typeFilter && doc.document_type !== typeFilter) return false;
    if (!kw) return true;
    return `${doc.document_no} ${doc.counterparty_name ?? ""} ${doc.invoice_no ?? ""} ${doc.note ?? ""}`
      .toLowerCase()
      .includes(kw);
  });

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2">
        {/* asChild 只能有单一子节点 —— 图标和文字都放进 <Link> 里 */}
        <Link to="/assets">
          <ArrowLeft />
          资产
        </Link>
      </Button>

      <PageHeader
        title="库存单据"
        description="后端固定只发最近 30 张单据，没有翻页。"
        actions={
          canEdit ? (
            <Button size="sm" onClick={() => setDialog(null)}>
              <Plus />
              新建单据
            </Button>
          ) : null
        }
      />

      <Tabs defaultValue="documents">
        <TabsList>
          <TabsTrigger value="documents">单据</TabsTrigger>
          <TabsTrigger value="movements">流水</TabsTrigger>
        </TabsList>

        <TabsContent value="documents">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[12rem] flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索单号 / 往来对象 / invoice"
                className="pl-9"
                aria-label="搜索单据"
              />
            </div>
            <div className="min-w-[8rem]">
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as DocumentStatus | "")}
                aria-label="按状态过滤"
              >
                <option value="">全部状态</option>
                <option value="draft">草稿</option>
                <option value="confirmed">已确认</option>
                <option value="cancelled">已作废</option>
              </Select>
            </div>
            <div className="min-w-[9rem]">
              <Select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as DocumentType | "")}
                aria-label="按类型过滤"
              >
                <option value="">全部类型</option>
                {Object.entries(DOCUMENT_TYPE_LABELS).map(([type, label]) => (
                  <option key={type} value={type}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              title={documents.length === 0 ? "还没有库存单据" : "没有匹配的单据"}
              description={
                documents.length === 0 ? "所有库存加减都从一张单据开始，先建一张草稿。" : undefined
              }
            />
          ) : (
            <Card>
              <CardContent className="p-0 pt-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead>单号</TableHead>
                      <TableHead>类型</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>仓库</TableHead>
                      <TableHead>往来对象</TableHead>
                      <TableHead className="text-right">金额</TableHead>
                      <TableHead>创建</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((doc) => (
                      <DocumentRows
                        key={doc.id}
                        doc={doc}
                        canEdit={canEdit}
                        open={expanded === doc.id}
                        busy={
                          approve.isPending ||
                          discard.isPending ||
                          pushToFinance.isPending ||
                          remove.isPending
                        }
                        onToggle={() => setExpanded((v) => (v === doc.id ? null : doc.id))}
                        onEdit={() => setDialog(doc)}
                        onConfirmDocument={async () => {
                          const ok = await confirm({
                            title: `确认单据 ${doc.document_no}？`,
                            description:
                              "确认之后会真正加减库存并写入流水，没有回头路 —— 撤销只能作废，而作废是再记一批反向流水。",
                            tone: "danger",
                            confirmText: "确认单据",
                          });
                          if (ok) approve.mutate(doc.id);
                        }}
                        onCancelDocument={async () => {
                          const ok = await confirm({
                            title: `作废单据 ${doc.document_no}？`,
                            description:
                              doc.status === "confirmed"
                                ? "会按原流水逐条写反向流水把库存退回去。作废是终态，不可撤销。"
                                : "作废是终态，不可撤销。",
                            tone: "danger",
                            confirmText: "作废",
                          });
                          if (ok) discard.mutate(doc.id);
                        }}
                        onPostToFinance={async () => {
                          const ok = await confirm({
                            title: `把 ${doc.document_no} 推送到收款审核？`,
                            description:
                              "这笔销售会出现在收款审核列表里，之后由财政处理。只能推一次，不可撤销。",
                            tone: "danger",
                            confirmText: "推送",
                          });
                          if (ok) pushToFinance.mutate(doc.id);
                        }}
                        onDelete={async () => {
                          const ok = await confirm({
                            title: `删除单据 ${doc.document_no}？`,
                            description: "连同已上传的 invoice 文件一起删掉，不可撤销。",
                            tone: "danger",
                            confirmText: "删除",
                          });
                          if (ok) remove.mutate(doc.id);
                        }}
                      />
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="movements">
          <MovementsPanel />
        </TabsContent>
      </Tabs>

      {dialog !== undefined ? (
        <StockDocumentFormDialog
          document={dialog}
          warehouses={warehouses}
          items={items}
          partners={partners.data ?? []}
          submitting={save.isPending}
          onClose={() => setDialog(undefined)}
          onSubmit={(input) => save.mutate(input)}
        />
      ) : null}
    </div>
  );
}

/** 一张单据 = 主行 + （展开时）一行明细。两行必须同父，所以包成一个片段组件。 */
function DocumentRows({
  doc,
  canEdit,
  open,
  busy,
  onToggle,
  onEdit,
  onConfirmDocument,
  onCancelDocument,
  onPostToFinance,
  onDelete,
}: {
  doc: AssetStockDocument;
  canEdit: boolean;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onConfirmDocument: () => void;
  onCancelDocument: () => void;
  onPostToFinance: () => void;
  onDelete: () => void;
}) {
  const isDraft = doc.status === "draft";
  const isConfirmed = doc.status === "confirmed";
  const isSales = doc.document_type === "sale_out" || doc.document_type === "sale_return";
  // 只有「已确认 + 销售 + 还没推过」这三条同时成立才推得动，后端三句不同的拒绝文案。
  const canPush = isConfirmed && isSales && !doc.finance_payment_status;
  const total = documentTotal(doc.lines);

  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell className="pr-0 text-muted-foreground">
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </TableCell>
        <TableCell className="whitespace-nowrap font-mono text-xs">{doc.document_no}</TableCell>
        <TableCell>
          <DocumentTypeBadge type={doc.document_type} />
        </TableCell>
        <TableCell>
          <span className="flex flex-wrap items-center gap-1">
            <DocumentStatusBadge status={doc.status} />
            {doc.finance_payment_status ? (
              <FinanceStatusBadge status={doc.finance_payment_status} />
            ) : null}
          </span>
        </TableCell>
        <TableCell className="whitespace-nowrap">
          {/* 调拨要看两头，其余类型只有一头有值 */}
          {[doc.source_warehouse_name, doc.target_warehouse_name].filter(Boolean).join(" → ") || "—"}
        </TableCell>
        <TableCell className="max-w-[12rem] truncate">{doc.counterparty_name || "—"}</TableCell>
        <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
          {formatMoney(total)}
        </TableCell>
        <TableCell className="whitespace-nowrap text-muted-foreground">
          {formatDateTime(doc.created_at)}
        </TableCell>
      </TableRow>

      {open ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={8} className="bg-muted/40">
            <div className="space-y-4 py-2">
              <section className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Field label="申请人" value={doc.requester_name} />
                <Field label="经手人" value={doc.handler_name} />
                <Field label="领用人" value={doc.taken_by_name} />
                <Field label="去向" value={doc.destination_text} />
                <Field label="关联活动" value={doc.event_name} />
                <Field label="Invoice 编号" value={doc.invoice_no} mono />
                <Field label="创建人" value={doc.created_by_name} />
                <Field label="审批人" value={doc.approved_by_name} />
                <Field label="确认时间" value={formatDateTime(doc.confirmed_at)} />
                {doc.note ? <Field label="备注" value={doc.note} /> : null}
              </section>

              <section>
                <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">明细</h4>
                {doc.lines.length === 0 ? (
                  <p className="text-sm text-muted-foreground">这条接口没有带明细。</p>
                ) : (
                  <ul className="space-y-1">
                    {doc.lines.map((line) => (
                      <li
                        key={line.id}
                        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-sm"
                      >
                        <span className="min-w-0 truncate">
                          {line.item_name ? `${line.item_name} · ` : ""}
                          {subItemLabel({ name: line.sub_item_name || "—", size: line.size })}
                          {line.remark ? (
                            <span className="ml-1.5 text-muted-foreground">{line.remark}</span>
                          ) : null}
                        </span>
                        <span className="shrink-0 space-x-3 font-mono tabular-nums">
                          <span>×{line.quantity}</span>
                          <span className="text-muted-foreground">{formatMoney(line.line_amount)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h4 className="mb-1.5 text-xs font-medium text-muted-foreground">Invoice 文件</h4>
                <InvoiceUpload document={doc} canEdit={canEdit} />
              </section>

              {canEdit ? (
                <section className="flex flex-wrap gap-2">
                  {isDraft ? (
                    <>
                      <Button size="sm" disabled={busy} onClick={onConfirmDocument}>
                        <CheckCircle2 />
                        确认（加减库存）
                      </Button>
                      <Button variant="outline" size="sm" disabled={busy} onClick={onEdit}>
                        <Pencil />
                        修改
                      </Button>
                    </>
                  ) : null}
                  {canPush ? (
                    <Button variant="outline" size="sm" disabled={busy} onClick={onPostToFinance}>
                      <Landmark />
                      推送到收款审核
                    </Button>
                  ) : null}
                  {isDraft || isConfirmed ? (
                    <Button variant="outline" size="sm" disabled={busy} onClick={onCancelDocument}>
                      <Ban />
                      作废
                    </Button>
                  ) : null}
                  {isDraft ? (
                    <Button variant="ghost" size="sm" disabled={busy} onClick={onDelete}>
                      <Trash2 />
                      删除
                    </Button>
                  ) : null}
                </section>
              ) : null}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <p className="flex gap-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={mono ? "min-w-0 truncate font-mono" : "min-w-0 truncate"}>{value || "—"}</span>
    </p>
  );
}
