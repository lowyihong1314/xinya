import { Plus, Trash2 } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  Textarea,
} from "@/shared/ui";

import type { StockDocumentInput, StockDocumentLineInput } from "../api";
import {
  CREATABLE_DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  allowedPartnerTypes,
  canLinkReimbursement,
  formatMoney,
  isActive,
  keepsInvoiceFields,
  needsSourceWarehouse,
  needsTargetWarehouse,
  resolveDestinationType,
  sourceWarehouseLabel,
  subItemLabel,
} from "../format";
import type { AssetItem, AssetPartner, AssetStockDocument, AssetWarehouse, DocumentType } from "../types";
import { UserSelect } from "./UserSelect";

/**
 * 建 / 改一张出入库单据（抬头 + 至少一条明细）。
 *
 * 校验的分工和凭证那边一样：
 *   · 后端管「对不对」—— 类型不合法、调拨没选两个仓库、第 N 行没选子物品、数量不是整数，
 *     每条都有中文文案，提交失败时原样 toast 出来。
 *   · 前端只管「看得见」—— 按单据类型显示/隐藏该填的仓库，实时算金额合计。
 *
 * ★★ **这个表单提交的是「整份覆盖」，不是打补丁。** 后端 `_validate_document_payload`
 *    对每个键都无条件取值写回单据，**少传一个键就等于把那个字段清空**。
 *    所以下面有三个字段没有控件、但一定要带上原值往回发：
 *      · event_id     —— 关联活动（选活动要拉活动列表，这里没做）
 *      · invoice_type —— 上传发票时后端自己写的 MIME，表单不该碰
 *      · reference_*  —— 非采购入库时后端本来就会清掉，采购入库要留住
 *    唯一的例外是 invoice_file_path：后端判的是「**键在不在**」，
 *    所以 StockDocumentInput 里压根没有这个字段（传 null 会把发票摘掉）。
 */

interface LineDraft {
  /** 仅用于 React 的 key：明细行没有稳定标识（新行没有 id，行序还会变）。 */
  key: number;
  subItemId: string;
  quantity: string;
  unitCost: string;
  unitPrice: string;
  lineAmount: string;
  remark: string;
}

function emptyLine(key: number): LineDraft {
  return { key, subItemId: "", quantity: "1", unitCost: "", unitPrice: "", lineAmount: "", remark: "" };
}

