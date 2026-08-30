import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

import { useEnsureDesignTokens } from "../../../theme/designTokens";
import { useUserState } from "../../../app/UserState";
import { showConfirmDialog } from "../../../js/dialogs";
import { downloadBlobOrShare } from "../../../js/browserActions";
import { show_alert } from "../../../js/show_alert";
import {
  copyDiyPaiwei,
  createDiyPaiwei,
  deleteDiyPaiwei,
  diyTemplateImageUrl,
  downloadDiyPaiweiPdf,
  getDiyPaiwei,
  listDiyAnchors,
  listDiyDefaults,
  listDiyFonts,
  listDiyPaiwei,
  listDiyTemplates,
  previewDiyPaiweiPdf,
  updateDiyPaiwei,
} from "./diyApi";
import type { DiyAnchor, DiyElement, DiyFont, DiyPaiweiSummary, DiyTemplate } from "./diyApi";
import { drawPage, elementBox, ensureDiyFont, fromScreenY, snapPosition, toScreenY } from "./diyCanvas";
import type { SnapCandidate } from "./diyCanvas";

// D.I.Y 牌位：法会当天临时加的、或格式特殊的牌位。
//
// 选一张模板底图，自己往上摆文字块 —— 默认竖排（牌位本来就是竖着写的），
// 可以切横排；拖着移动、选中改字、删掉，最后直接出单张 PDF。
//
// 不分版本、不挂订单、不进看板：这里就是「一张纸上哪里写什么字」。
//
// 坐标：state 里存的一律是 PDF 点、左上角原点（和后端同一套，见 diy_paiwei.py），
// 画布上乘 scale 变成像素，反过来除回去。整个文件只有 scale 这一个换算。

const DEFAULT_FONT_SIZE = 28;
const NUDGE_STEP = 2;
const NUDGE_STEP_FAST = 10;

/** 和后端 ALLOWED_COLORS 一致；牌位基本都是黑字，其余几个是给朱笔那类特殊写法留的。 */
const COLOR_CHOICES = [
  { value: "#000000", label: "黑" },
  { value: "#8b0000", label: "朱红" },
  { value: "#c2410c", label: "橙" },
  { value: "#1d4ed8", label: "蓝" },
];

