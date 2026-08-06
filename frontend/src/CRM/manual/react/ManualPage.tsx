import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { apiFetch } from "../../../js/apiFetch";
import { useEnsureDesignTokens } from "../../../theme/designTokens";
import { renderMarkdown } from "./markdown";

type ManualDoc = { name: string; title: string };

export function ManualPage() {
  useEnsureDesignTokens();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [docs, setDocs] = useState<ManualDoc[]>([]);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pendingAnchor = useRef<string>("");

  const activeName = searchParams.get("manual_doc") || "";

  // 加载文档目录
  useEffect(() => {
    apiFetch("/api/info/manual", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        const list: ManualDoc[] = data?.docs || [];
        setDocs(list);
        if (!activeName && list.length) {
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set("manual_doc", list[0].name);
            return next;
          });
        }
      })
      .catch(() => setError("加载目录失败"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 加载选中文档内容
  useEffect(() => {
    if (!activeName) return;
    setLoading(true);
    setError("");
    apiFetch(`/api/info/manual/${encodeURIComponent(activeName)}`, { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (data?.status === "success") {
          setContent(String(data.content || ""));
        } else {
          setError(data?.message || "文档不存在");
          setContent("");
        }
      })
      .catch(() => setError("加载文档失败"))
      .finally(() => setLoading(false));
  }, [activeName]);

  const html = useMemo(() => renderMarkdown(content), [content]);

  // 内容渲染后：滚动到锚点或回到顶部
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    const anchor = pendingAnchor.current;
    pendingAnchor.current = "";
    if (anchor) {
      const target = container.querySelector(`[id="${CSS.escape(anchor)}"]`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
    container.scrollTo({ top: 0 });
  }, [html]);

  function selectDoc(name: string, anchor = "") {
    pendingAnchor.current = anchor;
    if (name === activeName) {
      // 同文档内锚点跳转
      const container = contentRef.current;
      const target = anchor && container ? container.querySelector(`[id="${CSS.escape(anchor)}"]`) : null;
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("manual_doc", name);
      return next;
    });
  }

  // 拦截文档内链接：#/ 开头的应用路由直接跳转；.md 之间在应用内切换；外链新标签打开；#锚点滚动
  function handleContentClick(event: MouseEvent<HTMLDivElement>) {
    const anchorEl = (event.target as HTMLElement).closest("a");
    if (!anchorEl) return;
    const href = anchorEl.getAttribute("href") || "";
    if (!href) return;
    if (anchorEl.getAttribute("data-ext") === "1" || /^https?:/i.test(href)) {
      event.preventDefault();
      window.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    // 手册里写「#/crm/finance?...」这类站内路由，点击直接跳到对应页面
    if (href.startsWith("#/") || href.startsWith("/#/")) {
      event.preventDefault();
      navigate(href.slice(href.indexOf("#") + 1));
      return;
    }
    const [file, rawAnchor] = href.split("#");
    const anchor = rawAnchor ? decodeURIComponent(rawAnchor) : "";
    if (file && /\.md$/i.test(file)) {
      event.preventDefault();
      selectDoc(file.replace(/\.md$/i, ""), anchor);
    } else if (!file && anchor) {
      event.preventDefault();
      selectDoc(activeName, anchor);
    }
  }

  return (
    <section style={styles.page}>
      <style>{MANUAL_CSS}</style>
      <aside style={styles.nav}>
        <p style={styles.navTitle}>使用说明</p>
        <div style={styles.navList}>
          {docs.map((doc) => (
            <button
              key={doc.name}
              type="button"
              style={{ ...styles.navItem, ...(doc.name === activeName ? styles.navItemActive : {}) }}
              onClick={() => selectDoc(doc.name)}
            >
              {doc.title}
            </button>
          ))}
        </div>
      </aside>

      <div style={styles.main} ref={contentRef}>
        {loading ? <p style={styles.hint}>加载中…</p> : null}
        {error ? <p style={styles.errorBox}>{error}</p> : null}
        {!loading && !error ? (
          <article className="manual-content" onClick={handleContentClick} dangerouslySetInnerHTML={{ __html: html }} />
        ) : null}
      </div>
    </section>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    display: "flex",
    gap: "18px",
    height: "calc(100vh - 120px)",
    minHeight: "480px",
    fontFamily: "var(--x-font-sans)",
    color: "var(--x-color-ink)",
  },
  nav: {
    width: "240px",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "14px",
    borderRadius: "var(--x-radius-md)",
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-line-soft)",
    overflowY: "auto",
  },
  navTitle: {
    margin: "0 0 4px",
    fontSize: "13px",
    fontWeight: 800,
    letterSpacing: "1px",
    color: "var(--x-color-accent)",
  },
  navList: { display: "flex", flexDirection: "column", gap: "2px" },
  navItem: {
    textAlign: "left",
    padding: "9px 12px",
    borderRadius: "8px",
    border: "none",
    background: "transparent",
    color: "var(--x-color-ink)",
    fontSize: "13.5px",
    cursor: "pointer",
    lineHeight: 1.4,
  },
  navItemActive: {
    background: "var(--x-color-accent-soft)",
    color: "var(--x-color-accent-strong)",
    fontWeight: 700,
  },
  main: {
    flex: 1,
    minWidth: 0,
    overflowY: "auto",
    padding: "8px 28px 60px",
    borderRadius: "var(--x-radius-md)",
    background: "var(--x-color-panel)",
    border: "1px solid var(--x-color-line-soft)",
  },
  hint: { fontSize: "13px", color: "var(--x-color-ink-muted)" },
  errorBox: {
    padding: "10px 14px",
    borderRadius: "8px",
    background: "var(--x-color-danger-soft)",
    color: "var(--x-color-danger)",
    fontSize: "13px",
  },
};

const MANUAL_CSS = `
.manual-content { max-width: 860px; line-height: 1.7; font-size: 14px; }
.manual-content h1 { font-size: 24px; margin: 8px 0 16px; }
.manual-content h2 { font-size: 20px; margin: 26px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--x-color-line-soft); }
.manual-content h3 { font-size: 17px; margin: 22px 0 10px; }
.manual-content h4 { font-size: 15px; margin: 18px 0 8px; color: var(--x-color-ink-muted); }
.manual-content p { margin: 10px 0; }
.manual-content a { color: var(--x-color-accent-strong); text-decoration: none; cursor: pointer; }
.manual-content a:hover { text-decoration: underline; }
.manual-content code { background: var(--x-color-panel-alt); border: 1px solid var(--x-color-line-soft); border-radius: 5px; padding: 1px 5px; font-family: var(--x-font-mono); font-size: 0.9em; }
.manual-content ul, .manual-content ol { margin: 10px 0; padding-left: 22px; }
.manual-content li { margin: 4px 0; }
.manual-content blockquote { margin: 12px 0; padding: 8px 14px; border-left: 3px solid var(--x-color-accent-border); background: var(--x-color-accent-soft); border-radius: 0 8px 8px 0; color: var(--x-color-ink-muted); }
.manual-content hr { border: none; border-top: 1px solid var(--x-color-line); margin: 22px 0; }
.manual-content table { border-collapse: collapse; width: 100%; margin: 14px 0; font-size: 13px; display: block; overflow-x: auto; }
.manual-content th, .manual-content td { border: 1px solid var(--x-color-line); padding: 7px 10px; text-align: left; vertical-align: top; }
.manual-content th { background: var(--x-color-canvas-alt); font-weight: 700; white-space: nowrap; }
`;