/** "" / "abc" 都算 0，只用来显示合计；真正的校验在后端。 */
function toNumber(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** 这一行的金额：填了就用填的，没填就按 单价×数量（没有单价就成本价×数量）—— 和后端一个算法。 */
function lineAmountOf(line: LineDraft): number {
  if (line.lineAmount.trim()) return toNumber(line.lineAmount);
  const quantity = toNumber(line.quantity);
  const unit = line.unitPrice.trim() ? toNumber(line.unitPrice) : toNumber(line.unitCost);
  return Math.round(unit * quantity * 100) / 100;
}

export function StockDocumentFormDialog({
  // 解构成 doc：叫 document 会把全局的 `document` 在整个函数体里遮掉。
  document: doc,
  warehouses,
  items,
  partners,
  onSubmit,
  onClose,
  submitting,
}: {
  /** null = 新建。改的时候只可能是 draft（confirmed / cancelled 后端不让改）。 */
  document: AssetStockDocument | null;
  warehouses: AssetWarehouse[];
  items: AssetItem[];
  partners: AssetPartner[];
  onSubmit: (input: StockDocumentInput) => void;
  onClose: () => void;
  submitting: boolean;
}) {
  const nextKey = useRef(0);
  const makeLine = () => emptyLine(nextKey.current++);

  const [documentType, setDocumentType] = useState<DocumentType>(doc?.document_type ?? "purchase_in");
  const [sourceWarehouseId, setSourceWarehouseId] = useState(
    doc?.source_warehouse_id != null ? String(doc.source_warehouse_id) : "",
  );
  const [targetWarehouseId, setTargetWarehouseId] = useState(
    doc?.target_warehouse_id != null ? String(doc.target_warehouse_id) : "",
  );
  const [counterpartyId, setCounterpartyId] = useState(
    doc?.counterparty_id != null ? String(doc.counterparty_id) : "",
  );
  const [counterpartyName, setCounterpartyName] = useState(doc?.counterparty_name ?? "");
  const [handlerId, setHandlerId] = useState(
    doc?.handler_user_id != null ? String(doc.handler_user_id) : "",
  );
  const [takenById, setTakenById] = useState(
    doc?.taken_by_user_id != null ? String(doc.taken_by_user_id) : "",
  );
  const [takenByName, setTakenByName] = useState(doc?.taken_by_name ?? "");
  const [destinationText, setDestinationText] = useState(doc?.destination_text ?? "");
  const [invoiceNo, setInvoiceNo] = useState(doc?.invoice_no ?? "");
  const [referenceId, setReferenceId] = useState(
    doc?.reference_id != null ? String(doc.reference_id) : "",
  );
  const [note, setNote] = useState(doc?.note ?? "");
  const [lines, setLines] = useState<LineDraft[]>(() =>
    doc && doc.lines.length > 0
      ? doc.lines.map((line) => ({
          key: nextKey.current++,
          subItemId: String(line.sub_item_id),
          quantity: String(line.quantity),
          // 后端没填的是 null，别写成 "null"；0 也是有效金额，所以只判 null。
          unitCost: line.unit_cost === null ? "" : String(line.unit_cost),
          unitPrice: line.unit_price === null ? "" : String(line.unit_price),
          lineAmount: line.line_amount === null ? "" : String(line.line_amount),
          remark: line.remark ?? "",
        }))
      : [makeLine()],
  );

  // 停用的子物品不给选（新建时）。但旧单据上那一行的子物品可能已经停用了 ——
  // 它仍然要能显示，否则原生 <select> 会跳到第一个选项，一保存就把行换掉了。
  const allSubItems = items.flatMap((item) => item.sub_items);
  const usablePartners = partners.filter((partner) =>
    allowedPartnerTypes(documentType).includes(partner.partner_type),
  );
  const showSource = needsSourceWarehouse(documentType);
  const showTarget = needsTargetWarehouse(documentType);
  const showInvoice = keepsInvoiceFields(documentType);
  const showReference = canLinkReimbursement(documentType);

  // 盘点调整的数量可正可负（盘盈 / 盘亏），其余类型后端要求 > 0。
  const allowNegative = documentType === "adjust";
  const total = lines.reduce((sum, line) => sum + lineAmountOf(line), 0);

  const patchLine = (key: number, next: Partial<LineDraft>) =>
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...next } : line)));

  function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const payloadLines: StockDocumentLineInput[] = lines.map((line) => ({
      sub_item_id: line.subItemId ? Number(line.subItemId) : null,
      quantity: line.quantity,
      unit_cost: line.unitCost,
      unit_price: line.unitPrice,
      line_amount: line.lineAmount,
      remark: line.remark || null,
    }));

    onSubmit({
      document_type: documentType,
      // 不该有仓库的类型一律发 null：隐藏控件之后还把上一次选的值带过去，
      // 会出现「入库单挂着一个来源仓库」这种自己看不见、后端也不拦的脏数据。
      source_warehouse_id: showSource && sourceWarehouseId ? Number(sourceWarehouseId) : null,
      target_warehouse_id: showTarget && targetWarehouseId ? Number(targetWarehouseId) : null,
      requester_user_id: doc?.requester_user_id ?? null,
      handler_user_id: handlerId ? Number(handlerId) : null,
      taken_by_user_id: takenById ? Number(takenById) : null,
      taken_by_name: takenByName || null,
      destination_type: resolveDestinationType(documentType),
      destination_text: destinationText || null,
      counterparty_id: counterpartyId ? Number(counterpartyId) : null,
      counterparty_name: counterpartyName || null,
      // 下面三个没有控件，原样带回去 —— 不带就等于清空，见文件顶部的说明。
      event_id: doc?.event_id ?? null,
      invoice_type: doc?.invoice_type ?? null,
      invoice_no: showInvoice ? invoiceNo || null : null,
      // 采购入库：以输入框为准，清空 = 解除关联。
      // 其余类型：后端本来就会把这两个字段清掉，但仍然把原值带回去 —— 悄悄清掉别人的数据
      //          不该是前端干的事，真要清也得是后端那条规则说了算。
      reference_type: showReference
        ? referenceId
          ? "reimbursement_request"
          : null
        : doc?.reference_type ?? null,
      reference_id: showReference ? (referenceId ? Number(referenceId) : null) : doc?.reference_id ?? null,
      note: note || null,
      lines: payloadLines,
    });
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{doc ? `修改单据 ${doc.document_no}` : "新建库存单据"}</DialogTitle>
          <DialogDescription>
            单号由系统生成。保存出来的是草稿，不动库存 —— 要真正加减库存，回列表点「确认」。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="doc-type">单据类型</Label>
              <Select
                id="doc-type"
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value as DocumentType)}
              >
                {CREATABLE_DOCUMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {DOCUMENT_TYPE_LABELS[type]}
                  </option>
                ))}
                {/* 销售单据不能在这里新建（走销售收入那边），但已经存在的要能继续改，
                    所以只有改这种单据时才补上它自己的那一项。 */}
                {doc && !CREATABLE_DOCUMENT_TYPES.includes(doc.document_type) ? (
                  <option value={doc.document_type}>
                    {DOCUMENT_TYPE_LABELS[doc.document_type]}（旧单据）
                  </option>
                ) : null}
              </Select>
            </div>

            {showSource ? (
              <div className="space-y-1.5">
                <Label htmlFor="doc-source">{sourceWarehouseLabel(documentType)}</Label>
                <Select
                  id="doc-source"
                  value={sourceWarehouseId}
                  onChange={(e) => setSourceWarehouseId(e.target.value)}
                >
                  <option value="">请选择…</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={String(warehouse.id)}>
                      {warehouse.name}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}

            {showTarget ? (
              <div className="space-y-1.5">
                <Label htmlFor="doc-target">目标仓库</Label>
                <Select
                  id="doc-target"
                  value={targetWarehouseId}
                  onChange={(e) => setTargetWarehouseId(e.target.value)}
                >
                  <option value="">请选择…</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={String(warehouse.id)}>
                      {warehouse.name}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="doc-counterparty">往来对象</Label>
              <Select
                id="doc-counterparty"
                value={counterpartyId}
                onChange={(e) => setCounterpartyId(e.target.value)}
              >
                <option value="">不指定</option>
                {/* 旧单据上的往来对象可能已经不属于这个类型了，补一项，别让它被换掉 */}
                {counterpartyId && !usablePartners.some((p) => String(p.id) === counterpartyId) ? (
                  <option value={counterpartyId}>{doc?.counterparty_name || `#${counterpartyId}`}</option>
                ) : null}
                {usablePartners.map((partner) => (
                  <option key={partner.id} value={String(partner.id)}>
                    {partner.code} {partner.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="doc-counterparty-name">往来对象名称</Label>
              <Input
                id="doc-counterparty-name"
                value={counterpartyName}
                onChange={(e) => setCounterpartyName(e.target.value)}
                placeholder="留空取上面所选的名字"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="doc-handler">经手人</Label>
              <UserSelect
                id="doc-handler"
                value={handlerId}
                onChange={setHandlerId}
                fallbackLabel={doc?.handler_name}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="doc-taken-by">领用人</Label>
              <UserSelect
                id="doc-taken-by"
                value={takenById}
                onChange={setTakenById}
                fallbackLabel={doc?.taken_by_name}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="doc-taken-by-name">领用人姓名</Label>
              <Input
                id="doc-taken-by-name"
                value={takenByName}
                onChange={(e) => setTakenByName(e.target.value)}
                placeholder="不是系统用户时填这里"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="doc-destination">去向说明</Label>
              <Input
                id="doc-destination"
                value={destinationText}
                onChange={(e) => setDestinationText(e.target.value)}
                placeholder="送去哪里 / 给谁用"
              />
            </div>

            {showInvoice ? (
              <div className="space-y-1.5">
                <Label htmlFor="doc-invoice-no">Invoice 编号</Label>
                <Input
                  id="doc-invoice-no"
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  className="font-mono"
                />
              </div>
            ) : null}

            {showReference ? (
              <div className="space-y-1.5">
                <Label htmlFor="doc-reference">关联报销单编号</Label>
                <Input
                  id="doc-reference"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={referenceId}
                  onChange={(e) => setReferenceId(e.target.value)}
                  placeholder="报销单 #"
                  className="font-mono"
                />
                {/* 这里只收编号不做选单：选单要读报销列表，而那条接口要 account_* 权限，
                    只有 asset_edit 的人会 403。编号填错后端回「找不到报销申请」。 */}
                <p className="text-xs text-muted-foreground">
                  填了之后 Invoice 编号留空的话，后端会自动写成这个单号。
                </p>
              </div>
            ) : null}

            <div className="space-y-1.5 sm:col-span-3">
              <Label htmlFor="doc-note">备注</Label>
              <Textarea id="doc-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">明细</h4>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLines((prev) => [...prev, makeLine()])}
              >
                <Plus />
                加一行
              </Button>
            </div>

            {/* 列标题只在宽屏显示；窄屏每个控件自己带 placeholder / aria-label，
                因为一行六个控件横排在手机上一定挤成一团。 */}
            <div className="hidden gap-2 px-1 text-xs text-muted-foreground sm:grid sm:grid-cols-12">
              <span className="sm:col-span-4">子物品</span>
              <span className="sm:col-span-2 text-right">数量</span>
              <span className="sm:col-span-2 text-right">成本价</span>
              <span className="sm:col-span-2 text-right">单价</span>
              <span className="sm:col-span-1 text-right">金额</span>
            </div>

            <ul className="space-y-2">
              {lines.map((line, index) => {
                const chosen = allSubItems.find((sub) => String(sub.id) === line.subItemId);
                const showChosenAnyway = chosen && !isActive(chosen.status);

                return (
                  <li
                    key={line.key}
                    className="grid gap-2 rounded-[var(--radius-sm)] border border-border p-2 sm:grid-cols-12 sm:items-center sm:border-0 sm:p-0"
                  >
                    <div className="sm:col-span-4">
                      <Select
                        value={line.subItemId}
                        onChange={(e) => patchLine(line.key, { subItemId: e.target.value })}
                        aria-label={`第 ${index + 1} 行子物品`}
                      >
                        <option value="">选择子物品…</option>
                        {showChosenAnyway ? (
                          <option value={line.subItemId}>{subItemLabel(chosen)}（已停用）</option>
                        ) : null}
                        {items.map((item) => (
                          <optgroup key={item.id} label={`${item.code} ${item.name}`}>
                            {item.sub_items
                              .filter((sub) => isActive(sub.status))
                              .map((sub) => (
                                <option key={sub.id} value={String(sub.id)}>
                                  {subItemLabel(sub)}
                                </option>
                              ))}
                          </optgroup>
                        ))}
                      </Select>
                    </div>
                    <div className="sm:col-span-2">
                      <Input
                        type="number"
                        step={1}
                        // 盘点调整可以填负数（盘亏），其余类型后端要求 > 0
                        min={allowNegative ? undefined : 1}
                        inputMode="numeric"
                        className="text-right font-mono tabular-nums"
                        placeholder="数量"
                        aria-label={`第 ${index + 1} 行数量`}
                        value={line.quantity}
                        onChange={(e) => patchLine(line.key, { quantity: e.target.value })}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Input
                        type="number"
                        step="0.01"
                        inputMode="decimal"
                        className="text-right font-mono tabular-nums"
                        placeholder="成本价"
                        aria-label={`第 ${index + 1} 行成本价`}
                        value={line.unitCost}
                        onChange={(e) => patchLine(line.key, { unitCost: e.target.value })}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Input
                        type="number"
                        step="0.01"
                        inputMode="decimal"
                        className="text-right font-mono tabular-nums"
                        placeholder="单价"
                        aria-label={`第 ${index + 1} 行单价`}
                        value={line.unitPrice}
                        onChange={(e) => patchLine(line.key, { unitPrice: e.target.value })}
                      />
                    </div>
                    <div className="sm:col-span-1">
                      <Input
                        type="number"
                        step="0.01"
                        inputMode="decimal"
                        className="text-right font-mono tabular-nums"
                        placeholder="金额"
                        aria-label={`第 ${index + 1} 行金额`}
                        value={line.lineAmount}
                        onChange={(e) => patchLine(line.key, { lineAmount: e.target.value })}
                      />
                    </div>
                    <div className="flex justify-end sm:col-span-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`删除第 ${index + 1} 行`}
                        // 一条都不剩时后端一定拒（「至少需要一条库存明细」），所以不让删到那步
                        disabled={lines.length <= 1}
                        onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    <div className="sm:col-span-12">
                      <Input
                        placeholder="这一行的说明"
                        aria-label={`第 ${index + 1} 行说明`}
                        value={line.remark}
                        onChange={(e) => patchLine(line.key, { remark: e.target.value })}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="flex items-center justify-end gap-2 rounded-[var(--radius-sm)] bg-muted px-3 py-2 text-sm">
              <span className="text-muted-foreground">金额合计</span>
              <span className="font-mono tabular-nums">{formatMoney(total)}</span>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit" loading={submitting}>
              保存草稿
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
