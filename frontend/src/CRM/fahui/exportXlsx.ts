import type { YlpOrderExportRow, YlpOrderItem } from "./types";
import { orderStatusLabel, paymentStatusLabel } from "./orderStatus";
import { PAIWEI_TEMPLATES, paiweiFieldLabel, paiweiTitleForCode } from "./intake/paiwei";

/** 牌位表单字段的固定出场顺序；数据里出现的其他 key 会按字母序补在后面。 */
const FIELD_ORDER = ["owner", "deceased", "relation", "surname", "suffix", "father", "mother", "quantity"];

/** 汇总表用中性抬头：A3/B3 的 father/mother 是在生的阳上，和 A1 的显考/显妣挤在同一列。 */
const GENERIC_FIELD_LABEL: Record<string, string> = {
  owner: "阳上",
  deceased: "对象 / 子女",
  relation: "关系",
  surname: "姓氏",
  suffix: "内容",
  father: "显考 / 阳上父",
  mother: "显妣 / 阳上母",
  quantity: "数量",
  price: "自订金额",
};

/** 估算列宽用：中日韩字符按两个字符宽算。 */
const CJK_CHAR = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/g;

/** 和新增付款弹窗（YlpPaymentModal）的选项保持一致。 */
const PAYMENT_MODE_LABEL: Record<string, string> = {
  bank: "银行转账",
  qr: "扫码",
  cash: "现金",
};

type Row = Record<string, string | number>;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

/** 一个字段可能有多行（阳上、对象、关系都能填多个人），导出时用 " / " 串起来。 */
function fieldValue(item: YlpOrderItem, key: string): string {
  const entries = item.item_form_data?.[key] || [];
  return entries
    .map((entry) => text(entry.val))
    .filter(Boolean)
    .join(" / ");
}

/** paiweiFieldLabel 只认牌位表单那几个 key，认不出来的（例如 D 的自订金额 price）退回通用抬头。 */
function categoryFieldLabel(key: string, code: string): string {
  const label = paiweiFieldLabel(key, code);
  return label === key ? GENERIC_FIELD_LABEL[key] || key : label;
}

function itemFieldKeys(item: YlpOrderItem): string[] {
  return Object.keys(item.item_form_data || {}).filter((key) => fieldValue(item, key) !== "");
}

function sortFieldKeys(keys: Iterable<string>): string[] {
  const unique = Array.from(new Set(keys));
  const known = FIELD_ORDER.filter((key) => unique.includes(key));
  const extra = unique.filter((key) => !FIELD_ORDER.includes(key)).sort();
  return [...known, ...extra];
}

/** paiweiTitleForCode 会把 D 落到 D1 的模板名上（库里两个 code 混用）；
 *  导出的表名/类型名要如实反映 code，所以先按 code 精确匹配模板。 */
function titleForCode(code: string): string {
  const template = PAIWEI_TEMPLATES.find((entry) => entry.code === code);
  return template ? template.title : paiweiTitleForCode(code);
}

function itemCode(item: YlpOrderItem): string {
  return text(item.code) || "(无代码)";
}

