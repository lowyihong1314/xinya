import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { openOverlay } from "../../app/OverlayProvider";
import { CodeScanner } from "./CodeScanner";
import { ensureDesignTokens } from "../../theme/designTokens";
import { fetchYlpPrintScope } from "./api";
import type { YlpPrintScopeItem } from "./api";
import { orderStatusLabel } from "./orderStatus";

// 「打印牌位 PLUS」的弹窗。四种取件方式 + 两道过滤：
//
//   整个版本   —— 默认：这个版本下全部订单，状态一概不筛（草稿 / 已取消都在里面）
//   按勾选     —— 列表里勾中的订单（老行为）
//   按订单单号 —— 直接贴一串订单号，跳过勾选
//   按牌位单号 —— 贴条码号重印，单号原样复用，不会重新发号
//
//   订单状态清单：默认全打勾（等同于改动前的「全印」），不要的自己取消
//   只印未注册的：跳过已经注册过条码的牌位，专治「补印漏掉的那几张」
//
// 张数不是前端猜的：每次输入变化都问后端 /api/print_paiwei/scope，
// 拿到的 item 清单原样提交回去打印，弹窗上看到几张就印几张。

export type PrintPlusResult = {
  /** 实际要打印的牌位类型。没指定类型时是 "all"（三种一起印）——
   *  必须由弹窗回传，调用方那边的 template 可能是 null，直接发给后端会被判「无效的牌位类型」。 */
  template: string;
  orderIds: number[];
  itemIds: number[];
  pdfIds: number[];
  needBarcode: boolean;
};

export const PRINT_TEMPLATE_LABELS: Record<string, string> = {
  paiwei_1: "大牌位",
  paiwei_5: "小牌位",
  paiwei_10: "冤亲债主",
  // 不选类型：后端把三种牌位一次印完合成一份 PDF
  all: "牌位",
};

type Mode = "version" | "selection" | "orders" | "pdfs";

const MODE_TABS: { key: Mode; label: string }[] = [
  { key: "version", label: "整个版本" },
  { key: "selection", label: "按勾选" },
  { key: "orders", label: "按订单单号" },
  { key: "pdfs", label: "按牌位单号" },
];

// 直接输单号的两种方式：不依赖列表勾选，也不用先挑牌位类型。
// 工具栏那个常驻按钮进来就只有这两个。
const ID_ONLY_MODES: Mode[] = ["orders", "pdfs"];

