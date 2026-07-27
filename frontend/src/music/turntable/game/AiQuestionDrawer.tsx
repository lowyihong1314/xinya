import { useEffect, useState } from "react";
import type { CSSProperties } from "react";

import { generateQuestionsWithAI } from "./api";
import { OPTION_COLORS, OPTION_SHAPES } from "./types";
import type { QuizGameQuestion } from "./types";

type Draft = { q: QuizGameQuestion; selected: boolean };

export function AiQuestionDrawer({
  open,
  onClose,
  setTitle,
  onInsert,
}: {
  open: boolean;
  onClose: () => void;
  setTitle: string;
  onInsert: (questions: QuizGameQuestion[]) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function handleGenerate() {
    if (!prompt.trim()) {
      setError("请先输入出题要求");
      return;
    }
    setLoading(true);
    setError(null);
    setNote(null);
    try {
      const questions = await generateQuestionsWithAI({ prompt: prompt.trim(), count, set_title: setTitle });
      setDrafts(questions.map((q) => ({ q, selected: true })));
      if (!questions.length) setError("AI 没有返回题目，换个说法再试试");
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI 生成失败");
    } finally {
      setLoading(false);
    }
  }

  function toggle(idx: number) {
    setDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, selected: !d.selected } : d)));
  }

  function handleInsert() {
    const chosen = drafts.filter((d) => d.selected).map((d) => d.q);
    if (!chosen.length) {
      setError("请至少勾选一题");
      return;
    }
    onInsert(chosen);
    setDrafts([]);
    setNote(`已加入 ${chosen.length} 题到题库底部`);
  }

  const selectedCount = drafts.filter((d) => d.selected).length;

  return (
    <>
      <div style={overlayStyle(open)} onClick={onClose} aria-hidden={!open} />
      <aside style={panelStyle(open)} role="dialog" aria-label="AI 出题" aria-hidden={!open}>
        <header style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <i className="fas fa-wand-magic-sparkles" aria-hidden="true" style={{ color: "var(--x-color-accent)", fontSize: "20px" }} />
            <div>
              <div style={{ fontWeight: 900, fontSize: "18px" }}>AI 出题</div>
              <div style={{ fontSize: "12px", color: "var(--x-color-ink-muted)", fontWeight: 700 }}>让 AI 帮你想题目和答案</div>
            </div>
          </div>
          <button type="button" onClick={onClose} style={closeBtnStyle} title="关闭">
            <i className="fas fa-xmark" aria-hidden="true" />
          </button>
        </header>

        <div style={bodyStyle}>
          <label style={fieldStyle}>
            <span style={labelStyle}>出题要求</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              style={textareaStyle}
              placeholder="例如：出 5 道关于八正道的初级选择题，中英文对照，选项要有迷惑性"
            />
          </label>
          <label style={{ ...fieldStyle, maxWidth: "160px" }}>
            <span style={labelStyle}>题目数量</span>
            <input
              type="number"
              min={1}
              max={20}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(20, Number.parseInt(e.target.value || "5", 10) || 5)))}
              style={numberStyle}
            />
          </label>

          <button type="button" onClick={() => void handleGenerate()} disabled={loading} style={generateBtnStyle}>
            <i className={loading ? "fas fa-spinner fa-spin" : "fas fa-wand-magic-sparkles"} aria-hidden="true" />{" "}
            {loading ? "AI 生成中…" : "生成题目"}
          </button>

          {error ? <div style={errorStyle}>{error}</div> : null}
          {note ? <div style={noteStyle}>{note}</div> : null}

          {drafts.length > 0 ? (
            <div style={{ display: "grid", gap: "10px", marginTop: "6px" }}>
              <div style={{ fontWeight: 800, color: "var(--x-color-ink-muted)", fontSize: "13px" }}>
                预览（勾选要加入的题目）
              </div>
              {drafts.map((d, idx) => (
                <div key={idx} style={draftCardStyle(d.selected)} onClick={() => toggle(idx)}>
                  <div style={{ display: "flex", gap: "10px" }}>
                    <input type="checkbox" checked={d.selected} onChange={() => toggle(idx)} onClick={(e) => e.stopPropagation()} style={{ marginTop: "3px" }} />
                    <div style={{ flex: 1 }}>
                      {d.q.section ? <div style={sectionTagStyle}>{d.q.section}</div> : null}
                      <div style={{ fontWeight: 800, lineHeight: 1.4 }}>{d.q.zh}</div>
                      {d.q.en ? <div style={{ fontSize: "13px", color: "var(--x-color-ink-muted)", marginTop: "2px" }}>{d.q.en}</div> : null}
                      <div style={{ display: "grid", gap: "5px", marginTop: "8px" }}>
                        {d.q.options.map((opt, oi) => {
                          const correct = oi === d.q.answer;
                          return (
                            <div key={oi} style={draftOptStyle(correct)}>
                              <span style={{ ...optTagStyle, background: OPTION_COLORS[oi % OPTION_COLORS.length] }}>{OPTION_SHAPES[oi]}</span>
                              <span style={{ flex: 1 }}>
                                {opt.zh}
                                {opt.en ? <span style={{ color: "var(--x-color-ink-muted)" }}> · {opt.en}</span> : null}
                              </span>
                              {correct ? <i className="fas fa-check" aria-hidden="true" style={{ color: "var(--x-color-success)" }} /> : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {drafts.length > 0 ? (
          <footer style={footerStyle}>
            <button type="button" onClick={handleInsert} style={insertBtnStyle}>
              <i className="fas fa-plus" aria-hidden="true" /> 加入所选（{selectedCount}）
            </button>
          </footer>
        ) : null}
      </aside>
    </>
  );
}

/* styles */

const overlayStyle = (open: boolean): CSSProperties => ({
  position: "fixed",
  inset: 0,
  zIndex: 40,
  background: "rgba(0,0,0,0.4)",
  opacity: open ? 1 : 0,
  pointerEvents: open ? "auto" : "none",
  transition: "opacity 0.28s ease",
});
const panelStyle = (open: boolean): CSSProperties => ({
  position: "fixed",
  top: 0,
  right: 0,
  bottom: 0,
  zIndex: 41,
  width: "min(460px, 94vw)",
  display: "flex",
  flexDirection: "column",
  background: "var(--x-color-canvas)",
  borderLeft: "1px solid var(--x-color-line)",
  boxShadow: "-18px 0 50px var(--x-color-shadow-soft)",
  transform: open ? "translateX(0)" : "translateX(100%)",
  transition: "transform 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
});
const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "16px 18px",
  borderBottom: "1px solid var(--x-color-line)",
};
const closeBtnStyle: CSSProperties = {
  width: "38px",
  height: "38px",
  display: "grid",
  placeItems: "center",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  cursor: "pointer",
};
const bodyStyle: CSSProperties = { flex: 1, overflowY: "auto", padding: "16px 18px", display: "grid", gap: "12px", alignContent: "start" };
const fieldStyle: CSSProperties = { display: "grid", gap: "6px" };
const labelStyle: CSSProperties = { color: "var(--x-color-ink-muted)", fontSize: "13px", fontWeight: 800 };
const textareaStyle: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  border: "1px solid var(--x-color-line)",
  borderRadius: "10px",
  padding: "10px 12px",
  fontSize: "15px",
  resize: "vertical",
  fontFamily: "inherit",
  color: "var(--x-color-ink)",
  background: "var(--x-color-surface)",
};
const numberStyle: CSSProperties = {
  minHeight: "44px",
  boxSizing: "border-box",
  width: "100%",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  padding: "0 12px",
  fontSize: "16px",
  color: "var(--x-color-ink)",
  background: "var(--x-color-surface)",
};
const generateBtnStyle: CSSProperties = {
  minHeight: "48px",
  border: "none",
  borderRadius: "10px",
  background: "var(--x-color-accent)",
  color: "white",
  fontWeight: 900,
  fontSize: "16px",
  cursor: "pointer",
};
const errorStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: "8px",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
  fontWeight: 800,
  fontSize: "14px",
};
const noteStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: "8px",
  background: "var(--x-color-success-soft)",
  color: "var(--x-color-success)",
  fontWeight: 800,
  fontSize: "14px",
};
const draftCardStyle = (selected: boolean): CSSProperties => ({
  padding: "12px",
  borderRadius: "12px",
  border: selected ? "2px solid var(--x-color-accent)" : "1px solid var(--x-color-line)",
  background: selected ? "var(--x-color-accent-soft)" : "var(--x-color-panel)",
  cursor: "pointer",
});
const sectionTagStyle: CSSProperties = {
  display: "inline-block",
  marginBottom: "4px",
  padding: "2px 8px",
  borderRadius: "999px",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink-muted)",
  fontSize: "11px",
  fontWeight: 800,
};
const draftOptStyle = (correct: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "6px 8px",
  borderRadius: "8px",
  fontSize: "14px",
  background: correct ? "var(--x-color-success-soft)" : "var(--x-color-surface)",
  fontWeight: correct ? 800 : 600,
});
const optTagStyle: CSSProperties = {
  width: "22px",
  height: "22px",
  flex: "0 0 auto",
  borderRadius: "6px",
  color: "white",
  display: "grid",
  placeItems: "center",
  fontSize: "12px",
  fontWeight: 900,
};
const footerStyle: CSSProperties = { padding: "14px 18px", borderTop: "1px solid var(--x-color-line)", background: "var(--x-color-canvas)" };
const insertBtnStyle: CSSProperties = {
  width: "100%",
  minHeight: "50px",
  border: "none",
  borderRadius: "10px",
  background: "var(--x-color-accent)",
  color: "white",
  fontWeight: 900,
  fontSize: "16px",
  cursor: "pointer",
};