/** 已知模板按 PAIWEI_TEMPLATES 的定义顺序排前面，历史/异常代码按字母序排后面。 */
function sortCodes(codes: string[]): string[] {
  const known = PAIWEI_TEMPLATES.map((template) => template.code as string);
  return [...codes].sort((a, b) => {
    const ia = known.indexOf(a);
    const ib = known.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

function itemPrice(item: YlpOrderItem): number {
  const parsed = Number(item.price ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Excel 工作表名：31 字上限，且不能带 []:*?/\ ——超长或重名都会让 write 直接抛错。 */
function sheetNamer() {
  const used = new Set<string>();
  return (raw: string) => {
    const base = (raw.replace(/[[\]:*?/\\]/g, " ").trim() || "Sheet").slice(0, 31);
    let name = base;
    let n = 2;
    while (used.has(name)) {
      const suffix = `_${n}`;
      name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
      n += 1;
    }
    used.add(name);
    return name;
  };
}

/** 按每列最长内容估个宽度，省得导出来全是 ####。 */
function columnWidths(headers: string[], rows: Row[]) {
  return headers.map((header) => {
    const width = rows.reduce((longest, row) => {
      const value = String(row[header] ?? "");
      const wide = (value.match(CJK_CHAR) || []).length;
      return Math.max(longest, value.length + wide);
    }, header.length + (header.match(CJK_CHAR) || []).length);
    return { wch: Math.min(Math.max(width + 2, 8), 60) };
  });
}

/** 订单表头字段，牌位明细/分类表每一行都带上，方便单独一张表就能对账。 */
function orderColumns(order: YlpOrderExportRow): Row {
  return {
    单号: order.id,
    功德主: text(order.customer_name) || text(order.name),
    联络人: text(order.name),
    电话: text(order.phone),
    订单状态: orderStatusLabel(order.order_status),
    付款状态: paymentStatusLabel(order.status),
  };
}

function buildOverviewSheet(orders: YlpOrderExportRow[]): Row[] {
  return orders.map((order) => {
    const items = order.order_items || [];
    const payments = order.payments || [];
    const approved = payments.filter((payment) => payment.status === "approved");
    const paid = approved.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
    // 合并付款一笔覆盖多张订单，会原样挂在每张订单下 —— 「已核准收款」那一列因此不能直接跨行加总，
    // 这里显式标出来，别让对账的人默默把同一笔算两次。
    const merged = approved.some((payment) => (payment.order_ids || []).length > 1);
    return {
      单号: order.id,
      订单状态: orderStatusLabel(order.order_status),
      付款状态: paymentStatusLabel(order.status),
      功德主: text(order.customer_name) || text(order.name),
      联络人: text(order.name),
      电话: text(order.phone),
      Email: text(order.email),
      版本: text(order.version),
      牌位数: items.length,
      "总额 (RM)": Number(order.total_amount ?? 0),
      "已核准收款 (RM)": paid,
      含合并付款: merged ? "是" : "",
      付款笔数: payments.length,
      维护人: text(order.maintainer_name),
      创建时间: text(order.created_at),
    };
  });
}

/** 一行明细 = 一张牌位；序号固定是它在整张订单里的位置，分类表筛过之后也不会变。 */
type ItemEntry = { order: YlpOrderExportRow; item: YlpOrderItem; index: number };

function itemEntries(orders: YlpOrderExportRow[]): ItemEntry[] {
  return orders.flatMap((order) =>
    (order.order_items || []).map((item, index) => ({ order, item, index }))
  );
}

function buildItemRows(entries: ItemEntry[], keys: string[], labelFor: (key: string) => string): Row[] {
  return entries.map(({ order, item, index }) => {
    const row: Row = {
      ...orderColumns(order),
      序号: index + 1,
      类型代码: text(item.code),
      类型名称: text(item.item_name) || titleForCode(text(item.code)),
      "金额 (RM)": itemPrice(item),
    };
    keys.forEach((key) => {
      row[labelFor(key)] = fieldValue(item, key);
    });
    row["创建时间"] = text(order.created_at);
    return row;
  });
}

function buildCategorySummary(orders: YlpOrderExportRow[]): Row[] {
  const buckets = new Map<string, { name: string; count: number; amount: number; orders: Set<number> }>();
  itemEntries(orders).forEach(({ order, item }) => {
    const code = itemCode(item);
    const bucket = buckets.get(code) || {
      name: text(item.item_name) || titleForCode(code),
      count: 0,
      amount: 0,
      orders: new Set<number>(),
    };
    bucket.count += 1;
    bucket.amount += itemPrice(item);
    bucket.orders.add(order.id);
    buckets.set(code, bucket);
  });

  const rows: Row[] = sortCodes(Array.from(buckets.keys())).map((code) => {
    const bucket = buckets.get(code)!;
    return {
      类型代码: code,
      类型名称: bucket.name,
      张数: bucket.count,
      涉及订单数: bucket.orders.size,
      "金额小计 (RM)": Math.round(bucket.amount * 100) / 100,
    };
  });

  if (rows.length) {
    rows.push({
      类型代码: "合计",
      类型名称: "",
      张数: rows.reduce((sum, row) => sum + Number(row["张数"]), 0),
      涉及订单数: orders.filter((order) => (order.order_items || []).length).length,
      "金额小计 (RM)":
        Math.round(rows.reduce((sum, row) => sum + Number(row["金额小计 (RM)"]), 0) * 100) / 100,
    });
  }
  return rows;
}

function buildPaymentRows(orders: YlpOrderExportRow[]): Row[] {
  const rows: Row[] = [];
  orders.forEach((order) => {
    (order.payments || []).forEach((payment) => {
      rows.push({
        单号: order.id,
        功德主: text(order.customer_name) || text(order.name),
        付款编号: payment.id ?? "",
        "金额 (RM)": Number(payment.amount ?? 0),
        方式: PAYMENT_MODE_LABEL[text(payment.payment_mode).toLowerCase()] || text(payment.payment_mode),
        状态: payment.status ? paymentStatusLabel(payment.status) : "",
        付款人: text(payment.payer_name),
        付款时间: text(payment.paid_at),
        提交时间: text(payment.created_at),
        审核人: text(payment.valid_by),
        覆盖订单: (payment.order_ids || []).length > 1 ? (payment.order_ids || []).join(", ") : "",
        备注: text(payment.note),
      });
    });
  });
  return rows;
}

type SheetSpec = { name: string; rows: Row[]; headers: string[] };

function headersOf(rows: Row[]): string[] {
  const headers: string[] = [];
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (!headers.includes(key)) headers.push(key);
    });
  });
  return headers;
}

function buildSheetSpecs(orders: YlpOrderExportRow[]): SheetSpec[] {
  const nameSheet = sheetNamer();
  const specs: SheetSpec[] = [];

  const push = (name: string, rows: Row[]) => {
    if (!rows.length) return;
    specs.push({ name: nameSheet(name), rows, headers: headersOf(rows) });
  };

  push("订单总览", buildOverviewSheet(orders));

  const entries = itemEntries(orders);
  const allKeys = sortFieldKeys(entries.flatMap(({ item }) => itemFieldKeys(item)));
  push(
    "牌位明细",
    buildItemRows(entries, allKeys, (key) => GENERIC_FIELD_LABEL[key] || key)
  );

  // 每个牌位类型一张表：只列这个类型真正用得上的栏位，抬头用该类型的说法
  // （A3/B3 的 father/mother 是「阳上 父／母」，不是显考／显妣）。
  const byCode = new Map<string, ItemEntry[]>();
  entries.forEach((entry) => {
    const code = itemCode(entry.item);
    byCode.set(code, [...(byCode.get(code) || []), entry]);
  });

  sortCodes(Array.from(byCode.keys())).forEach((code) => {
    const scoped = byCode.get(code) || [];
    const keys = sortFieldKeys(scoped.flatMap(({ item }) => itemFieldKeys(item)));
    push(`${code} ${titleForCode(code)}`, buildItemRows(scoped, keys, (key) => categoryFieldLabel(key, code)));
  });

  push("分类汇总", buildCategorySummary(orders));
  push("付款记录", buildPaymentRows(orders));

  return specs;
}

/** 把导出的订单打包成多工作表 xlsx（总览 / 牌位明细 / 每个类型一张 / 分类汇总 / 付款记录）。 */
export async function buildYlpOrdersWorkbookBlob(orders: YlpOrderExportRow[]): Promise<Blob> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  buildSheetSpecs(orders).forEach((spec) => {
    const sheet = XLSX.utils.json_to_sheet(spec.rows, { header: spec.headers });
    sheet["!cols"] = columnWidths(spec.headers, spec.rows);
    XLSX.utils.book_append_sheet(workbook, sheet, spec.name);
  });
  const workbookArray = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new Blob([workbookArray], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
