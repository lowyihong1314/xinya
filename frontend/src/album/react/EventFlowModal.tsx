import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import {
  createEventFlow,
  deleteEventFlow,
  fetchEventFlows,
  reorderEventFlows,
  updateEventFlow,
} from "../../event/shared/api";
import { showConfirmDialog } from "../../js/dialogs";
import { useEnsureDesignTokens } from "../../theme/designTokens";
import type { EventDetailRecord, EventFlowRecord } from "../../event/shared/types";

type Props = {
  detail: EventDetailRecord;
  canEdit?: boolean;
  onClose: () => void;
  embedded?: boolean;
};

type EditorState = {
  flowId: number | null;
  title: string;
  detail: string;
  minutes: string;
};

export function EventFlowModal({ detail, canEdit = false, onClose, embedded = false }: Props) {
  useEnsureDesignTokens();

  const [flows, setFlows] = useState<EventFlowRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);

  useEffect(() => {
    void loadFlows();
  }, [detail.id]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!canEdit) {
      setEditor(null);
      setDraggingId(null);
    }
  }, [canEdit]);

  const renderedFlows = useMemo(() => {
    let cumulativeMinutes = 0;
    const startDate = detail.datetime ? new Date(detail.datetime) : null;

    return flows.map((flow) => {
      const startLabel = startDate ? formatClock(addMinutes(startDate, cumulativeMinutes)) : "--:--";
      const duration = Number(flow.minutes);
      if (Number.isFinite(duration) && duration > 0) {
        cumulativeMinutes += duration;
      }
      const endLabel = startDate ? formatClock(addMinutes(startDate, cumulativeMinutes)) : "--:--";
      return { flow, startLabel, endLabel };
    });
  }, [detail.datetime, flows]);

  async function loadFlows() {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchEventFlows(detail.id);
      setFlows(Array.isArray(payload.data) ? payload.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取流程失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(flowId: number) {
    if (!canEdit) {
      return;
    }
    if (!(await showConfirmDialog({ message: "确定删除该流程？", tone: "danger" }))) {
      return;
    }
    setSaving(true);
    try {
      await deleteEventFlow(flowId);
      await loadFlows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEditor() {
    if (!canEdit || !editor) {
      return;
    }
    const minutesValue = editor.minutes.trim() === "" ? null : Number(editor.minutes);
    if (minutesValue !== null && (!Number.isFinite(minutesValue) || minutesValue < 0)) {
      setError("时长必须是大于等于 0 的数字");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editor.flowId) {
        await updateEventFlow(editor.flowId, {
          title: editor.title.trim() || null,
          detail: editor.detail.trim() || null,
          minutes: minutesValue,
        });
      } else {
        await createEventFlow({
          event_id: detail.id,
          title: editor.title.trim() || null,
          detail: editor.detail.trim() || null,
          minutes: minutesValue,
        });
      }
      setEditor(null);
      await loadFlows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleDrop(targetId: number) {
    if (!canEdit) {
      return;
    }
    if (!draggingId || draggingId === targetId) {
      return;
    }

    const next = [...flows];
    const fromIndex = next.findIndex((item) => item.id === draggingId);
    const toIndex = next.findIndex((item) => item.id === targetId);
    if (fromIndex < 0 || toIndex < 0) {
      return;
    }

    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setFlows(next);
    setDraggingId(null);

    try {
      const payload = await reorderEventFlows(detail.id, next.map((item) => item.id));
      if (Array.isArray(payload.data)) {
        setFlows(payload.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "排序失败");
      await loadFlows();
    }
  }

  const panel = (
    <div
      style={embedded ? embeddedPanelStyle : modalStyle}
      onClick={embedded ? undefined : (event) => event.stopPropagation()}
    >
      <div style={headerStyle}>
        <div>
          <div style={eyebrowStyle}>活动流程</div>
          <h2 style={titleStyle}>活动流程</h2>
          <div style={subTitleStyle}>
            {detail.event_name || `活动 #${detail.id}`} {detail.datetime ? `· ${detail.datetime}` : ""}
          </div>
        </div>
        <div style={headerActionsStyle}>
          {canEdit ? (
            <button
              type="button"
              style={primaryButtonStyle}
              onClick={() => setEditor({ flowId: null, title: "", detail: "", minutes: "" })}
            >
              + 新增
            </button>
          ) : null}
          {embedded ? null : (
            <button type="button" style={closeButtonStyle} onClick={onClose}>
              关闭
            </button>
          )}
        </div>
      </div>

      {error ? <div style={errorStyle}>{error}</div> : null}

      <div style={hintStyle}>
        {canEdit
          ? detail.datetime
            ? "拖动左侧把手可以排序。每一行开始时间会根据活动开始时间和前面流程时长自动推算。"
            : "当前活动没有开始时间，流程仍可编辑，但不会推算具体时钟时间。"
          : "当前账号可查看流程，但新增、编辑、删除和排序需要 event_edit 权限。"}
      </div>

      {loading ? <div style={placeholderStyle}>读取流程中…</div> : null}
      {!loading && !flows.length ? <div style={placeholderStyle}>{canEdit ? "暂无流程，点击右上角新增。" : "当前活动还没有流程。"}</div> : null}

      {!loading && flows.length ? (
        <div style={listStyle}>
          {renderedFlows.map(({ flow, startLabel, endLabel }) => (
            <div
              key={flow.id}
              style={rowStyle}
              draggable={canEdit}
              onDragStart={() => {
                if (canEdit) {
                  setDraggingId(flow.id);
                }
              }}
              onDragOver={(event) => {
                if (canEdit) {
                  event.preventDefault();
                }
              }}
              onDrop={() => void handleDrop(flow.id)}
              onDragEnd={() => setDraggingId(null)}
            >
              <div style={dragHandleStyle}>
                <i className="fa-solid fa-grip-vertical" />
              </div>
              <button
                type="button"
                style={timeBoxStyle}
                disabled={!canEdit}
                onClick={() =>
                  setEditor({
                    flowId: flow.id,
                    title: flow.title || "",
                    detail: flow.detail || "",
                    minutes: flow.minutes == null ? "" : String(flow.minutes),
                  })
                }
              >
                <span style={timeStartStyle}>{startLabel}</span>
                <span style={timeEndStyle}>→ {endLabel}</span>
              </button>
              <div style={contentStyle}>
                <div style={contentTitleStyle}>{flow.title || "(无标题)"}</div>
                {flow.detail ? <div style={contentBodyStyle}>{flow.detail}</div> : null}
              </div>
              {canEdit ? (
                <div style={rowActionsStyle}>
                  <button
                    type="button"
                    style={secondaryPillStyle}
                    onClick={() =>
                      setEditor({
                        flowId: flow.id,
                        title: flow.title || "",
                        detail: flow.detail || "",
                        minutes: flow.minutes == null ? "" : String(flow.minutes),
                      })
                    }
                  >
                    编辑
                  </button>
                  <button type="button" style={dangerPillStyle} disabled={saving} onClick={() => void handleDelete(flow.id)}>
                    移除
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );

  const editorModal = editor ? (
    <div style={editorOverlayStyle} onClick={() => setEditor(null)}>
      <div style={editorCardStyle} onClick={(event) => event.stopPropagation()}>
        <div style={editorHeaderStyle}>
          <div style={editorTitleStyle}>{editor.flowId ? "编辑流程" : "新增流程"}</div>
          <button type="button" style={closeButtonStyle} onClick={() => setEditor(null)}>
            关闭
          </button>
        </div>
        <label style={fieldStyle}>
          <span style={fieldLabelStyle}>标题</span>
          <input
            style={inputStyle}
            value={editor.title}
            onChange={(event) => setEditor((prev) => (prev ? { ...prev, title: event.target.value } : prev))}
          />
        </label>
        <label style={fieldStyle}>
          <span style={fieldLabelStyle}>时长（分钟）</span>
          <input
            type="number"
            min="0"
            step="1"
            style={inputStyle}
            value={editor.minutes}
            onChange={(event) => setEditor((prev) => (prev ? { ...prev, minutes: event.target.value } : prev))}
          />
        </label>
        <label style={fieldStyle}>
          <span style={fieldLabelStyle}>详细内容</span>
          <textarea
            rows={5}
            style={textareaStyle}
            value={editor.detail}
            onChange={(event) => setEditor((prev) => (prev ? { ...prev, detail: event.target.value } : prev))}
          />
        </label>
        <div style={editorFooterStyle}>
          <button type="button" style={secondaryButtonStyle} onClick={() => setEditor(null)}>
            取消
          </button>
          <button type="button" style={primaryButtonStyle} disabled={saving} onClick={() => void handleSaveEditor()}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (embedded) {
    return (
      <>
        {panel}
        {editorModal}
      </>
    );
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      {panel}
      {editorModal}
    </div>
  );
}

function addMinutes(base: Date, mins: number) {
  return new Date(base.getTime() + mins * 60000);
}

function formatClock(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,23,42,0.32)",
  display: "grid",
  placeItems: "center",
  zIndex: 5000,
  padding: "24px",
  backdropFilter: "blur(6px)",
};

const modalStyle: CSSProperties = {
  width: "min(920px, 100%)",
  maxHeight: "90vh",
  overflow: "auto",
  padding: "22px",
  borderRadius: "var(--x-radius-lg)",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line)",
  boxShadow: "0 16px 40px var(--x-color-shadow-soft)",
  color: "var(--x-color-ink)",
  backdropFilter: "blur(8px)",
  display: "grid",
  gap: "16px",
};

const embeddedPanelStyle: CSSProperties = {
  width: "100%",
  padding: "22px",
  borderRadius: "var(--x-radius-lg)",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line)",
  boxShadow: "0 16px 40px var(--x-color-shadow-soft)",
  color: "var(--x-color-ink)",
  display: "grid",
  gap: "16px",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "14px",
  alignItems: "center",
  flexWrap: "wrap",
};

const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.16em",
  textTransform: "uppercase",
  color: "var(--x-color-accent)",
};

const titleStyle: CSSProperties = {
  margin: "8px 0 0",
  fontSize: "28px",
  fontFamily: "var(--x-font-serif)",
  fontWeight: 500,
  color: "var(--x-color-ink)",
};

const subTitleStyle: CSSProperties = {
  marginTop: "6px",
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
};

const headerActionsStyle: CSSProperties = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
};

const primaryButtonStyle: CSSProperties = {
  padding: "12px 18px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-accent-border)",
  background: "var(--x-color-accent)",
  color: "#ffffff",
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: "0 14px 32px var(--x-color-shadow-soft)",
};

const secondaryButtonStyle: CSSProperties = {
  padding: "12px 18px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: "0 12px 28px var(--x-color-shadow-soft)",
};

const closeButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  padding: "10px 14px",
};

const hintStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: "var(--x-radius-md)",
  background: "var(--x-color-panel-alt)",
  border: "1px solid var(--x-color-accent-border)",
  color: "var(--x-color-ink)",
  fontSize: "13px",
};

const errorStyle: CSSProperties = {
  padding: "12px 14px",
  borderRadius: "var(--x-radius-md)",
  border: "1px solid var(--x-color-danger-border)",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
};

const placeholderStyle: CSSProperties = {
  padding: "24px",
  borderRadius: "var(--x-radius-md)",
  background: "var(--x-color-panel-alt)",
  border: "1px solid var(--x-color-line)",
  color: "var(--x-color-ink-muted)",
};

const listStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
};

const rowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "28px 104px minmax(0, 1fr) auto",
  gap: "12px",
  alignItems: "center",
  padding: "12px",
  borderRadius: "var(--x-radius-md)",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  boxShadow: "0 6px 16px var(--x-color-shadow-soft)",
};

const dragHandleStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
  color: "var(--x-color-ink-muted)",
  cursor: "grab",
};

const timeBoxStyle: CSSProperties = {
  borderRadius: "var(--x-radius-md)",
  padding: "10px 12px",
  background: "var(--x-color-accent)",
  border: "1px solid var(--x-color-accent-border)",
  color: "#ffffff",
  display: "grid",
  gap: "2px",
  textAlign: "left",
  cursor: "pointer",
};

const timeStartStyle: CSSProperties = {
  fontSize: "16px",
  fontWeight: 800,
};

const timeEndStyle: CSSProperties = {
  fontSize: "12px",
  opacity: 0.92,
};

const contentStyle: CSSProperties = {
  display: "grid",
  gap: "4px",
  minWidth: 0,
};

const contentTitleStyle: CSSProperties = {
  fontSize: "15px",
  fontWeight: 800,
  color: "var(--x-color-ink)",
};

const contentBodyStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
  lineHeight: 1.6,
};

const rowActionsStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
};

const secondaryPillStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-accent-border)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-accent)",
  cursor: "pointer",
  fontWeight: 700,
};

const dangerPillStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-danger-border)",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
  cursor: "pointer",
  fontWeight: 700,
};

const editorOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,23,42,0.32)",
  display: "grid",
  placeItems: "center",
  zIndex: 5100,
  padding: "24px",
  backdropFilter: "blur(6px)",
};

const editorCardStyle: CSSProperties = {
  width: "min(520px, 100%)",
  padding: "22px",
  borderRadius: "var(--x-radius-lg)",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line)",
  boxShadow: "0 16px 40px var(--x-color-shadow-soft)",
  backdropFilter: "blur(8px)",
  display: "grid",
  gap: "14px",
};

const editorHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
};

const editorTitleStyle: CSSProperties = {
  fontSize: "22px",
  fontFamily: "var(--x-font-serif)",
  fontWeight: 500,
  color: "var(--x-color-ink)",
};

const fieldStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
};

const fieldLabelStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 700,
  color: "var(--x-color-ink-muted)",
};

const inputStyle: CSSProperties = {
  width: "100%",
  minHeight: "46px",
  padding: "12px 14px",
  borderRadius: "var(--x-radius-md)",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink)",
  boxSizing: "border-box",
  outlineColor: "var(--x-color-accent)",
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: "120px",
  resize: "vertical",
};

const editorFooterStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "10px",
  flexWrap: "wrap",
};