function newElementId() {
  return `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function makeElement(x: number, y: number, fontId: string): DiyElement {
  return {
    id: newElementId(),
    text: "新文字",
    x: Math.round(x),
    y: Math.round(y),
    font_size: DEFAULT_FONT_SIZE,
    spacing: Math.round(DEFAULT_FONT_SIZE * 1.15),
    vertical: true,
    font: fontId,
    bold: false,
    color: "#000000",
  };
}

export function DiyPaiweiPage() {
  useEnsureDesignTokens();
  const { isMobile } = useUserState();

  const [templates, setTemplates] = useState<DiyTemplate[]>([]);
  const [fonts, setFonts] = useState<DiyFont[]>([]);
  const [items, setItems] = useState<DiyPaiweiSummary[]>([]);
  const [query, setQuery] = useState("");
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");

  // null = 在列表页；否则在编辑页（id 为 null 表示新建还没存过）
  const [editing, setEditing] = useState<{
    id: number | null;
    title: string;
    note: string;
    sourceName: string;
    elements: DiyElement[];
  } | null>(null);

  const loadList = useCallback(async (keyword: string) => {
    setListLoading(true);
    setListError("");
    try {
      const res = await listDiyPaiwei(keyword);
      setItems(res.data?.items || []);
    } catch (err) {
      setItems([]);
      setListError(err instanceof Error ? err.message : "读取失败");
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    listDiyTemplates()
      .then((res) => setTemplates(res.data || []))
      .catch(() => setTemplates([]));
    listDiyFonts()
      .then((res) => setFonts(res.data || []))
      .catch(() => setFonts([]));
  }, []);

  useEffect(() => {
    if (editing) {
      return;
    }
    const timer = window.setTimeout(() => void loadList(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query, editing, loadList]);

  async function startCreate() {
    const sourceName = templates[0]?.source_name || "paiwei_1";
    // 新建就先把「佛力超度 / 阳上 / 拜荐 / 莲位」摆到正常牌位的位置上，
    // 冤亲债主那张还多一个中心主文。开局就是能直接打印的一张，只差填人名。
    let elements: DiyElement[] = [];
    try {
      elements = (await listDiyDefaults(sourceName)).data || [];
    } catch {
      elements = [];
    }
    setEditing({ id: null, title: "", note: "", sourceName, elements });
  }

  async function startEdit(id: number) {
    try {
      const res = await getDiyPaiwei(id);
      const detail = res.data;
      if (!detail) {
        show_alert("error", "找不到这张牌位");
        return;
      }
      setEditing({
        id: detail.id,
        title: detail.title,
        note: detail.note,
        sourceName: detail.source_name,
        elements: detail.elements || [],
      });
    } catch (err) {
      show_alert("error", err instanceof Error ? err.message : "打开失败");
    }
  }

  async function handleDelete(row: DiyPaiweiSummary) {
    const confirmed = await showConfirmDialog({
      title: "删除 D.I.Y 牌位",
      message: `确认删除「${row.title || "未命名牌位"}」？删了就没了，没有回收站。`,
      tone: "danger",
      confirmText: "删除",
    });
    if (!confirmed) {
      return;
    }
    try {
      await deleteDiyPaiwei(row.id);
      void loadList(query.trim());
    } catch (err) {
      show_alert("error", err instanceof Error ? err.message : "删除失败");
    }
  }

  async function handleCopy(row: DiyPaiweiSummary) {
    try {
      await copyDiyPaiwei(row.id);
      void loadList(query.trim());
    } catch (err) {
      show_alert("error", err instanceof Error ? err.message : "复制失败");
    }
  }

  async function handlePrint(row: DiyPaiweiSummary) {
    try {
      const blob = await downloadDiyPaiweiPdf(row.id);
      await downloadBlobOrShare(blob, `${row.title || "diy_paiwei"}.pdf`, { isMobile });
    } catch (err) {
      show_alert("error", err instanceof Error ? err.message : "生成 PDF 失败");
    }
  }

  const templateLabel = useCallback(
    (sourceName: string) => templates.find((t) => t.source_name === sourceName)?.label || sourceName,
    [templates],
  );

  if (editing) {
    return (
      <DiyEditor
        key={editing.id ?? "new"}
        templates={templates}
        fonts={fonts}
        initial={editing}
        isMobile={isMobile}
        onClose={() => {
          setEditing(null);
          void loadList(query.trim());
        }}
      />
    );
  }

  return (
    <section style={styles.page} className="diy-paiwei-page">
      <header style={styles.bar} className="diy-paiwei-bar">
        <div>
          <p style={styles.eyebrow}>YLP</p>
          <h2 style={styles.title}>D.I.Y 牌位</h2>
          <p style={styles.hint}>
            当天临时加的牌位、或者格式特殊套不进模板的，在这里自己排版直接出单张 PDF。不分版本，也不进看板。
          </p>
        </div>
        <button type="button" style={styles.primaryButton} onClick={() => void startCreate()}>
          + 新建牌位
        </button>
      </header>

      <div style={styles.toolbar} className="diy-paiwei-toolbar">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索标题 / 备注"
          style={styles.input}
        />
        <span style={styles.count}>{`共 ${items.length} 张`}</span>
      </div>

      {listError ? <section style={styles.stateCard}>{listError}</section> : null}
      {listLoading ? <section style={styles.stateCard}>加载中…</section> : null}

      {!listLoading && !listError && !items.length ? (
        <section style={styles.stateCard}>还没有 D.I.Y 牌位，点右上角「+ 新建牌位」开始。</section>
      ) : null}

      {!listLoading && items.length ? (
        <div style={styles.tableWrap} className="diy-paiwei-table-wrap">
          <table style={styles.table} className="diy-paiwei-table">
            <thead>
              <tr>
                <th style={styles.th}>标题</th>
                <th style={styles.th}>模板</th>
                <th style={styles.th}>文字块</th>
                <th style={styles.th}>更新时间</th>
                <th style={{ ...styles.th, textAlign: "right" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} style={styles.tr}>
                  <td style={styles.td}>
                    <button type="button" style={styles.linkTitle} onClick={() => void startEdit(row.id)}>
                      {row.title || "未命名牌位"}
                    </button>
                    {row.note ? <p style={styles.noteText}>{row.note}</p> : null}
                  </td>
                  <td style={styles.td}>
                    <span style={styles.chip}>{templateLabel(row.source_name)}</span>
                  </td>
                  <td style={{ ...styles.td, fontFamily: "var(--x-font-mono)" }}>{row.element_count}</td>
                  <td style={{ ...styles.td, fontFamily: "var(--x-font-mono)", fontSize: "12px" }}>
                    {row.updated_at || row.created_at || "-"}
                  </td>
                  <td style={{ ...styles.td, textAlign: "right" }}>
                    <div style={styles.rowActions}>
                      <button type="button" style={styles.smallButton} onClick={() => void startEdit(row.id)}>
                        编辑
                      </button>
                      <button type="button" style={styles.smallButton} onClick={() => void handlePrint(row)}>
                        打印
                      </button>
                      <button type="button" style={styles.smallButton} onClick={() => void handleCopy(row)}>
                        复制
                      </button>
                      <button type="button" style={styles.smallDanger} onClick={() => void handleDelete(row)}>
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

/** 常用词：牌位上反复要写的那几句，点一下就落一块，省得每次手打。
 *  和 print_generator.py 里正常牌位画的固定字一致。 */
const PRESET_TEXTS = [
  "佛力超度",
  "拜荐",
  "莲位",
  "阳上",
  "显考",
  "显妣",
  "祖考",
  "祖妣",
  "冤亲债主",
  "门堂上历代祖先",
  "无缘子女",
];

function DiyEditor({
  templates,
  fonts,
  initial,
  isMobile,
  onClose,
}: {
  templates: DiyTemplate[];
  fonts: DiyFont[];
  initial: { id: number | null; title: string; note: string; sourceName: string; elements: DiyElement[] };
  isMobile: boolean;
  onClose: () => void;
}) {
  const [id, setId] = useState<number | null>(initial.id);
  const [title, setTitle] = useState(initial.title);
  const [note, setNote] = useState(initial.note);
  const [sourceName, setSourceName] = useState(initial.sourceName);
  const [elements, setElements] = useState<DiyElement[]>(initial.elements);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [fontTick, setFontTick] = useState(0);
  const [fontLoading, setFontLoading] = useState(false);
  const [anchors, setAnchors] = useState<DiyAnchor[]>([]);
  const [snapOn, setSnapOn] = useState(true);
  const [snapHint, setSnapHint] = useState<{ x: SnapCandidate | null; y: SnapCandidate | null }>({ x: null, y: null });
  const [anchorListOpen, setAnchorListOpen] = useState(false);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const measureRef = useRef<CanvasRenderingContext2D | null>(null);
  const [background, setBackground] = useState<HTMLImageElement | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  // 拖动状态放 ref：每帧 setState 会把 pointermove 拖卡
  const dragRef = useRef<{ id: string; startX: number; startY: number; originX: number; originY: number } | null>(null);

  const template = useMemo(
    () => templates.find((entry) => entry.source_name === sourceName) || templates[0],
    [templates, sourceName],
  );
  const pageWidth = template?.width || 595.5;
  const pageHeight = template?.height || 842.2;
  // 底图 MediaBox 的下边距：画布补上它才和印出来的位置一致（见 diyCanvas.ts 顶部说明）
  const offsetY = template?.offset_y || 0;

  // 关键：宽和高都要塞得下 —— 取两个方向缩放比里小的那个，画布永远不超出一屏。
  const scale = useMemo(() => {
    if (!viewport.width || !viewport.height) {
      return 0;
    }
    return Math.min(viewport.width / pageWidth, viewport.height / pageHeight);
  }, [viewport, pageWidth, pageHeight]);

  const selected = useMemo(
    () => elements.find((element) => element.id === selectedId) || null,
    [elements, selectedId],
  );

  const defaultFont = fonts[0]?.id || "kai";

  if (!measureRef.current && typeof document !== "undefined") {
    measureRef.current = document.createElement("canvas").getContext("2d");
  }

  // 可视区域：容器宽度 + 从容器顶边到窗口底边的剩余高度。
  // 容器高度是我们自己写死的，所以它的 top 不会随画布大小变，不存在测量回环。
  useEffect(() => {
    function measure() {
      const node = wrapRef.current;
      if (!node) {
        return;
      }
      const rect = node.getBoundingClientRect();
      setViewport({
        width: Math.max(120, node.clientWidth - 8),
        height: Math.max(280, window.innerHeight - rect.top - 16),
      });
    }
    measure();
    window.addEventListener("resize", measure);
    const observer = new ResizeObserver(measure);
    if (wrapRef.current) {
      observer.observe(wrapRef.current);
    }
    return () => {
      window.removeEventListener("resize", measure);
      observer.disconnect();
    };
  }, [sourceName, isMobile]);

  // 正常牌位每个字段的位置，吸附和「一键落位」都靠它
  useEffect(() => {
    let cancelled = false;
    listDiyAnchors(sourceName)
      .then((res) => {
        if (!cancelled) setAnchors(res.data || []);
      })
      .catch(() => {
        if (!cancelled) setAnchors([]);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceName]);

  // 底图
  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) setBackground(image);
    };
    image.onerror = () => {
      if (!cancelled) setBackground(null);
    };
    image.src = diyTemplateImageUrl(sourceName);
    return () => {
      cancelled = true;
    };
  }, [sourceName]);

  // 用到的字体一个个加载好再重画，画布上的字形才和 PDF 一致
  useEffect(() => {
    const wanted = new Set(elements.map((element) => element.font || defaultFont));
    const pending = Array.from(wanted).filter((fontId) => fonts.find((f) => f.id === fontId)?.web);
    if (!pending.length) {
      return;
    }
    let cancelled = false;
    setFontLoading(true);
    void Promise.all(pending.map((fontId) => ensureDiyFont(fontId, true))).then(() => {
      if (!cancelled) {
        setFontLoading(false);
        setFontTick((tick) => tick + 1);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [elements, fonts, defaultFont]);

  // 重画：任何一个输入变了就整张重画，画布本来就便宜
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !scale) {
      return;
    }
    drawPage({ canvas, background, elements, pageWidth, pageHeight, scale, offsetY });
  }, [background, elements, pageWidth, pageHeight, scale, offsetY, fontTick]);

  const boxes = useMemo(
    () => elements.map((element) => ({ element, box: elementBox(measureRef.current, element) })),
    [elements, fontTick],
  );

  // 吸附候选：正常牌位的锚点 + 其他字块的边 + 页面中线。
  // x / y 分开算，只对齐一个方向（几块字左边对齐）比整点吸附更常用。
  const snapCandidates = useMemo(() => {
    const xs: SnapCandidate[] = [];
    const ys: SnapCandidate[] = [];
    anchors.forEach((anchor) => {
      xs.push({ value: anchor.x, label: anchor.label });
      ys.push({ value: anchor.y, label: anchor.label });
    });
    elements.forEach((element) => {
      if (element.id === selectedId) {
        return;
      }
      const text = element.text.slice(0, 4);
      xs.push({ value: element.x, label: `对齐「${text}」` });
      ys.push({ value: element.y, label: `对齐「${text}」` });
    });
    xs.push({ value: Math.round(pageWidth / 2), label: "页面中线" });
    ys.push({ value: Math.round(pageHeight / 2), label: "页面中线" });
    return { xs, ys };
  }, [anchors, elements, selectedId, pageWidth, pageHeight]);

  /** 把某一块直接放到锚点上，连字号字距一起套用 —— 不用拖，一点就位。 */
  const applyAnchor = useCallback(
    (anchor: DiyAnchor) => {
      setElements((current) => {
        if (!current.some((element) => element.id === selectedId)) {
          return current;
        }
        return current.map((element) =>
          element.id === selectedId
            ? {
                ...element,
                x: anchor.x,
                y: anchor.y,
                font_size: anchor.font_size,
                spacing: anchor.spacing,
                vertical: true,
              }
            : element,
        );
      });
      setDirty(true);
    },
    [selectedId],
  );

  const patch = useCallback((elementId: string, next: Partial<DiyElement>) => {
    setElements((current) =>
      current.map((element) => (element.id === elementId ? { ...element, ...next } : element)),
    );
    setDirty(true);
  }, []);

  const addElement = useCallback(
    (x: number, y: number, text?: string) => {
      const element = makeElement(x, y, defaultFont);
      if (text) {
        element.text = text;
      }
      setElements((current) => [...current, element]);
      setSelectedId(element.id);
      setDirty(true);
    },
    [defaultFont],
  );

  const removeElement = useCallback((elementId: string) => {
    setElements((current) => current.filter((element) => element.id !== elementId));
    setSelectedId((current) => (current === elementId ? null : current));
    setDirty(true);
  }, []);

  // Delete 删掉选中的，方向键微调（Shift 走大步）。在输入框里打字时不抢键。
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!selectedId) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const tag = (target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeElement(selectedId);
        return;
      }
      const step = event.shiftKey ? NUDGE_STEP_FAST : NUDGE_STEP;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const move = moves[event.key];
      if (move) {
        event.preventDefault();
        setElements((current) =>
          current.map((element) =>
            element.id === selectedId ? { ...element, x: element.x + move[0], y: element.y + move[1] } : element,
          ),
        );
        setDirty(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, removeElement]);

  function onElementPointerDown(event: ReactPointerEvent<HTMLDivElement>, element: DiyElement) {
    event.stopPropagation();
    setSelectedId(element.id);
    if (!scale) {
      return;
    }
    dragRef.current = {
      id: element.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: element.x,
      originY: element.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onElementPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || !scale) {
      return;
    }
    const rawX = drag.originX + (event.clientX - drag.startX) / scale;
    const rawY = drag.originY + (event.clientY - drag.startY) / scale;

    // 按住 Alt 临时关掉吸附 —— 要塞进两个锚点中间的时候用
    let nextX = Math.round(rawX);
    let nextY = Math.round(rawY);
    if (snapOn && !event.altKey) {
      // 容差按屏幕像素给（6px），换算回页面坐标，缩得越小吸得越"远"，手感一致
      const tolerance = 6 / scale;
      const snapped = snapPosition(rawX, rawY, snapCandidates.xs, snapCandidates.ys, tolerance);
      nextX = Math.round(snapped.x);
      nextY = Math.round(snapped.y);
      setSnapHint({ x: snapped.hitX, y: snapped.hitY });
    } else {
      setSnapHint({ x: null, y: null });
    }

    setElements((current) =>
      current.map((element) => (element.id === drag.id ? { ...element, x: nextX, y: nextY } : element)),
    );
  }

  function onElementPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current) {
      dragRef.current = null;
      setDirty(true);
    }
    setSnapHint({ x: null, y: null });
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onStageDoubleClick(event: React.MouseEvent<HTMLDivElement>) {
    if (!scale) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    addElement((event.clientX - rect.left) / scale, fromScreenY(event.clientY - rect.top, scale, offsetY));
  }

  async function handleSave(): Promise<number | null> {
    setSaving(true);
    try {
      const payload = {
        title: title.trim() || "未命名牌位",
        source_name: sourceName,
        note: note.trim(),
        elements,
      };
      if (id == null) {
        const res = await createDiyPaiwei(payload);
        const newId = res.data?.id ?? null;
        setId(newId);
        setDirty(false);
        return newId;
      }
      await updateDiyPaiwei(id, payload);
      setDirty(false);
      return id;
    } catch (err) {
      show_alert("error", err instanceof Error ? err.message : "保存失败");
      return null;
    } finally {
      setSaving(false);
    }
  }

  /** 直接用当前画布内容出 PDF，不强制先存 —— 当天赶时间就是要这个。 */
  async function handlePrint() {
    if (!elements.length) {
      show_alert("error", "还没有任何文字，先双击画布加一块");
      return;
    }
    setPrinting(true);
    try {
      const blob = await previewDiyPaiweiPdf({ source_name: sourceName, elements });
      await downloadBlobOrShare(blob, `${title.trim() || "diy_paiwei"}.pdf`, { isMobile });
    } catch (err) {
      show_alert("error", err instanceof Error ? err.message : "生成 PDF 失败");
    } finally {
      setPrinting(false);
    }
  }

  async function handleBack() {
    if (dirty) {
      const confirmed = await showConfirmDialog({
        title: "还没保存",
        message: "有改动还没保存，确定要离开吗？",
        tone: "danger",
        confirmText: "不保存，离开",
      });
      if (!confirmed) {
        return;
      }
    }
    onClose();
  }

  return (
    <section style={styles.page} className="diy-paiwei-editor">
      <header style={styles.editorBar} className="diy-paiwei-editor-bar">
        <button type="button" style={styles.smallButton} onClick={() => void handleBack()}>
          ← 返回列表
        </button>
        <input
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setDirty(true);
          }}
          placeholder="标题，例如「陈氏 临时超度」"
          style={{ ...styles.input, flex: "1 1 180px", width: "auto" }}
        />
        <select
          value={sourceName}
          onChange={(event) => {
            setSourceName(event.target.value);
            setDirty(true);
          }}
          style={styles.select}
        >
          {templates.map((entry) => (
            <option key={entry.source_name} value={entry.source_name}>
              {entry.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          style={{ ...styles.smallButton, ...(saving ? styles.disabled : null) }}
          disabled={saving}
          onClick={() => void handleSave()}
        >
          {saving ? "保存中…" : dirty ? "保存 *" : "保存"}
        </button>
        <button
          type="button"
          style={{ ...styles.primaryButton, ...(printing ? styles.disabled : null) }}
          disabled={printing}
          onClick={() => void handlePrint()}
        >
          {printing ? "出图中…" : "打印这张"}
        </button>
      </header>

      <div style={styles.presetRow} className="diy-paiwei-presets">
        <span style={styles.presetLabel}>常用词</span>
        {PRESET_TEXTS.map((text) => (
          <button
            key={text}
            type="button"
            style={styles.presetChip}
            onClick={() => addElement(pageWidth / 2 - 14, pageHeight / 4, text)}
          >
            {text}
          </button>
        ))}
      </div>

      <div style={styles.editorBody(isMobile)} className="diy-paiwei-editor-body">
        <div style={styles.canvasColumn}>
          <div style={styles.canvasHintRow}>
            <span style={styles.canvasHint}>
              {`双击加文字 · 拖动移动 · 方向键微调 · Delete 删除　缩放 ${
                scale ? Math.round(scale * 100) : 0
              }%${fontLoading ? "　字体加载中…" : ""}`}
            </span>
            <button
              type="button"
              style={{ ...styles.snapToggle, ...(snapOn ? styles.snapToggleOn : null) }}
              onClick={() => setSnapOn((current) => !current)}
              title="吸附到正常牌位的字段位置、其他字块和页面中线；拖动时按住 Alt 可临时关掉"
            >
              {snapOn ? "吸附 开" : "吸附 关"}
            </button>
            <span style={styles.snapHint}>
              {snapHint.x || snapHint.y
                ? `贴住：${[snapHint.y?.label, snapHint.x?.label].filter(Boolean).join(" / ")}`
                : ""}
            </span>
          </div>
          <div ref={wrapRef} style={{ ...styles.canvasWrap, height: `${viewport.height}px` }}>
            {scale ? (
              <div
                style={{
                  ...styles.stage,
                  width: `${pageWidth * scale}px`,
                  height: `${pageHeight * scale}px`,
                }}
                onPointerDown={() => setSelectedId(null)}
                onDoubleClick={onStageDoubleClick}
                className="diy-paiwei-canvas"
              >
                <canvas ref={canvasRef} style={styles.canvasEl} />
                {snapHint.x ? (
                  <div style={{ ...styles.guideV, left: `${snapHint.x.value * scale}px` }} />
                ) : null}
                {snapHint.y ? (
                  <div style={{ ...styles.guideH, top: `${toScreenY(snapHint.y.value, scale, offsetY)}px` }} />
                ) : null}
                {boxes.map(({ element, box }) => (
                  <div
                    key={element.id}
                    style={{
                      ...styles.hit,
                      ...(element.id === selectedId ? styles.hitSelected : null),
                      left: `${box.left * scale}px`,
                      top: `${toScreenY(box.top, scale, offsetY)}px`,
                      width: `${Math.max(box.width * scale, 10)}px`,
                      height: `${Math.max(box.height * scale, 10)}px`,
                    }}
                    onPointerDown={(event) => onElementPointerDown(event, element)}
                    onPointerMove={onElementPointerMove}
                    onPointerUp={onElementPointerUp}
                    onPointerCancel={onElementPointerUp}
                    onDoubleClick={(event) => event.stopPropagation()}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <aside style={styles.sidePanel} className="diy-paiwei-panel">
          <div style={styles.panelHead}>
            <h4 style={styles.panelTitle}>{selected ? "文字块" : "还没选中"}</h4>
            <button
              type="button"
              style={styles.smallButton}
              onClick={() => addElement(pageWidth / 2 - 14, pageHeight / 4)}
            >
              + 添加
            </button>
          </div>

          {selected ? (
            <>
              <label style={styles.field}>
                <span style={styles.fieldLabel}>内容</span>
                <textarea
                  value={selected.text}
                  onChange={(event) => patch(selected.id, { text: event.target.value })}
                  style={styles.textarea}
                  rows={3}
                />
              </label>

              <div style={styles.segment}>
                <button
                  type="button"
                  style={{ ...styles.segmentButton, ...(selected.vertical ? styles.segmentActive : null) }}
                  onClick={() => patch(selected.id, { vertical: true })}
                >
                  竖排
                </button>
                <button
                  type="button"
                  style={{ ...styles.segmentButton, ...(!selected.vertical ? styles.segmentActive : null) }}
                  onClick={() => patch(selected.id, { vertical: false })}
                >
                  横排
                </button>
              </div>

              <label style={styles.field}>
                <span style={styles.fieldLabel}>字体</span>
                <select
                  value={selected.font}
                  onChange={(event) => patch(selected.id, { font: event.target.value })}
                  style={{ ...styles.select, width: "100%" }}
                >
                  {fonts.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.web ? entry.label : `${entry.label}（画布用近似字体）`}
                    </option>
                  ))}
                </select>
              </label>

              <div style={styles.field}>
                <span style={styles.fieldLabel}>字形</span>
                <div style={styles.styleRow}>
                  <button
                    type="button"
                    style={{ ...styles.styleButton, ...(selected.bold ? styles.segmentActive : null) }}
                    onClick={() => patch(selected.id, { bold: !selected.bold })}
                  >
                    <b>加粗</b>
                  </button>
                  {COLOR_CHOICES.map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      title={color.label}
                      aria-label={color.label}
                      style={{
                        ...styles.colorDot,
                        background: color.value,
                        outline:
                          selected.color === color.value ? "2px solid var(--x-color-accent-strong)" : "none",
                      }}
                      onClick={() => patch(selected.id, { color: color.value })}
                    />
                  ))}
                </div>
              </div>

              <div style={styles.fieldRow}>
                <NumberField
                  label="字号"
                  value={selected.font_size}
                  min={6}
                  max={200}
                  onChange={(value) => patch(selected.id, { font_size: value })}
                />
                <NumberField
                  label={selected.vertical ? "字距" : "行距"}
                  value={selected.spacing}
                  min={1}
                  max={400}
                  onChange={(value) => patch(selected.id, { spacing: value })}
                />
              </div>

              <div style={styles.fieldRow}>
                <NumberField
                  label="X"
                  value={selected.x}
                  min={-2000}
                  max={4000}
                  onChange={(value) => patch(selected.id, { x: value })}
                />
                <NumberField
                  label="Y"
                  value={selected.y}
                  min={-2000}
                  max={4000}
                  onChange={(value) => patch(selected.id, { y: value })}
                />
              </div>

              <div style={styles.field}>
                <button
                  type="button"
                  style={styles.smallButton}
                  onClick={() => setAnchorListOpen((current) => !current)}
                >
                  {anchorListOpen ? "收起常用位置" : `一键落位（${anchors.length} 个常用位置）`}
                </button>
                {anchorListOpen ? (
                  <div style={styles.anchorList} className="diy-paiwei-anchors">
                    {anchors.map((anchor) => (
                      <button
                        key={anchor.key}
                        type="button"
                        style={styles.anchorItem}
                        title={`x ${anchor.x} · y ${anchor.y} · 字号 ${anchor.font_size}`}
                        onClick={() => applyAnchor(anchor)}
                      >
                        {anchor.label}
                      </button>
                    ))}
                    {!anchors.length ? <span style={styles.panelHint}>这张模板没有坐标配置</span> : null}
                  </div>
                ) : null}
              </div>

              <button type="button" style={styles.smallDanger} onClick={() => removeElement(selected.id)}>
                删除这一块
              </button>
            </>
          ) : (
            <p style={styles.panelHint}>
              双击画布任意位置加一块文字，或者点上面的「常用词」。选中之后这里可以改内容、字体、字形、字号、字距和坐标。
            </p>
          )}

          <div style={styles.panelDivider} />

          <label style={styles.field}>
            <span style={styles.fieldLabel}>备注（只自己看，不印在牌位上）</span>
            <textarea
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                setDirty(true);
              }}
              style={styles.textarea}
              rows={2}
            />
          </label>

          <p style={styles.panelFoot}>
            {`共 ${elements.length} 块文字 · 页面 ${Math.round(pageWidth)}×${Math.round(pageHeight)} pt`}
          </p>
        </aside>
      </div>
    </section>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      <input
        type="number"
        value={Math.round(value)}
        min={min}
        max={max}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) {
            onChange(Math.max(min, Math.min(max, next)));
          }
        }}
        style={styles.input}
      />
    </label>
  );
}

const styles: Record<string, any> = {
  page: {
    minHeight: "100%",
    display: "grid",
    gap: "10px",
    padding: "12px",
    borderRadius: "10px",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontFamily: '"PingFang SC","Microsoft YaHei",var(--x-font-sans)',
    alignContent: "start",
  } as CSSProperties,
  bar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "12px",
    flexWrap: "wrap",
  } as CSSProperties,
  eyebrow: {
    margin: 0,
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.08em",
    color: "var(--x-color-accent-strong)",
  } as CSSProperties,
  title: { margin: "2px 0 0", fontSize: "20px", fontWeight: 800 } as CSSProperties,
  hint: { margin: "4px 0 0", fontSize: "12.5px", color: "var(--x-color-ink-muted)" } as CSSProperties,
  toolbar: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } as CSSProperties,
  count: { fontSize: "12px", color: "var(--x-color-ink-muted)", marginLeft: "auto" } as CSSProperties,
  input: {
    padding: "7px 10px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontSize: "13px",
    boxSizing: "border-box",
    width: "100%",
  } as CSSProperties,
  select: {
    padding: "7px 10px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontSize: "13px",
    fontWeight: 700,
  } as CSSProperties,
  primaryButton: {
    padding: "8px 14px",
    borderRadius: "8px",
    border: "none",
    background: "var(--x-color-accent)",
    color: "#fff",
    fontSize: "13px",
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  } as CSSProperties,
  smallButton: {
    padding: "6px 10px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  } as CSSProperties,
  smallDanger: {
    padding: "6px 10px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-danger-border)",
    background: "var(--x-color-danger-soft)",
    color: "var(--x-color-danger)",
    fontSize: "12px",
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  } as CSSProperties,
  disabled: { opacity: 0.5, cursor: "not-allowed" } as CSSProperties,
  stateCard: {
    padding: "16px",
    borderRadius: "10px",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel-alt)",
    color: "var(--x-color-ink-muted)",
    fontSize: "13px",
  } as CSSProperties,
  tableWrap: {
    width: "100%",
    overflowX: "auto",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line-soft)",
  } as CSSProperties,
  table: { width: "100%", borderCollapse: "collapse", fontSize: "13px" } as CSSProperties,
  th: {
    textAlign: "left",
    padding: "9px 10px",
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.04em",
    color: "var(--x-color-ink-muted)",
    background: "var(--x-color-canvas-alt)",
    borderBottom: "1px solid var(--x-color-line)",
    whiteSpace: "nowrap",
  } as CSSProperties,
  tr: {} as CSSProperties,
  td: {
    padding: "9px 10px",
    borderBottom: "1px solid var(--x-color-line-soft)",
    verticalAlign: "middle",
  } as CSSProperties,
  linkTitle: {
    border: "none",
    background: "none",
    padding: 0,
    fontSize: "13px",
    fontWeight: 700,
    color: "var(--x-color-accent-strong)",
    cursor: "pointer",
    textAlign: "left",
  } as CSSProperties,
  noteText: { margin: "2px 0 0", fontSize: "11.5px", color: "var(--x-color-ink-muted)" } as CSSProperties,
  chip: {
    display: "inline-flex",
    padding: "3px 9px",
    borderRadius: "6px",
    background: "var(--x-color-accent-tint)",
    color: "var(--x-color-accent-strong)",
    fontSize: "12px",
    fontWeight: 700,
    whiteSpace: "nowrap",
  } as CSSProperties,
  rowActions: { display: "inline-flex", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end" } as CSSProperties,

  editorBar: {
    display: "flex",
    gap: "8px",
    alignItems: "center",
    flexWrap: "wrap",
    padding: "8px 10px",
    borderRadius: "10px",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel-alt)",
  } as CSSProperties,
  editorBody: (isMobile: boolean): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) 260px",
    gap: "12px",
    alignItems: "start",
  }),
  canvasColumn: { display: "grid", gap: "6px", minWidth: 0 } as CSSProperties,
  canvasHint: { margin: 0, fontSize: "11.5px", color: "var(--x-color-ink-muted)" } as CSSProperties,
  // 高度由 JS 算好（窗口剩余高度），画布按宽高里更紧的那一边等比缩放，永远不超出一屏
  canvasWrap: {
    width: "100%",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    overflow: "auto",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-canvas-alt)",
    padding: "4px",
    boxSizing: "border-box",
    touchAction: "none",
  } as CSSProperties,
  stage: { position: "relative", userSelect: "none", flexShrink: 0 } as CSSProperties,
  canvasEl: { display: "block", borderRadius: "2px", boxShadow: "0 2px 10px var(--x-color-shadow-soft)" } as CSSProperties,
  // 画布只负责画；命中/选中框是盖在上面的透明层，拖动、选中都点这里
  hit: {
    position: "absolute",
    cursor: "move",
    border: "1px dashed transparent",
    boxSizing: "content-box",
    marginLeft: "-1px",
    marginTop: "-1px",
  } as CSSProperties,
  hitSelected: {
    border: "1px dashed var(--x-color-accent-strong)",
    background: "rgba(15,118,110,0.12)",
  } as CSSProperties,
  presetRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "5px",
    alignItems: "center",
  } as CSSProperties,
  presetLabel: {
    fontSize: "11px",
    fontWeight: 700,
    color: "var(--x-color-ink-muted)",
    marginRight: "2px",
  } as CSSProperties,
  presetChip: {
    padding: "4px 9px",
    borderRadius: "999px",
    border: "1px solid var(--x-color-accent-border)",
    background: "var(--x-color-accent-tint)",
    color: "var(--x-color-accent-strong)",
    fontSize: "12.5px",
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  } as CSSProperties,
  styleRow: { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } as CSSProperties,
  canvasHintRow: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } as CSSProperties,
  snapToggle: {
    padding: "3px 9px",
    borderRadius: "999px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink-muted)",
    fontSize: "11.5px",
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  } as CSSProperties,
  snapToggleOn: {
    borderColor: "var(--x-color-accent-border)",
    background: "var(--x-color-accent-tint)",
    color: "var(--x-color-accent-strong)",
  } as CSSProperties,
  snapHint: {
    fontSize: "11.5px",
    fontWeight: 700,
    color: "var(--x-color-accent-strong)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } as CSSProperties,
  // 吸附辅助线：贴上去的那一瞬间才出现，松手就没
  guideV: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: "1px",
    background: "var(--x-color-accent-strong)",
    opacity: 0.7,
    pointerEvents: "none",
  } as CSSProperties,
  guideH: {
    position: "absolute",
    left: 0,
    right: 0,
    height: "1px",
    background: "var(--x-color-accent-strong)",
    opacity: 0.7,
    pointerEvents: "none",
  } as CSSProperties,
  anchorList: {
    display: "grid",
    gap: "3px",
    maxHeight: "180px",
    overflowY: "auto",
    padding: "4px",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel)",
  } as CSSProperties,
  anchorItem: {
    textAlign: "left",
    padding: "5px 8px",
    borderRadius: "6px",
    border: "1px solid transparent",
    background: "transparent",
    color: "var(--x-color-ink)",
    fontSize: "12px",
    cursor: "pointer",
  } as CSSProperties,
  styleButton: {
    padding: "5px 10px",
    borderRadius: "6px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontSize: "12px",
    cursor: "pointer",
  } as CSSProperties,
  colorDot: {
    width: "22px",
    height: "22px",
    borderRadius: "50%",
    border: "1px solid var(--x-color-line)",
    cursor: "pointer",
    padding: 0,
    outlineOffset: "2px",
  } as CSSProperties,

  sidePanel: {
    display: "grid",
    gap: "10px",
    padding: "12px",
    borderRadius: "10px",
    border: "1px solid var(--x-color-line-soft)",
    background: "var(--x-color-panel-alt)",
    alignContent: "start",
    position: "sticky",
    top: "12px",
  } as CSSProperties,
  panelHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" } as CSSProperties,
  panelTitle: { margin: 0, fontSize: "13px", fontWeight: 800 } as CSSProperties,
  panelHint: { margin: 0, fontSize: "12px", lineHeight: 1.6, color: "var(--x-color-ink-muted)" } as CSSProperties,
  panelDivider: { height: "1px", background: "var(--x-color-line-soft)" } as CSSProperties,
  panelFoot: { margin: 0, fontSize: "11.5px", color: "var(--x-color-ink-muted)", fontFamily: "var(--x-font-mono)" } as CSSProperties,
  field: { display: "grid", gap: "4px", minWidth: 0 } as CSSProperties,
  fieldRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" } as CSSProperties,
  fieldLabel: { fontSize: "11px", fontWeight: 700, color: "var(--x-color-ink-muted)" } as CSSProperties,
  textarea: {
    width: "100%",
    borderRadius: "8px",
    border: "1px solid var(--x-color-line)",
    padding: "7px 10px",
    fontSize: "13px",
    boxSizing: "border-box",
    resize: "vertical",
    background: "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontFamily: "inherit",
  } as CSSProperties,
  segment: {
    display: "flex",
    gap: "4px",
    padding: "3px",
    borderRadius: "8px",
    background: "var(--x-color-canvas-alt)",
  } as CSSProperties,
  segmentButton: {
    flex: 1,
    padding: "6px 8px",
    borderRadius: "6px",
    border: "1px solid transparent",
    background: "transparent",
    color: "var(--x-color-ink-muted)",
    fontSize: "12.5px",
    fontWeight: 700,
    cursor: "pointer",
  } as CSSProperties,
  segmentActive: {
    background: "var(--x-color-panel)",
    borderColor: "var(--x-color-line)",
    color: "var(--x-color-accent-strong)",
  } as CSSProperties,
};