/** 支持逗号 / 空格 / 换行 / 顿号分隔，以及 1100-1105 这种区间；#123 的井号自动去掉。 */
export function parseIdInput(raw: string): { ids: number[]; invalid: string[] } {
  const ids: number[] = [];
  const invalid: string[] = [];

  String(raw || "")
    .split(/[\s,，、;；]+/)
    .map((token) => token.trim().replace(/^#/, ""))
    .filter(Boolean)
    .forEach((token) => {
      const range = token.match(/^(\d+)\s*[-~]\s*(\d+)$/);
      if (range) {
        const from = Number(range[1]);
        const to = Number(range[2]);
        // 区间给反了也认（1105-1100），但别让一个手滑的 1-999999 把浏览器撑爆。
        const [start, end] = from <= to ? [from, to] : [to, from];
        if (end - start > 2000) {
          invalid.push(token);
          return;
        }
        for (let value = start; value <= end; value += 1) {
          ids.push(value);
        }
        return;
      }
      if (/^\d+$/.test(token)) {
        ids.push(Number(token));
        return;
      }
      invalid.push(token);
    });

  return { ids: Array.from(new Set(ids)), invalid };
}

type StatusGroup = {
  status: string;
  label: string;
  orderIds: Set<number>;
  total: number;
  unregistered: number;
};

function groupByStatus(items: YlpPrintScopeItem[]): StatusGroup[] {
  const groups = new Map<string, StatusGroup>();

  items.forEach((item) => {
    const status = String(item.order_status || "").trim() || "Draft";
    const group = groups.get(status) || {
      status,
      label: orderStatusLabel(status),
      orderIds: new Set<number>(),
      total: 0,
      unregistered: 0,
    };
    group.orderIds.add(item.order_id);
    group.total += 1;
    if (item.pdf_id == null) {
      group.unregistered += 1;
    }
    groups.set(status, group);
  });

  return Array.from(groups.values()).sort(
    (a, b) => b.total - a.total || a.status.localeCompare(b.status),
  );
}

function statusTone(status: string): CSSProperties {
  const normalized = status.toLowerCase();
  if (normalized === "cancel" || normalized === "cancelled" || normalized === "canceled" || normalized === "delete") {
    return { background: "var(--x-color-danger-soft)", color: "var(--x-color-danger)" };
  }
  if (normalized === "paid") {
    return { background: "var(--x-color-success-soft)", color: "var(--x-color-success)" };
  }
  if (normalized === "confirm" || normalized === "confirmed") {
    return { background: "var(--x-color-accent-soft)", color: "var(--x-color-accent-strong)" };
  }
  return { background: "var(--x-color-panel-alt)", color: "var(--x-color-ink-muted)" };
}

function PrintPlusDialog({
  template,
  version,
  selectedOrderIds,
  onResolve,
}: {
  /** 传了就只印这一种；不传（工具栏常驻入口）= 三种一起印，也不给「整个版本 / 按勾选」 */
  template: string | null;
  version: string;
  selectedOrderIds: number[];
  onResolve: (result: PrintPlusResult | null) => void;
}) {
  // 没指定类型时只能按单号来 —— 没有列表上下文，「整个版本 / 按勾选」无从谈起
  const idOnly = !template;
  const effectiveTemplate = template || "all";
  const tabs = useMemo(
    () => (idOnly ? MODE_TABS.filter((tab) => ID_ONLY_MODES.includes(tab.key)) : MODE_TABS),
    [idOnly],
  );
  // 默认整个版本：法会要印的本来就是一整年的牌位，勾选只是偶尔的补印场景。
  const [mode, setMode] = useState<Mode>(idOnly ? "orders" : "version");
  const [orderInput, setOrderInput] = useState("");
  const [pdfInput, setPdfInput] = useState("");
  const [onlyUnregistered, setOnlyUnregistered] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);

  // 摄像头扫码往清单里加单号：要补印一叠牌位时，一张张手打太慢
  const [scannerOn, setScannerOn] = useState(false);
  const [justAdded, setJustAdded] = useState<number[]>([]);
  const scanCooldownRef = useRef<Map<string, number>>(new Map());

  const [items, setItems] = useState<YlpPrintScopeItem[]>([]);
  const [emptyOrderIds, setEmptyOrderIds] = useState<number[]>([]);
  const [unknownPdfIds, setUnknownPdfIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const templateLabel = PRINT_TEMPLATE_LABELS[effectiveTemplate] || effectiveTemplate;

  const parsedOrders = useMemo(() => parseIdInput(orderInput), [orderInput]);
  const parsedPdfs = useMemo(() => parseIdInput(pdfInput), [pdfInput]);

  const queryVersion = mode === "version" ? version : "";
  const queryOrderIds = mode === "selection" ? selectedOrderIds : mode === "orders" ? parsedOrders.ids : [];
  const queryPdfIds = mode === "pdfs" ? parsedPdfs.ids : [];
  // effect 依赖用字符串，免得每次 render 生成的新数组把请求打成死循环。
  const queryKey = `${mode}|${queryVersion}|${queryOrderIds.join(",")}|${queryPdfIds.join(",")}`;

  const reload = useCallback(async () => {
    if (!queryVersion && !queryOrderIds.length && !queryPdfIds.length) {
      setItems([]);
      setEmptyOrderIds([]);
      setUnknownPdfIds([]);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetchYlpPrintScope({
        template: effectiveTemplate,
        version: queryVersion,
        orderIds: queryOrderIds,
        pdfIds: queryPdfIds,
      });
      setItems(res.data?.items || []);
      setEmptyOrderIds(res.data?.empty_order_ids || []);
      setUnknownPdfIds(res.data?.unknown_pdf_ids || []);
    } catch (err) {
      setItems([]);
      setError(err instanceof Error ? err.message : "读取失败");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, effectiveTemplate]);

  useEffect(() => {
    // 手打单号时防抖，别每敲一个数字就发一次请求。
    const delay = mode === "selection" || mode === "version" ? 0 : 350;
    const timer = window.setTimeout(() => void reload(), delay);
    return () => window.clearTimeout(timer);
  }, [reload, mode]);

  const groups = useMemo(() => groupByStatus(items), [items]);

  // 状态清单默认全打勾：excluded 记「被取消掉的」，新出现的状态自动是勾上的。
  const activeGroups = useMemo(
    () => groups.filter((group) => !excluded.includes(group.status)),
    [groups, excluded],
  );

  const picked = useMemo(() => {
    const allowed = new Set(activeGroups.map((group) => group.status));
    return items.filter((item) => {
      const status = String(item.order_status || "").trim() || "Draft";
      if (!allowed.has(status)) {
        return false;
      }
      return !onlyUnregistered || item.pdf_id == null;
    });
  }, [items, activeGroups, onlyUnregistered]);

  const pickedOrderIds = useMemo(
    () => Array.from(new Set(picked.map((item) => item.order_id))),
    [picked],
  );
  const registeredCount = useMemo(() => items.filter((item) => item.pdf_id != null).length, [items]);

  // 重印是按「页」走的：模式三提交牌位单号，后端逐页渲染，单号才不会重新发。
  const reprintPdfIds = useMemo(() => {
    if (mode !== "pdfs") {
      return [];
    }
    const found = new Set(items.map((item) => item.pdf_id).filter((id): id is number => id != null));
    return parsedPdfs.ids.filter((id) => found.has(id));
  }, [mode, items, parsedPdfs.ids]);

  const allChecked = !excluded.length;
  const sheets = mode === "pdfs" ? items.length : picked.length;
  const disabled = loading || sheets === 0;

  /** 扫到一个码：取数字当牌位单号，去重后追加到输入框。
   *  同一个码 2 秒内不重复处理 —— 镜头不移开会一直扫到它。 */
  const addScannedCode = useCallback((raw: string) => {
    const digits = raw.match(/\d+/)?.[0];
    if (!digits) {
      return;
    }
    const now = Date.now();
    if (now - (scanCooldownRef.current.get(digits) || 0) < 2000) {
      return;
    }
    scanCooldownRef.current.set(digits, now);
    const value = Number(digits);
    setPdfInput((current) => {
      const existing = new Set(parseIdInput(current).ids);
      if (existing.has(value)) {
        // 已经在清单里了，闪一下让人知道扫到的是重复的
        setJustAdded((list) => [value, ...list.filter((one) => one !== value)].slice(0, 6));
        return current;
      }
      setJustAdded((list) => [value, ...list.filter((one) => one !== value)].slice(0, 6));
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
      return current.trim() ? `${current.trim()}, ${value}` : String(value);
    });
  }, []);

  function toggleStatus(status: string) {
    setExcluded((current) =>
      current.includes(status) ? current.filter((entry) => entry !== status) : [...current, status],
    );
  }

  function finish(needBarcode: boolean) {
    if (mode === "pdfs") {
      onResolve({ template: effectiveTemplate, orderIds: [], itemIds: [], pdfIds: reprintPdfIds, needBarcode });
      return;
    }
    onResolve({
      template: effectiveTemplate,
      orderIds: pickedOrderIds,
      itemIds: picked.map((item) => item.item_id),
      pdfIds: [],
      needBarcode,
    });
  }

  const inputHint =
    mode === "orders"
      ? "逗号 / 空格 / 换行分隔，支持 1100-1105 这种区间"
      : "牌位上印的条码号，逗号 / 空格 / 换行分隔，支持区间";

  return (
    <div style={styles.overlay} onClick={() => onResolve(null)}>
      <div
        style={styles.panel}
        role="dialog"
        aria-modal="true"
        className="ylp-print-plus-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header style={styles.header}>
          <h3 style={styles.title}>{`打印${templateLabel}`}</h3>
          <p style={styles.message}>
            {mode === "pdfs"
              ? "按牌位上的条码号重印，沿用原来的单号，不会重新发号。"
              : idOnly
                ? "贴订单号就能印，不用先在列表里勾。大／小牌位和冤亲债主会一起印成一份。"
                : "默认全部状态都印。不想印的（例如已取消）在下面取消勾选，张数会跟着变。"}
          </p>
        </header>

        <div style={styles.tabs} role="tablist" className="ylp-print-plus-tabs">
          {tabs.map((tab) => {
            const active = mode === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={active}
                style={{ ...styles.tab, ...(active ? styles.tabActive : null) }}
                onClick={() => setMode(tab.key)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {mode === "version" || mode === "selection" ? (
          <p style={styles.scopeNote}>
            {mode === "version"
              ? `${version || "当前版本"} 全部订单，状态不筛（草稿 / 已取消都在下面，不要的自己取消勾选）`
              : `列表里勾中的 ${selectedOrderIds.length} 张订单`}
          </p>
        ) : (
          <div style={styles.inputWrap}>
            <textarea
              value={mode === "orders" ? orderInput : pdfInput}
              onChange={(event) =>
                mode === "orders" ? setOrderInput(event.target.value) : setPdfInput(event.target.value)
              }
              placeholder={mode === "orders" ? "1023, 1044, 1100-1105" : "87, 88, 152"}
              style={styles.textarea}
              autoFocus={!scannerOn}
              className="ylp-print-plus-input"
            />
            <div style={styles.inputFoot}>
              <p style={styles.inputHint}>{inputHint}</p>
              {mode === "pdfs" ? (
                <button
                  type="button"
                  style={{ ...styles.scanToggle, ...(scannerOn ? styles.scanToggleOn : null) }}
                  onClick={() => setScannerOn((current) => !current)}
                >
                  <i className="fa-solid fa-camera" style={{ marginRight: 6 }} />
                  {scannerOn ? "关掉扫码" : "扫码添加"}
                </button>
              ) : null}
            </div>

            {/* 只在这个 tab 且开着的时候才挂摄像头，切走会自动关掉 */}
            {mode === "pdfs" && scannerOn ? (
              <div style={styles.scannerBox} className="ylp-print-plus-scanner">
                <CodeScanner active onCode={addScannedCode} height="210px" />
                <div style={styles.justAdded}>
                  {justAdded.length ? (
                    justAdded.map((one) => (
                      <span key={one} style={styles.justAddedChip}>
                        #{one}
                      </span>
                    ))
                  ) : (
                    <span style={styles.inputHint}>扫到的单号会自动加进上面的清单，重复的不会加两次</span>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {error ? <p style={styles.error}>{error}</p> : null}

        {mode !== "pdfs" && groups.length ? (
          <>
            <div style={styles.listHead}>
              <span>订单状态</span>
              <button
                type="button"
                style={styles.linkButton}
                onClick={() => setExcluded(allChecked ? groups.map((group) => group.status) : [])}
              >
                {allChecked ? "全部取消" : "全部选上"}
              </button>
            </div>

            <div style={styles.list} className="ylp-print-plus-list">
              {groups.map((group) => {
                const on = !excluded.includes(group.status);
                const shown = onlyUnregistered ? group.unregistered : group.total;
                return (
                  <label key={group.status} style={{ ...styles.row, ...(on ? styles.rowOn : null) }}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleStatus(group.status)}
                      style={styles.checkbox}
                    />
                    <span style={{ ...styles.chip, ...statusTone(group.status) }}>{group.label}</span>
                    <span style={styles.rowMeta}>
                      {`${group.orderIds.size} 单`}
                      <span style={shown ? styles.sheets : styles.sheetsZero}>
                        {shown ? ` · ${shown} 张` : " · 0 张"}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </>
        ) : null}

        {mode !== "pdfs" ? (
          <label style={styles.toggle}>
            <input
              type="checkbox"
              checked={onlyUnregistered}
              onChange={(event) => setOnlyUnregistered(event.target.checked)}
              style={styles.checkbox}
            />
            <span>
              只打印未注册的牌位
              <span style={styles.toggleHint}>
                {registeredCount
                  ? `　跳过已注册的 ${registeredCount} 张`
                  : "　当前范围内没有已注册的"}
              </span>
            </span>
          </label>
        ) : null}

        {emptyOrderIds.length ? (
          <p style={styles.warn}>{`这些订单号没有${templateLabel}（或不存在）：${emptyOrderIds.join(", ")}`}</p>
        ) : null}
        {unknownPdfIds.length ? (
          <p style={styles.warn}>{`查无这些牌位单号：${unknownPdfIds.join(", ")}`}</p>
        ) : null}
        {(mode === "orders" ? parsedOrders.invalid : mode === "pdfs" ? parsedPdfs.invalid : []).length ? (
          <p style={styles.warn}>
            {`看不懂这些输入：${(mode === "orders" ? parsedOrders.invalid : parsedPdfs.invalid).join(", ")}`}
          </p>
        ) : null}

        <p style={styles.summary}>
          {loading
            ? "统计中…"
            : sheets
              ? mode === "pdfs"
                ? `将重印 ${reprintPdfIds.length} 个单号 · 共 ${sheets} 张${templateLabel}`
                : `将打印 ${pickedOrderIds.length} 张订单里的 ${sheets} 张${templateLabel}`
              : "当前范围没有可打印的牌位"}
        </p>

        <p style={styles.hint}>
          注册条码后每张牌位会盖上单号，可在「看板」贴板追踪；不注册则只出图。
        </p>

        <div style={styles.actions}>
          <button type="button" style={styles.secondary} onClick={() => onResolve(null)}>
            取消
          </button>
          <button
            type="button"
            style={{ ...styles.secondary, ...(disabled ? styles.disabledStyle : null) }}
            disabled={disabled}
            onClick={() => finish(false)}
          >
            不注册
          </button>
          <button
            type="button"
            style={{ ...styles.primary, ...(disabled ? styles.disabledStyle : null) }}
            disabled={disabled}
            onClick={() => finish(true)}
          >
            {mode === "pdfs" ? "重印（沿用单号）" : "注册条码"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 点遮罩 / 取消都返回 null，调用方据此中止打印。 */
export function showPrintPlusDialog(selectedOrderIds: number[], template: string | null, version: string) {
  ensureDesignTokens();

  return new Promise<PrintPlusResult | null>((resolve) => {
    openOverlay((close) => (
      <PrintPlusDialog
        template={template}
        version={version}
        selectedOrderIds={selectedOrderIds}
        onResolve={(result) => {
          close();
          resolve(result);
        }}
      />
    ));
  });
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 10000,
    display: "grid",
    placeItems: "center",
    padding: "20px",
    background: "rgba(15, 23, 42, 0.45)",
  },
  panel: {
    width: "min(460px, 100%)",
    maxHeight: "calc(100vh - 40px)",
    overflowY: "auto",
    display: "grid",
    gap: "10px",
    padding: "20px",
    borderRadius: "16px",
    background: "var(--x-color-panel)",
    boxShadow: "0 24px 64px rgba(15, 23, 42, 0.24)",
    color: "var(--x-color-ink)",
    fontFamily: "var(--x-font-sans)",
  },
  header: {
    display: "grid",
    gap: "4px",
  },
  title: {
    margin: 0,
    fontSize: "16px",
    fontWeight: 800,
  },
  message: {
    margin: 0,
    fontSize: "13px",
    lineHeight: 1.6,
    color: "var(--x-color-ink-muted)",
  },
  tabs: {
    display: "flex",
    gap: "6px",
    flexWrap: "wrap",
  },
  tab: {
    flex: "1 1 0",
    padding: "7px 10px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink-muted)",
    fontSize: "13px",
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  tabActive: {
    background: "var(--x-color-accent-tint)",
    borderColor: "var(--x-color-accent-border)",
    color: "var(--x-color-accent-strong)",
  },
  scopeNote: {
    margin: 0,
    padding: "8px 10px",
    borderRadius: "8px",
    background: "var(--x-color-panel-alt)",
    fontSize: "12.5px",
    color: "var(--x-color-ink-muted)",
  },
  inputWrap: {
    display: "grid",
    gap: "4px",
  },
  textarea: {
    width: "100%",
    minHeight: "62px",
    resize: "vertical",
    boxSizing: "border-box",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line)",
    padding: "8px 10px",
    fontSize: "13px",
    fontFamily: "var(--x-font-mono)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
  },
  inputHint: {
    margin: 0,
    fontSize: "11px",
    color: "var(--x-color-ink-muted)",
  },
  inputFoot: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" },
  scanToggle: {
    padding: "5px 12px",
    borderRadius: "999px",
    border: "1px solid var(--x-color-accent-border)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-accent-strong)",
    fontSize: "12.5px",
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  scanToggleOn: { background: "var(--x-color-accent)", color: "#fff", borderColor: "transparent" },
  scannerBox: { display: "grid", gap: "6px" },
  justAdded: { display: "flex", flexWrap: "wrap", gap: "5px", alignItems: "center", minHeight: "22px" },
  justAddedChip: {
    padding: "2px 9px",
    borderRadius: "999px",
    background: "var(--x-color-success-soft)",
    color: "var(--x-color-success)",
    fontSize: "12px",
    fontWeight: 800,
    fontFamily: "var(--x-font-mono)",
  },
  listHead: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.04em",
    color: "var(--x-color-ink-muted)",
  },
  linkButton: {
    border: "none",
    background: "none",
    padding: 0,
    fontSize: "12px",
    fontWeight: 700,
    color: "var(--x-color-accent-strong)",
    cursor: "pointer",
  },
  list: {
    display: "grid",
    gap: "6px",
  },
  row: {
    display: "grid",
    gridTemplateColumns: "auto auto 1fr",
    alignItems: "center",
    gap: "8px",
    padding: "8px 10px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel-alt)",
    cursor: "pointer",
  },
  rowOn: {
    borderColor: "var(--x-color-accent-border)",
    background: "var(--x-color-accent-tint)",
  },
  checkbox: {
    width: "16px",
    height: "16px",
    cursor: "pointer",
    flexShrink: 0,
  },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 9px",
    borderRadius: "6px",
    fontSize: "12px",
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  rowMeta: {
    justifySelf: "end",
    fontSize: "12px",
    color: "var(--x-color-ink)",
    fontFamily: "var(--x-font-mono)",
    whiteSpace: "nowrap",
  },
  sheets: {
    color: "var(--x-color-accent-strong)",
    fontWeight: 700,
  },
  sheetsZero: {
    color: "var(--x-color-ink-muted)",
  },
  toggle: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 10px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel-alt)",
    fontSize: "13px",
    fontWeight: 700,
    cursor: "pointer",
  },
  toggleHint: {
    fontWeight: 400,
    fontSize: "12px",
    color: "var(--x-color-ink-muted)",
  },
  warn: {
    margin: 0,
    fontSize: "12px",
    lineHeight: 1.6,
    color: "var(--x-color-danger)",
    overflowWrap: "anywhere",
  },
  error: {
    margin: 0,
    fontSize: "12.5px",
    color: "var(--x-color-danger)",
  },
  summary: {
    margin: 0,
    padding: "8px 10px",
    borderRadius: "8px",
    background: "var(--x-color-canvas-alt)",
    fontSize: "13px",
    fontWeight: 700,
    color: "var(--x-color-ink)",
  },
  hint: {
    margin: 0,
    fontSize: "12px",
    lineHeight: 1.6,
    color: "var(--x-color-ink-muted)",
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "8px",
    flexWrap: "wrap",
  },
  secondary: {
    border: "1px solid var(--x-color-line)",
    borderRadius: "8px",
    padding: "8px 16px",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontSize: "13.5px",
    fontWeight: 600,
    cursor: "pointer",
  },
  primary: {
    border: "none",
    borderRadius: "8px",
    padding: "8px 16px",
    background: "var(--x-color-accent)",
    color: "#ffffff",
    fontSize: "13.5px",
    fontWeight: 600,
    cursor: "pointer",
  },
  disabledStyle: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
};
