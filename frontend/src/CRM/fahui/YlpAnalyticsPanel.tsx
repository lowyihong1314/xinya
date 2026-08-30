import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { listYlpOrdersForExport } from "./api";
import { PAIWEI_TEMPLATES } from "./intake/paiwei";
import { orderStatusLabel, paymentStatusLabel } from "./orderStatus";
import type { YlpOrderExportPayment, YlpOrderExportRow, YlpOrderItem } from "./types";

// 版本级数据统计。数据源直接复用导出用的 /orders/export（同一份订单 + 牌位 + 付款），
// 不另开后端接口，口径也就和导出的 xlsx 完全一致，对不上账的时候两边可以互相校验。
//
// 两个容易算错的地方，下面的代码都按这个口径来：
//   1. 合并付款一笔覆盖多张订单，后端会把它原样挂在每张订单下 —— 汇总收款必须按付款 id 去重，
//      否则同一笔钱会被算好几次。
//   2. 已取消的订单不算进应收 / 收款率，否则退单越多「未收款」越吓人。

const CURRENCY = new Intl.NumberFormat("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COUNT = new Intl.NumberFormat("en-MY");

/** 连续按天画的上限；超过就退回按月，免得柱子细成头发丝。 */
const MAX_DAILY_BUCKETS = 92;

function money(value: number): string {
  return `RM ${CURRENCY.format(Math.round(value * 100) / 100)}`;
}

function count(value: number): string {
  return COUNT.format(value);
}

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function isCancelled(order: YlpOrderExportRow): boolean {
  const status = text(order.order_status).toLowerCase();
  return status === "cancel" || status === "cancelled" || status === "canceled";
}

function itemPrice(item: YlpOrderItem): number {
  return num(item.price);
}

/** 和列表 / 摘要抽屉的状态配色保持一致：状态永远「颜色 + 文字」成对出现，不靠颜色单独表意。 */
function statusTone(status: string): { fg: string; bg: string } {
  const normalized = status.toLowerCase();
  if (normalized === "approved" || normalized === "paid") {
    return { fg: "var(--x-color-success)", bg: "var(--x-color-success-soft)" };
  }
  if (normalized === "rejected" || normalized === "cancel" || normalized === "cancelled" || normalized === "canceled") {
    return { fg: "var(--x-color-danger)", bg: "var(--x-color-danger-soft)" };
  }
  if (normalized === "none" || normalized === "") {
    return { fg: "var(--x-color-ink-muted)", bg: "var(--x-color-panel-alt)" };
  }
  return { fg: "var(--x-color-warning)", bg: "var(--x-color-warning-soft)" };
}

function templateTitle(code: string): string {
  const template = PAIWEI_TEMPLATES.find((entry) => entry.code === code);
  return template ? template.title : code;
}

/** 已知模板按定义顺序，历史/异常 code 排后面。 */
function templateRank(code: string): number {
  const index = PAIWEI_TEMPLATES.findIndex((entry) => entry.code === code);
  return index === -1 ? PAIWEI_TEMPLATES.length : index;
}

type Bucket = { key: string; label: string; count: number; amount: number; extra?: string };

type TrendPoint = { key: string; orders: number; amount: number };

type Stats = {
  orderCount: number;
  activeCount: number;
  cancelledCount: number;
  itemCount: number;
  receivable: number;
  received: number;
  outstanding: number;
  collectedRate: number;
  avgOrderValue: number;
  avgItemsPerOrder: number;
  orderStatus: Bucket[];
  payStatus: Bucket[];
  categories: Bucket[];
  maintainers: Bucket[];
  payModes: Bucket[];
  trend: TrendPoint[];
  trendUnit: "day" | "month";
  firstCreated: string;
  lastCreated: string;
};

function bucketsToSorted(map: Map<string, Bucket>): Bucket[] {
  return Array.from(map.values()).sort((a, b) => b.count - a.count || b.amount - a.amount);
}

function dayKey(created: string): string {
  return created.slice(0, 10);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** 一律按 UTC 加减：本地时区解析再 toISOString 会把日期倒退一天，循环就永远走不动。 */
function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayDistance(start: string, end: string): number {
  const from = new Date(`${start}T00:00:00Z`).getTime();
  const to = new Date(`${end}T00:00:00Z`).getTime();
  return Math.round((to - from) / 86400000);
}

function buildStats(orders: YlpOrderExportRow[]): Stats {
  const active = orders.filter((order) => !isCancelled(order));

  let itemCount = 0;
  const orderStatus = new Map<string, Bucket>();
  const payStatus = new Map<string, Bucket>();
  const categories = new Map<string, Bucket>();
  const maintainers = new Map<string, Bucket>();
  const payModes = new Map<string, Bucket>();
  const trendMap = new Map<string, TrendPoint>();
  const categoryOrders = new Map<string, Set<number>>();

  // 合并付款按 id 去重；后端没给 id 的（理论上不会有）用行号兜底，至少不会互相吃掉。
  const seenPayments = new Set<string>();
  const uniquePayments: YlpOrderExportPayment[] = [];

  let receivable = 0;
  let firstCreated = "";
  let lastCreated = "";

  orders.forEach((order) => {
    const cancelled = isCancelled(order);
    const amount = num(order.total_amount);
    if (!cancelled) {
      receivable += amount;
    }

    const oStatus = text(order.order_status) || "Draft";
    const oBucket = orderStatus.get(oStatus) || { key: oStatus, label: orderStatusLabel(oStatus), count: 0, amount: 0 };
    oBucket.count += 1;
    oBucket.amount += amount;
    orderStatus.set(oStatus, oBucket);

    const pStatus = text(order.status).toLowerCase() || "none";
    const pBucket = payStatus.get(pStatus) || { key: pStatus, label: paymentStatusLabel(pStatus), count: 0, amount: 0 };
    pBucket.count += 1;
    pBucket.amount += amount;
    payStatus.set(pStatus, pBucket);

    const maintainer = text(order.maintainer_name) || "(未指派)";
    const mBucket = maintainers.get(maintainer) || { key: maintainer, label: maintainer, count: 0, amount: 0 };
    mBucket.count += 1;
    if (!cancelled) {
      mBucket.amount += amount;
    }
    maintainers.set(maintainer, mBucket);

    (order.order_items || []).forEach((item) => {
      itemCount += 1;
      const code = text(item.code) || "(无代码)";
      const cBucket = categories.get(code) || {
        key: code,
        label: text(item.item_name) || templateTitle(code),
        count: 0,
        amount: 0,
      };
      cBucket.count += 1;
      cBucket.amount += itemPrice(item);
      categories.set(code, cBucket);
      const owners = categoryOrders.get(code) || new Set<number>();
      owners.add(order.id);
      categoryOrders.set(code, owners);
    });

    (order.payments || []).forEach((payment, index) => {
      const key = payment.id != null ? `id:${payment.id}` : `row:${order.id}:${index}`;
      if (seenPayments.has(key)) {
        return;
      }
      seenPayments.add(key);
      uniquePayments.push(payment);
    });

    const created = text(order.created_at);
    if (created) {
      if (!firstCreated || created < firstCreated) firstCreated = created;
      if (!lastCreated || created > lastCreated) lastCreated = created;
    }
  });

  let received = 0;
  uniquePayments.forEach((payment) => {
    if (text(payment.status).toLowerCase() !== "approved") {
      return;
    }
    const amount = num(payment.amount);
    received += amount;
    const mode = text(payment.payment_mode).toLowerCase() || "(未填)";
    const label = mode === "bank" ? "银行转账" : mode === "qr" ? "扫码" : mode === "cash" ? "现金" : mode;
    const bucket = payModes.get(mode) || { key: mode, label, count: 0, amount: 0 };
    bucket.count += 1;
    bucket.amount += amount;
    payModes.set(mode, bucket);
  });

  // 趋势：日期跨度短就按天连续铺（空的那天留个 0 柱，看得出断档），跨度长了退回按月。
  const days = orders
    .map((order) => dayKey(text(order.created_at)))
    .filter((day) => ISO_DAY.test(day))
    .sort();
  let trendUnit: "day" | "month" = "day";
  if (days.length) {
    const start = days[0];
    const end = days[days.length - 1];
    const span = dayDistance(start, end);
    trendUnit = span > MAX_DAILY_BUCKETS ? "month" : "day";

    if (trendUnit === "day") {
      // 空的那天也铺一根 0 高的柱子，断档才看得出来；上限兜底，日期脏了也不会转不出来。
      for (let cursor = start, guard = 0; cursor <= end && guard <= MAX_DAILY_BUCKETS; guard += 1) {
        trendMap.set(cursor, { key: cursor, orders: 0, amount: 0 });
        cursor = addDays(cursor, 1);
      }
    }
  }

  orders.forEach((order) => {
    const day = dayKey(text(order.created_at));
    if (!day) {
      return;
    }
    const key = trendUnit === "day" ? day : day.slice(0, 7);
    const point = trendMap.get(key) || { key, orders: 0, amount: 0 };
    point.orders += 1;
    if (!isCancelled(order)) {
      point.amount += num(order.total_amount);
    }
    trendMap.set(key, point);
  });

  const categoryList = Array.from(categories.values())
    .map((bucket) => ({
      ...bucket,
      extra: `${count(categoryOrders.get(bucket.key)?.size || 0)} 张订单`,
    }))
    .sort((a, b) => b.count - a.count || templateRank(a.key) - templateRank(b.key));

  const outstanding = Math.max(0, receivable - received);

  return {
    orderCount: orders.length,
    activeCount: active.length,
    cancelledCount: orders.length - active.length,
    itemCount,
    receivable,
    received,
    outstanding,
    collectedRate: receivable > 0 ? received / receivable : 0,
    avgOrderValue: active.length ? receivable / active.length : 0,
    avgItemsPerOrder: orders.length ? itemCount / orders.length : 0,
    orderStatus: bucketsToSorted(orderStatus),
    payStatus: bucketsToSorted(payStatus),
    categories: categoryList,
    maintainers: bucketsToSorted(maintainers),
    payModes: bucketsToSorted(payModes),
    trend: Array.from(trendMap.values()).sort((a, b) => a.key.localeCompare(b.key)),
    trendUnit,
    firstCreated,
    lastCreated,
  };
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: ReactNode }) {
  return (
    <div style={styles.tile} className="ylp-analytics-tile">
      <p style={styles.tileLabel}>{label}</p>
      <p style={styles.tileValue}>{value}</p>
      {hint ? <p style={styles.tileHint}>{hint}</p> : null}
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section style={styles.card} className="ylp-analytics-card">
      <header style={styles.cardHead}>
        <h4 style={styles.cardTitle}>{title}</h4>
        {hint ? <span style={styles.cardHint}>{hint}</span> : null}
      </header>
      {children}
    </section>
  );
}

/** 排行条：长度表示大小，颜色只有一种（同一个量，不需要靠颜色区分身份）。 */
function BarRows({
  rows,
  emptyText,
  tone,
  valueOf,
  captionOf,
}: {
  rows: Bucket[];
  emptyText: string;
  tone?: (bucket: Bucket) => { fg: string; bg: string };
  valueOf: (bucket: Bucket) => string;
  captionOf?: (bucket: Bucket) => string;
}) {
  const max = rows.reduce((longest, row) => Math.max(longest, row.count), 0);

  if (!rows.length) {
    return <p style={styles.empty}>{emptyText}</p>;
  }

  return (
    <div style={styles.barRows} className="ylp-analytics-bars">
      {rows.map((row) => {
        const palette = tone?.(row);
        const width = max > 0 ? Math.max(2, (row.count / max) * 100) : 0;
        return (
          <div key={row.key} style={styles.barRow} title={`${row.label}：${valueOf(row)}`}>
            <span style={{ ...styles.barLabel, ...(palette ? { color: palette.fg, fontWeight: 700 } : null) }}>
              {row.label}
            </span>
            <span style={styles.barTrack}>
              <span
                style={{
                  ...styles.barFill,
                  width: `${width}%`,
                  background: palette ? palette.fg : "var(--x-color-accent)",
                }}
              />
            </span>
            <span style={styles.barValue}>{valueOf(row)}</span>
            {captionOf ? <span style={styles.barCaption}>{captionOf(row)}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

/** 时间趋势：单序列柱状图，柱底贴基线、顶端 4px 圆角，悬停才出数字，不给每根柱子挂标签。 */
function TrendChart({ points, unit }: { points: TrendPoint[]; unit: "day" | "month" }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = points.reduce((longest, point) => Math.max(longest, point.orders), 0);

  if (!points.length) {
    return <p style={styles.empty}>这个版本还没有订单</p>;
  }

  const active = hover != null ? points[hover] : null;

  return (
    <div style={styles.trendWrap} className="ylp-analytics-trend">
      <div style={styles.trendMeta}>
        <span>{`峰值 ${count(max)} 单`}</span>
        <span style={styles.trendTooltip}>
          {active ? `${active.key}　${count(active.orders)} 单　${money(active.amount)}` : "悬停看当天数字"}
        </span>
      </div>
      <div style={styles.trendPlot} onMouseLeave={() => setHover(null)}>
        {points.map((point, index) => (
          <span
            key={point.key}
            style={styles.trendCol}
            onMouseEnter={() => setHover(index)}
            title={`${point.key}：${count(point.orders)} 单 / ${money(point.amount)}`}
          >
            <span
              style={{
                ...styles.trendBar,
                height: max > 0 ? `${Math.max(point.orders > 0 ? 3 : 0, (point.orders / max) * 100)}%` : "0%",
                background: hover === index ? "var(--x-color-accent-strong)" : "var(--x-color-accent)",
              }}
            />
          </span>
        ))}
      </div>
      <div style={styles.trendAxis}>
        <span>{points[0].key}</span>
        <span>{unit === "day" ? "按天" : "按月"}</span>
        <span>{points[points.length - 1].key}</span>
      </div>
    </div>
  );
}

export function YlpAnalyticsPanel({
  version,
  versions,
  onVersionChange,
}: {
  version: string;
  versions: string[];
  onVersionChange: (version: string) => void;
}) {
  const [orders, setOrders] = useState<YlpOrderExportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loadedAt, setLoadedAt] = useState("");

  const load = useCallback(async () => {
    if (!version) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await listYlpOrdersForExport(version);
      setOrders(response.data?.items || []);
      setLoadedAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
    } catch (err) {
      setOrders([]);
      setError(err instanceof Error ? err.message : "统计数据加载失败");
    } finally {
      setLoading(false);
    }
  }, [version]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => buildStats(orders), [orders]);

  const maintainerRows = useMemo(() => {
    if (stats.maintainers.length <= 8) {
      return stats.maintainers;
    }
    const top = stats.maintainers.slice(0, 8);
    const rest = stats.maintainers.slice(8);
    return [
      ...top,
      {
        key: "__rest__",
        label: `其他 ${rest.length} 人`,
        count: rest.reduce((sum, row) => sum + row.count, 0),
        amount: rest.reduce((sum, row) => sum + row.amount, 0),
      },
    ];
  }, [stats.maintainers]);

  return (
    <div style={styles.panel} className="ylp-analytics">
      <section style={styles.toolbar} className="ylp-analytics-toolbar">
        <select
          value={version}
          onChange={(event) => onVersionChange(event.target.value)}
          style={styles.select}
          className="ylp-analytics-version-select"
        >
          {(versions.length ? versions : [version]).filter(Boolean).map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
        <button type="button" style={styles.refresh} disabled={loading} onClick={() => void load()}>
          {loading ? "统计中…" : "刷新"}
        </button>
        <p style={styles.toolbarNote}>
          {loading
            ? "正在拉取整个版本的订单…"
            : `共 ${count(stats.orderCount)} 张订单${loadedAt ? ` · ${loadedAt} 更新` : ""}`}
        </p>
      </section>

      {error ? <section style={styles.stateCard}>{error}</section> : null}

      {!error && !loading && !stats.orderCount ? (
        <section style={styles.stateCard}>{`${version || "这个版本"} 下还没有订单，没有可统计的数据。`}</section>
      ) : null}

      {!error && stats.orderCount ? (
        <>
          <section style={styles.tiles} className="ylp-analytics-kpis">
            <StatTile
              label="订单数"
              value={count(stats.orderCount)}
              hint={`有效 ${count(stats.activeCount)} · 已取消 ${count(stats.cancelledCount)}`}
            />
            <StatTile
              label="牌位数"
              value={count(stats.itemCount)}
              hint={`平均每单 ${stats.avgItemsPerOrder.toFixed(1)} 张`}
            />
            <StatTile label="应收" value={money(stats.receivable)} hint="不含已取消订单" />
            <StatTile label="已收" value={money(stats.received)} hint="仅已核准，合并付款只算一次" />
            <StatTile
              label="未收"
              value={money(stats.outstanding)}
              hint={`收款率 ${(stats.collectedRate * 100).toFixed(1)}%`}
            />
            <StatTile label="平均单价" value={money(stats.avgOrderValue)} hint="应收 ÷ 有效订单数" />
          </section>

          <section style={styles.grid} className="ylp-analytics-grid">
            <Card title="订单状态" hint="按订单流程状态">
              <BarRows
                rows={stats.orderStatus}
                emptyText="没有订单"
                tone={(bucket) => statusTone(bucket.key)}
                valueOf={(bucket) => `${count(bucket.count)} 单`}
                captionOf={(bucket) => money(bucket.amount)}
              />
            </Card>

            <Card title="付款状态" hint="由付款记录实时汇总">
              <BarRows
                rows={stats.payStatus}
                emptyText="没有订单"
                tone={(bucket) => statusTone(bucket.key)}
                valueOf={(bucket) => `${count(bucket.count)} 单`}
                captionOf={(bucket) => money(bucket.amount)}
              />
            </Card>

            <Card title="付款方式" hint="已核准的付款笔数">
              <BarRows
                rows={stats.payModes}
                emptyText="还没有已核准的付款"
                valueOf={(bucket) => `${count(bucket.count)} 笔`}
                captionOf={(bucket) => money(bucket.amount)}
              />
            </Card>

            <Card title="维护人" hint="订单数 / 应收金额">
              <BarRows
                rows={maintainerRows}
                emptyText="没有维护人记录"
                valueOf={(bucket) => `${count(bucket.count)} 单`}
                captionOf={(bucket) => money(bucket.amount)}
              />
            </Card>

            <div style={styles.wide} className="ylp-analytics-wide">
              <Card title="牌位类型分类汇总" hint="张数 / 金额小计，口径与导出 xlsx 一致">
                <BarRows
                  rows={stats.categories}
                  emptyText="这个版本还没有牌位"
                  valueOf={(bucket) => `${count(bucket.count)} 张`}
                  captionOf={(bucket) => `${money(bucket.amount)} · ${bucket.extra || ""}`}
                />
              </Card>
            </div>

            <div style={styles.wide} className="ylp-analytics-wide">
              <Card
                title="新增订单趋势"
                hint={stats.firstCreated ? `${stats.firstCreated.slice(0, 10)} 起` : undefined}
              >
                <TrendChart points={stats.trend} unit={stats.trendUnit} />
              </Card>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  panel: {
    display: "grid",
    gap: "12px",
    width: "100%",
  },
  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "8px",
    padding: "10px 12px",
    borderRadius: "10px",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel-alt)",
  },
  select: {
    padding: "6px 10px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontSize: "13px",
    fontWeight: 700,
  },
  refresh: {
    padding: "6px 12px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
  },
  toolbarNote: {
    margin: 0,
    marginLeft: "auto",
    fontSize: "12px",
    color: "var(--x-color-ink-muted)",
  },
  stateCard: {
    padding: "16px",
    borderRadius: "10px",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel-alt)",
    color: "var(--x-color-ink-muted)",
    fontSize: "13px",
  },
  tiles: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "8px",
  },
  tile: {
    padding: "12px",
    borderRadius: "10px",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel)",
    display: "grid",
    gap: "2px",
    alignContent: "start",
  },
  tileLabel: {
    margin: 0,
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.04em",
    color: "var(--x-color-ink-muted)",
  },
  tileValue: {
    margin: 0,
    fontSize: "20px",
    fontWeight: 800,
    lineHeight: 1.2,
    color: "var(--x-color-ink)",
    fontFamily: "var(--x-font-mono)",
  },
  tileHint: {
    margin: 0,
    fontSize: "11px",
    color: "var(--x-color-ink-muted)",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: "10px",
    alignItems: "start",
  },
  wide: {
    gridColumn: "1 / -1",
  },
  card: {
    padding: "12px",
    borderRadius: "10px",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel)",
    display: "grid",
    gap: "10px",
    alignContent: "start",
  },
  cardHead: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "8px",
  },
  cardTitle: {
    margin: 0,
    fontSize: "13px",
    fontWeight: 800,
    color: "var(--x-color-ink)",
  },
  cardHint: {
    fontSize: "11px",
    color: "var(--x-color-ink-muted)",
  },
  barRows: {
    display: "grid",
    gap: "8px",
  },
  barRow: {
    display: "grid",
    gridTemplateColumns: "minmax(72px, 34%) 1fr auto",
    alignItems: "center",
    columnGap: "8px",
    rowGap: "2px",
  },
  barLabel: {
    fontSize: "12px",
    color: "var(--x-color-ink)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  barTrack: {
    display: "block",
    height: "10px",
    borderRadius: "4px",
    background: "var(--x-color-canvas-alt)",
    overflow: "hidden",
  },
  barFill: {
    display: "block",
    height: "100%",
    borderRadius: "4px",
    transition: "width 0.2s ease",
  },
  barValue: {
    fontSize: "12px",
    fontWeight: 700,
    fontFamily: "var(--x-font-mono)",
    color: "var(--x-color-ink)",
    whiteSpace: "nowrap",
  },
  barCaption: {
    gridColumn: "2 / -1",
    fontSize: "11px",
    color: "var(--x-color-ink-muted)",
    fontFamily: "var(--x-font-mono)",
  },
  empty: {
    margin: 0,
    fontSize: "12px",
    color: "var(--x-color-ink-muted)",
  },
  trendWrap: {
    display: "grid",
    gap: "6px",
  },
  trendMeta: {
    display: "flex",
    justifyContent: "space-between",
    gap: "8px",
    fontSize: "11px",
    color: "var(--x-color-ink-muted)",
  },
  trendTooltip: {
    fontFamily: "var(--x-font-mono)",
    color: "var(--x-color-ink)",
  },
  trendPlot: {
    display: "flex",
    alignItems: "flex-end",
    gap: "2px",
    height: "140px",
    padding: "0 2px",
    borderBottom: "1px solid var(--x-color-line)",
  },
  trendCol: {
    display: "flex",
    alignItems: "flex-end",
    flex: "1 1 0",
    minWidth: "3px",
    height: "100%",
    cursor: "default",
  },
  trendBar: {
    display: "block",
    width: "100%",
    borderRadius: "4px 4px 0 0",
  },
  trendAxis: {
    display: "flex",
    justifyContent: "space-between",
    gap: "8px",
    fontSize: "11px",
    color: "var(--x-color-ink-muted)",
    fontFamily: "var(--x-font-mono)",
  },
};
