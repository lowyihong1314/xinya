import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { AiQuestionDrawer } from "./AiQuestionDrawer";
import { createSet, deleteSet, getSet, updateSet } from "./api";
import { OPTION_COLORS, OPTION_SHAPES } from "./types";
import type { QuizGameQuestion } from "./types";

type EditableQuestion = QuizGameQuestion & { key: string };

const PAGE_SIZE = 10;

let keySeq = 0;
function nextKey() {
  keySeq += 1;
  return `q${keySeq}`;
}

function emptyQuestion(): EditableQuestion {
  return {
    key: nextKey(),
    section: "",
    zh: "",
    en: "",
    options: [
      { zh: "", en: "" },
      { zh: "", en: "" },
      { zh: "", en: "" },
      { zh: "", en: "" },
    ],
    answer: 0,
  };
}

export function QuestionEditorPage({
  setId,
  onClose,
  onSaved,
}: {
  setId: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [questionTime, setQuestionTime] = useState(30);
  const [questions, setQuestions] = useState<EditableQuestion[]>(() => [emptyQuestion()]);
  const [loading, setLoading] = useState(setId !== null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement | null>(null);

  const totalPages = Math.max(1, Math.ceil(questions.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageItems = questions.slice(pageStart, pageStart + PAGE_SIZE);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  // New (unsaved) set → open the first question so the user can type right away.
  useEffect(() => {
    if (setId === null) setExpandedKey((k) => k ?? questions[0]?.key ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleExpand(key: string) {
    setExpandedKey((prev) => (prev === key ? null : key));
  }
  function goToQuestion(index: number) {
    setPage(Math.floor(index / PAGE_SIZE) + 1);
    setExpandedKey(questions[index]?.key ?? null);
  }

  useEffect(() => {
    if (setId === null) return;
    let active = true;
    setLoading(true);
    void getSet(setId)
      .then((s) => {
        if (!active) return;
        setTitle(s.title);
        setDescription(s.description || "");
        setQuestionTime(s.question_time || 30);
        setQuestions(
          (s.questions || []).map((q) => ({
            key: nextKey(),
            section: q.section || "",
            zh: q.zh || "",
            en: q.en || "",
            options: q.options.length ? q.options.map((o) => ({ zh: o.zh || "", en: o.en || "" })) : emptyQuestion().options,
            answer: q.answer || 0,
          })),
        );
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : "读取题库失败"))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [setId]);

  function patchQuestion(idx: number, patch: Partial<EditableQuestion>) {
    setQuestions((prev) => prev.map((q, i) => (i === idx ? { ...q, ...patch } : q)));
  }
  function patchOption(qIdx: number, oIdx: number, patch: Partial<{ zh: string; en: string }>) {
    setQuestions((prev) =>
      prev.map((q, i) =>
        i === qIdx ? { ...q, options: q.options.map((o, j) => (j === oIdx ? { ...o, ...patch } : o)) } : q,
      ),
    );
  }
  function addOption(qIdx: number) {
    setQuestions((prev) =>
      prev.map((q, i) => (i === qIdx && q.options.length < 6 ? { ...q, options: [...q.options, { zh: "", en: "" }] } : q)),
    );
  }
  function removeOption(qIdx: number, oIdx: number) {
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== qIdx || q.options.length <= 2) return q;
        const options = q.options.filter((_, j) => j !== oIdx);
        let answer = q.answer;
        if (oIdx === answer) answer = 0;
        else if (oIdx < answer) answer -= 1;
        return { ...q, options, answer };
      }),
    );
  }
  function addQuestion() {
    const q = emptyQuestion();
    setQuestions((prev) => [...prev, q]);
    setPage(Math.floor(questions.length / PAGE_SIZE) + 1);
    setExpandedKey(q.key);
  }
  function insertGenerated(items: QuizGameQuestion[]) {
    setQuestions((prev) => [
      ...prev,
      ...items.map((q) => ({
        key: nextKey(),
        section: q.section || "",
        zh: q.zh || "",
        en: q.en || "",
        options: q.options.length ? q.options.map((o) => ({ zh: o.zh || "", en: o.en || "" })) : emptyQuestion().options,
        answer: q.answer || 0,
      })),
    ]);
    // Jump to the page where the first newly generated question landed.
    setPage(Math.floor(questions.length / PAGE_SIZE) + 1);
    setExpandedKey(null);
  }
  function removeQuestion(idx: number) {
    setQuestions((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  }
  function moveQuestion(idx: number, dir: -1 | 1) {
    setQuestions((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  async function handleSave() {
    setError(null);
    if (!title.trim()) {
      setError("请填写题库名称");
      topRef.current?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    for (let i = 0; i < questions.length; i += 1) {
      const q = questions[i];
      if (!q.zh.trim()) {
        setError(`第 ${i + 1} 题缺少题目文字`);
        goToQuestion(i);
        return;
      }
      const filled = q.options.filter((o) => o.zh.trim() || o.en.trim());
      if (filled.length < 2) {
        setError(`第 ${i + 1} 题至少需要 2 个选项`);
        goToQuestion(i);
        return;
      }
    }
    const payloadQuestions: QuizGameQuestion[] = questions.map((q) => ({
      section: q.section.trim(),
      zh: q.zh.trim(),
      en: q.en.trim(),
      options: q.options.filter((o) => o.zh.trim() || o.en.trim()).map((o) => ({ zh: o.zh.trim(), en: o.en.trim() })),
      answer: q.answer,
    }));
    setSaving(true);
    try {
      if (setId === null) {
        await createSet({ title: title.trim(), description: description.trim(), question_time: questionTime, questions: payloadQuestions });
      } else {
        await updateSet(setId, { title: title.trim(), description: description.trim(), question_time: questionTime, questions: payloadQuestions });
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (setId === null) return;
    if (!window.confirm("确定删除整个题库？此操作无法撤销。")) return;
    setSaving(true);
    try {
      await deleteSet(setId);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main style={pageStyle}>
        <div style={centerMsg}>读取题库中…</div>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <div style={shellStyle} ref={topRef}>
        <header style={topBarStyle}>
          <button type="button" onClick={onClose} style={ghostBtnStyle}>
            <i className="fas fa-arrow-left" aria-hidden="true" /> 返回
          </button>
          <h1 style={h1Style}>{setId === null ? "新建题库" : "编辑题库"}</h1>
          <div style={{ display: "flex", gap: "8px" }}>
            <button type="button" onClick={() => setAiOpen(true)} style={aiBtnStyle} title="AI 出题">
              <i className="fas fa-wand-magic-sparkles" aria-hidden="true" /> <span style={aiBtnLabelStyle}>AI 出题</span>
            </button>
            <button type="button" onClick={() => void handleSave()} disabled={saving} style={saveBtnStyle}>
              <i className="fas fa-floppy-disk" aria-hidden="true" /> {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </header>

        {error ? <div style={errorStyle}>{error}</div> : null}

        <section style={metaCardStyle}>
          <label style={fieldStyle}>
            <span style={labelStyle}>题库名称</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} placeholder="例如：十善业测验" maxLength={255} />
          </label>
          <label style={fieldStyle}>
            <span style={labelStyle}>说明（可选）</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle} placeholder="简单描述" />
          </label>
          <label style={{ ...fieldStyle, maxWidth: "220px" }}>
            <span style={labelStyle}>每题秒数</span>
            <input
              type="number"
              min={5}
              max={300}
              value={questionTime}
              onChange={(e) => setQuestionTime(Math.max(5, Math.min(300, Number.parseInt(e.target.value || "30", 10) || 30)))}
              style={inputStyle}
            />
          </label>
        </section>

        <div style={questionCountRowStyle}>
          <span>共 {questions.length} 题{totalPages > 1 ? ` · 第 ${safePage}/${totalPages} 页` : ""}</span>
          <button type="button" onClick={() => setAiOpen(true)} style={aiInlineBtnStyle}>
            <i className="fas fa-wand-magic-sparkles" aria-hidden="true" /> 让 AI 帮我出题
          </button>
        </div>

        <div style={listStyle}>
          {pageItems.map((q, i) => {
            const idx = pageStart + i;
            const expanded = expandedKey === q.key;
            if (!expanded) {
              return (
                <div key={q.key} style={rowCardStyle}>
                  <div style={rowMainStyle} role="button" tabIndex={0} onClick={() => toggleExpand(q.key)}>
                    <span style={rowNumStyle}>{idx + 1}</span>
                    <span style={rowTextWrapStyle}>
                      {q.section ? <span style={rowSectionChipStyle}>{q.section}</span> : null}
                      <span style={rowZhStyle}>{q.zh.trim() || "（未填写题目）"}</span>
                    </span>
                  </div>
                  <span
                    style={{ ...rowAnswerChipStyle, background: OPTION_COLORS[q.answer % OPTION_COLORS.length] }}
                    title={`正确答案：${q.options[q.answer]?.zh || ""}`}
                  >
                    {OPTION_SHAPES[q.answer] ?? "?"}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeQuestion(idx)}
                    disabled={questions.length <= 1}
                    style={{ ...iconBtnStyle, color: "var(--x-color-danger)" }}
                    title="删除"
                  >
                    <i className="fas fa-trash" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => toggleExpand(q.key)} style={iconBtnStyle} title="编辑">
                    <i className="fas fa-chevron-right" aria-hidden="true" />
                  </button>
                </div>
              );
            }
            return (
              <section key={q.key} style={questionCardStyle}>
                <div style={qHeaderStyle}>
                  <span style={qBadgeStyle}>第 {idx + 1} 题</span>
                  <div style={qHeaderActionsStyle}>
                    <button type="button" onClick={() => moveQuestion(idx, -1)} disabled={idx === 0} style={iconBtnStyle} title="上移">
                      <i className="fas fa-arrow-up" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => moveQuestion(idx, 1)} disabled={idx === questions.length - 1} style={iconBtnStyle} title="下移">
                      <i className="fas fa-arrow-down" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => removeQuestion(idx)} disabled={questions.length <= 1} style={{ ...iconBtnStyle, color: "var(--x-color-danger)" }} title="删除">
                      <i className="fas fa-trash" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => toggleExpand(q.key)} style={iconBtnStyle} title="收起">
                      <i className="fas fa-chevron-up" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <input value={q.section} onChange={(e) => patchQuestion(idx, { section: e.target.value })} style={{ ...inputStyle, marginBottom: "8px" }} placeholder="分组 / 章节（可选，例如 观念判断）" />
                <textarea value={q.zh} onChange={(e) => patchQuestion(idx, { zh: e.target.value })} style={textareaStyle} placeholder="题目（中文）" rows={2} />
                <textarea value={q.en} onChange={(e) => patchQuestion(idx, { en: e.target.value })} style={{ ...textareaStyle, marginTop: "6px" }} placeholder="Question (English, optional)" rows={2} />

                <div style={optionsLabelStyle}>选项（点左侧圆圈选择正确答案）</div>
                <div style={{ display: "grid", gap: "8px" }}>
                  {q.options.map((opt, oIdx) => {
                    const correct = q.answer === oIdx;
                    return (
                      <div key={oIdx} style={optionRowStyle(correct)}>
                        <button type="button" onClick={() => patchQuestion(idx, { answer: oIdx })} style={answerDotStyle(correct)} title="设为正确答案">
                          {correct ? <i className="fas fa-check" aria-hidden="true" /> : null}
                        </button>
                        <span style={{ ...optColorTag, background: OPTION_COLORS[oIdx % OPTION_COLORS.length] }}>{OPTION_SHAPES[oIdx]}</span>
                        <div style={{ display: "grid", gap: "4px", flex: 1 }}>
                          <input value={opt.zh} onChange={(e) => patchOption(idx, oIdx, { zh: e.target.value })} style={optInputStyle} placeholder="选项（中文）" />
                          <input value={opt.en} onChange={(e) => patchOption(idx, oIdx, { en: e.target.value })} style={{ ...optInputStyle, fontSize: "13px", opacity: 0.85 }} placeholder="Option (English, optional)" />
                        </div>
                        <button type="button" onClick={() => removeOption(idx, oIdx)} disabled={q.options.length <= 2} style={{ ...iconBtnStyle, color: "var(--x-color-danger)" }} title="删除选项">
                          <i className="fas fa-xmark" aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })}
                </div>
                {q.options.length < 6 ? (
                  <button type="button" onClick={() => addOption(idx)} style={addOptionBtnStyle}>
                    <i className="fas fa-plus" aria-hidden="true" /> 添加选项
                  </button>
                ) : null}
              </section>
            );
          })}
        </div>

        {totalPages > 1 ? (
          <div style={pagerStyle}>
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1} style={pagerBtnStyle}>
              <i className="fas fa-chevron-left" aria-hidden="true" /> 上一页
            </button>
            <div style={pagerInfoStyle}>
              第
              <input
                type="number"
                min={1}
                max={totalPages}
                value={safePage}
                onChange={(e) => {
                  const v = Number.parseInt(e.target.value || "1", 10) || 1;
                  setPage(Math.max(1, Math.min(totalPages, v)));
                }}
                style={pagerInputStyle}
              />
              / {totalPages} 页
            </div>
            <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages} style={pagerBtnStyle}>
              下一页 <i className="fas fa-chevron-right" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        <button type="button" onClick={addQuestion} style={addQuestionBtnStyle}>
          <i className="fas fa-plus" aria-hidden="true" /> 添加题目
        </button>

        <div style={footerStyle}>
          {setId !== null ? (
            <button type="button" onClick={() => void handleDelete()} disabled={saving} style={deleteBtnStyle}>
              <i className="fas fa-trash" aria-hidden="true" /> 删除题库
            </button>
          ) : null}
          <button type="button" onClick={() => void handleSave()} disabled={saving} style={saveBtnStyle}>
            <i className="fas fa-floppy-disk" aria-hidden="true" /> {saving ? "保存中…" : "保存题库"}
          </button>
        </div>
      </div>

      <AiQuestionDrawer open={aiOpen} onClose={() => setAiOpen(false)} setTitle={title} onInsert={insertGenerated} />
    </main>
  );
}

/* styles */

const pageStyle: CSSProperties = { minHeight: "100vh", background: "var(--x-color-canvas)", color: "var(--x-color-ink)" };
const shellStyle: CSSProperties = { width: "min(820px, calc(100% - 28px))", margin: "0 auto", padding: "16px 0 48px" };
const centerMsg: CSSProperties = { minHeight: "60vh", display: "grid", placeItems: "center", color: "var(--x-color-ink-muted)", fontWeight: 800 };
const topBarStyle: CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 5,
  display: "grid",
  gridTemplateColumns: "auto 1fr auto",
  alignItems: "center",
  gap: "12px",
  padding: "10px 0",
  background: "var(--x-color-canvas)",
};
const h1Style: CSSProperties = { margin: 0, textAlign: "center", fontSize: "20px" };
const ghostBtnStyle: CSSProperties = {
  minHeight: "42px",
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "0 14px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 800,
  cursor: "pointer",
};
const saveBtnStyle: CSSProperties = {
  minHeight: "42px",
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "0 18px",
  border: "none",
  borderRadius: "8px",
  background: "var(--x-color-accent)",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};
const errorStyle: CSSProperties = {
  margin: "10px 0",
  padding: "12px 14px",
  borderRadius: "8px",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
  fontWeight: 800,
};
const metaCardStyle: CSSProperties = {
  marginTop: "8px",
  display: "grid",
  gap: "12px",
  padding: "18px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "12px",
  background: "var(--x-color-panel)",
};
const fieldStyle: CSSProperties = { display: "grid", gap: "6px" };
const labelStyle: CSSProperties = { color: "var(--x-color-ink-muted)", fontSize: "13px", fontWeight: 800 };
const inputStyle: CSSProperties = {
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
const textareaStyle: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  padding: "10px 12px",
  fontSize: "16px",
  resize: "vertical",
  color: "var(--x-color-ink)",
  background: "var(--x-color-surface)",
  fontFamily: "inherit",
};
const questionCountRowStyle: CSSProperties = {
  margin: "18px 0 8px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  flexWrap: "wrap",
  fontWeight: 900,
  color: "var(--x-color-ink-muted)",
};
const aiBtnStyle: CSSProperties = {
  minHeight: "42px",
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "0 12px",
  border: "1px solid var(--x-color-accent)",
  borderRadius: "8px",
  background: "var(--x-color-accent-soft)",
  color: "var(--x-color-accent-strong)",
  fontWeight: 900,
  cursor: "pointer",
};
const aiBtnLabelStyle: CSSProperties = { whiteSpace: "nowrap" };
const aiInlineBtnStyle: CSSProperties = {
  minHeight: "40px",
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  padding: "0 16px",
  border: "1px solid var(--x-color-accent)",
  borderRadius: "999px",
  background: "var(--x-color-accent-soft)",
  color: "var(--x-color-accent-strong)",
  fontWeight: 900,
  cursor: "pointer",
};
const listStyle: CSSProperties = { display: "grid", gap: "8px" };
const rowCardStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "8px 10px 8px 12px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "10px",
  background: "var(--x-color-panel)",
};
const rowMainStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  flex: 1,
  minWidth: 0,
  cursor: "pointer",
};
const rowNumStyle: CSSProperties = {
  minWidth: "30px",
  flex: "0 0 auto",
  textAlign: "center",
  fontWeight: 900,
  color: "var(--x-color-ink-muted)",
};
const rowTextWrapStyle: CSSProperties = { flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "8px" };
const rowSectionChipStyle: CSSProperties = {
  flex: "0 0 auto",
  maxWidth: "40%",
  padding: "2px 8px",
  borderRadius: "999px",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink-muted)",
  fontSize: "11px",
  fontWeight: 800,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
const rowZhStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  fontWeight: 700,
};
const rowAnswerChipStyle: CSSProperties = {
  width: "26px",
  height: "26px",
  flex: "0 0 auto",
  borderRadius: "7px",
  color: "white",
  display: "grid",
  placeItems: "center",
  fontWeight: 900,
  fontSize: "13px",
};
const pagerStyle: CSSProperties = {
  marginTop: "14px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "12px",
  flexWrap: "wrap",
};
const pagerBtnStyle: CSSProperties = {
  minHeight: "42px",
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  padding: "0 16px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 800,
  cursor: "pointer",
};
const pagerInfoStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: "6px", fontWeight: 800, color: "var(--x-color-ink-muted)" };
const pagerInputStyle: CSSProperties = {
  width: "56px",
  minHeight: "38px",
  textAlign: "center",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  fontSize: "15px",
  fontWeight: 800,
  color: "var(--x-color-ink)",
  background: "var(--x-color-surface)",
};
const questionCardStyle: CSSProperties = {
  marginBottom: "14px",
  padding: "16px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "12px",
  background: "var(--x-color-panel)",
};
const qHeaderStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" };
const qBadgeStyle: CSSProperties = { fontWeight: 900, padding: "4px 12px", borderRadius: "999px", background: "var(--x-color-accent-soft)", color: "var(--x-color-accent-strong)" };
const qHeaderActionsStyle: CSSProperties = { display: "flex", gap: "6px" };
const iconBtnStyle: CSSProperties = {
  width: "36px",
  height: "36px",
  display: "grid",
  placeItems: "center",
  border: "1px solid var(--x-color-line)",
  borderRadius: "8px",
  background: "var(--x-color-surface)",
  color: "var(--x-color-ink)",
  cursor: "pointer",
};
const optionsLabelStyle: CSSProperties = { margin: "12px 0 8px", fontSize: "13px", fontWeight: 800, color: "var(--x-color-ink-muted)" };
const optionRowStyle = (correct: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: "10px",
  padding: "8px",
  borderRadius: "10px",
  border: correct ? "2px solid var(--x-color-success)" : "1px solid var(--x-color-line)",
  background: correct ? "var(--x-color-success-soft)" : "var(--x-color-surface)",
});
const answerDotStyle = (correct: boolean): CSSProperties => ({
  width: "30px",
  height: "30px",
  flex: "0 0 auto",
  borderRadius: "999px",
  border: correct ? "none" : "2px solid var(--x-color-line)",
  background: correct ? "var(--x-color-success)" : "transparent",
  color: "white",
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
});
const optColorTag: CSSProperties = {
  width: "28px",
  height: "28px",
  flex: "0 0 auto",
  borderRadius: "8px",
  color: "white",
  display: "grid",
  placeItems: "center",
  fontWeight: 900,
};
const optInputStyle: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  minHeight: "38px",
  border: "1px solid var(--x-color-line)",
  borderRadius: "6px",
  padding: "0 10px",
  fontSize: "15px",
  color: "var(--x-color-ink)",
  background: "var(--x-color-panel)",
};
const addOptionBtnStyle: CSSProperties = {
  marginTop: "10px",
  minHeight: "38px",
  padding: "0 14px",
  border: "1px dashed var(--x-color-line)",
  borderRadius: "8px",
  background: "transparent",
  color: "var(--x-color-ink-muted)",
  fontWeight: 800,
  cursor: "pointer",
};
const addQuestionBtnStyle: CSSProperties = {
  width: "100%",
  minHeight: "52px",
  border: "2px dashed var(--x-color-line)",
  borderRadius: "12px",
  background: "transparent",
  color: "var(--x-color-accent-strong)",
  fontWeight: 900,
  fontSize: "16px",
  cursor: "pointer",
};
const footerStyle: CSSProperties = { marginTop: "20px", display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" };
const deleteBtnStyle: CSSProperties = {
  minHeight: "46px",
  padding: "0 18px",
  border: "1px solid var(--x-color-danger)",
  borderRadius: "8px",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
  fontWeight: 900,
  cursor: "pointer",
};
