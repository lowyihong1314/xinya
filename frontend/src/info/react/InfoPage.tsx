import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";

import { useUserState } from "../../app/UserState";
import { PageHero } from "../../components/PageHero";
import { UserCard } from "../../CRM/user_control/react/UserControlView";
import { fetchAllUsers } from "../../CRM/user_control/react/api";
import type { UserRecord } from "../../CRM/user_control/react/types";
import { ensureDesignTokens } from "../../theme/designTokens";
import {
  deleteAboutEntry,
  deleteHistoryEntry,
  fetchAboutEntries,
  fetchHistoryEntries,
  saveAboutEntry,
  saveHistoryEntry,
} from "./api";
import type { AboutEntry, HistoryEntry } from "./types";

type EditorState =
  | { kind: "about"; mode: "add" | "edit"; entry?: AboutEntry }
  | { kind: "history"; mode: "add" | "edit"; entry?: HistoryEntry }
  | null;

export function InfoPage() {
  const MEMBERS_PAGE_SIZE = 4;
  ensureDesignTokens();

  const { isAuthenticated, isMobile } = useUserState();
  const [aboutEntries, setAboutEntries] = useState<AboutEntry[]>([]);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [members, setMembers] = useState<UserRecord[]>([]);
  const [memberPage, setMemberPage] = useState(1);
  const [editor, setEditor] = useState<EditorState>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 2600);
    return () => window.clearTimeout(timer);
  }, [message]);

  const sortedMembers = useMemo(
    () =>
      [...members].sort((left, right) => {
        const leftPriority = left.departments?.some((department) => department.id === 8) ? 1 : 0;
        const rightPriority = right.departments?.some((department) => department.id === 8) ? 1 : 0;
        if (leftPriority !== rightPriority) {
          return rightPriority - leftPriority;
        }

        const leftName = left.display_name || left.username || String(left.id);
        const rightName = right.display_name || right.username || String(right.id);
        return leftName.localeCompare(rightName, "zh-CN");
      }),
    [members],
  );

  const memberTotalPages = Math.max(1, Math.ceil(sortedMembers.length / MEMBERS_PAGE_SIZE));
  const pagedMembers = useMemo(() => {
    const start = (memberPage - 1) * MEMBERS_PAGE_SIZE;
    return sortedMembers.slice(start, start + MEMBERS_PAGE_SIZE);
  }, [sortedMembers, memberPage, MEMBERS_PAGE_SIZE]);

  useEffect(() => {
    setMemberPage(1);
  }, [members]);

  useEffect(() => {
    setMemberPage((prev) => Math.min(prev, memberTotalPages));
  }, [memberTotalPages]);

  async function bootstrap() {
    setLoading(true);
    setError(null);
    try {
      const [aboutData, historyData, userData] = await Promise.all([
        fetchAboutEntries(),
        fetchHistoryEntries(),
        fetchAllUsers(),
      ]);
      setAboutEntries(Array.isArray(aboutData) ? aboutData : []);
      setHistoryEntries(Array.isArray(historyData) ? historyData : []);
      setMembers(Array.isArray(userData.data) ? userData.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteAbout(id: number) {
    if (!window.confirm("确认删除这段简介？")) return;
    try {
      await deleteAboutEntry(id);
      setAboutEntries((prev) => prev.filter((item) => item.id !== id));
      setMessage("简介已删除");
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }

  async function handleDeleteHistory(id: number) {
    if (!window.confirm("确认删除这段历史？")) return;
    try {
      await deleteHistoryEntry(id);
      setHistoryEntries((prev) => prev.filter((item) => item.id !== id));
      setMessage("历史已删除");
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }

  return (
    <div style={pageStyle}>
      <PageHero title="关于我们" subtitle="地南佛学会" />

      {error ? <div style={errorBannerStyle}>{error}</div> : null}
      {message ? <div style={successBannerStyle}>{message}</div> : null}

      <MembersSection
        members={pagedMembers}
        currentPage={memberPage}
        totalPages={memberTotalPages}
        totalCount={sortedMembers.length}
        onPageChange={setMemberPage}
      />

      <AboutSection
        isAuthenticated={isAuthenticated}
        entries={aboutEntries}
        onAdd={() => setEditor({ kind: "about", mode: "add" })}
        onEdit={(entry) => setEditor({ kind: "about", mode: "edit", entry })}
        onDelete={handleDeleteAbout}
      />

      <HistorySection
        isAuthenticated={isAuthenticated}
        isMobile={isMobile}
        entries={historyEntries}
        onAdd={() => setEditor({ kind: "history", mode: "add" })}
        onEdit={(entry) => setEditor({ kind: "history", mode: "edit", entry })}
        onDelete={handleDeleteHistory}
      />

      {loading ? <div style={loadingBadgeStyle}>Loading…</div> : null}
      {editor ? (
        <EditorModal
          editor={editor}
          onClose={() => setEditor(null)}
          onSaved={(kind, payload) => {
            if (kind === "about") {
              setAboutEntries(payload as AboutEntry[]);
            } else {
              setHistoryEntries(payload as HistoryEntry[]);
            }
            setEditor(null);
            setMessage("内容已保存");
          }}
          aboutEntries={aboutEntries}
          historyEntries={historyEntries}
        />
      ) : null}
    </div>
  );
}

function AboutSection(props: {
  isAuthenticated: boolean;
  entries: AboutEntry[];
  onAdd: () => void;
  onEdit: (entry: AboutEntry) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <section style={sectionShellStyle}>
      <div style={sectionHeaderStyle}>
        <div>
          <div style={sectionEyebrowStyle}>About</div>
          <h2 style={sectionTitleStyle}>我们的简介</h2>
        </div>
        {props.isAuthenticated ? (
          <button type="button" style={primaryButtonStyle} onClick={props.onAdd}>
            Add About
          </button>
        ) : null}
      </div>

      <div style={cardGridStyle}>
        {props.entries.map((entry) => (
          <article key={entry.id} style={featureCardStyle}>
            <div style={cardHeaderStyle}>
              <div style={cardMetaStyle}>
                <div style={cardMetaPrimaryStyle}>{entry.username || "Unknown"}</div>
                <div style={cardMetaSecondaryStyle}>{new Date(entry.created_at).toLocaleDateString("zh-CN")}</div>
              </div>
              {props.isAuthenticated ? (
                <div style={cardActionsStyle}>
                  <button type="button" style={ghostButtonStyle} onClick={() => props.onEdit(entry)}>
                    Edit
                  </button>
                  <button type="button" style={dangerGhostButtonStyle} onClick={() => void props.onDelete(entry.id)}>
                    Delete
                  </button>
                </div>
              ) : null}
            </div>
            <p style={bodyTextStyle}>{entry.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function HistorySection(props: {
  isAuthenticated: boolean;
  isMobile: boolean;
  entries: HistoryEntry[];
  onAdd: () => void;
  onEdit: (entry: HistoryEntry) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <section style={sectionShellStyle}>
      <div style={sectionHeaderStyle}>
        <div>
          <div style={sectionEyebrowStyle}>History</div>
          <h2 style={sectionTitleStyle}>地南佛学会历程</h2>
        </div>
        {props.isAuthenticated ? (
          <button type="button" style={primaryButtonStyle} onClick={props.onAdd}>
            Add History
          </button>
        ) : null}
      </div>

      <div style={timelineStyle}>
        {props.entries.map((entry) => (
          <article key={entry.id} style={timelineCardStyle(props.isMobile)}>
            <div style={timelineDateStyle}>{new Date(entry.date).getFullYear()}</div>
            <div style={timelineBodyStyle}>
              <div style={cardHeaderStyle}>
                <div style={timelineDateSubStyle}>{entry.date}</div>
                {props.isAuthenticated ? (
                  <div style={cardActionsStyle}>
                    <button type="button" style={ghostButtonStyle} onClick={() => props.onEdit(entry)}>
                      Edit
                    </button>
                    <button type="button" style={dangerGhostButtonStyle} onClick={() => void props.onDelete(entry.id)}>
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
              <p style={bodyTextStyle}>{entry.text}</p>
              {entry.img ? <img src={entry.img} alt="" style={historyImageStyle} /> : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function MembersSection(props: {
  members: UserRecord[];
  currentPage: number;
  totalPages: number;
  totalCount: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <section style={sectionShellStyle}>
      <div style={sectionHeaderStyle}>
        <div>
          <div style={sectionEyebrowStyle}>Members</div>
          <h2 style={sectionTitleStyle}>成员</h2>
        </div>
        <div style={memberSummaryStyle}>
          <span>{props.totalCount} 位成员</span>
          <span>
            第 {props.currentPage} / {props.totalPages} 页
          </span>
        </div>
      </div>

      <div style={memberContainerStyle}>
        <div style={memberGridStyle}>
          {props.members.map((member) => (
            <UserCard key={member.id} user={member} />
          ))}
        </div>
        {!props.members.length ? <div style={loadingCardStyle}>暂无成员资料</div> : null}
        {props.totalPages > 1 ? (
          <div style={memberPaginationStyle}>
            <button
              type="button"
              style={memberPageButtonStyle}
              disabled={props.currentPage <= 1}
              onClick={() => props.onPageChange(Math.max(1, props.currentPage - 1))}
            >
              上一页
            </button>
            <button
              type="button"
              style={memberPageButtonStyle}
              disabled={props.currentPage >= props.totalPages}
              onClick={() => props.onPageChange(Math.min(props.totalPages, props.currentPage + 1))}
            >
              下一页
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function EditorModal({
  editor,
  onClose,
  onSaved,
  aboutEntries,
  historyEntries,
}: {
  editor: EditorState;
  onClose: () => void;
  onSaved: (kind: "about" | "history", payload: AboutEntry[] | HistoryEntry[]) => void;
  aboutEntries: AboutEntry[];
  historyEntries: HistoryEntry[];
}) {
  const [text, setText] = useState(
    editor?.kind === "about" ? editor.entry?.text || "" : editor?.entry?.text || "",
  );
  const [date, setDate] = useState(
    editor?.kind === "history" ? editor.entry?.date?.slice(0, 10) || "" : "",
  );
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    try {
      if (editor?.kind === "about") {
        await saveAboutEntry({ id: editor.entry?.id, text });
        const refreshed = await fetchAboutEntries();
        onSaved("about", refreshed);
        return;
      }
      await saveHistoryEntry({
        id: editor?.entry?.id,
        text,
        date,
        image: imageFile,
        remove_image: removeImage,
      });
      const refreshed = await fetchHistoryEntries();
      onSaved("history", refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={modalOverlayStyle}>
      <div style={modalCardStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <div style={sectionEyebrowStyle}>{editor?.mode === "add" ? "Create" : "Update"}</div>
            <h3 style={modalTitleStyle}>{editor?.kind === "about" ? "编辑简介" : "编辑历史"}</h3>
          </div>
          <button type="button" style={ghostButtonStyle} onClick={onClose}>
            Close
          </button>
        </div>
        <textarea value={text} onChange={(event) => setText(event.target.value)} style={textAreaStyle} />
        {editor?.kind === "history" ? (
          <>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} style={inputStyle} />
            <label style={fieldWrapStyle}>
              <span style={fieldLabelStyle}>故事图片</span>
              <input
                type="file"
                accept="image/*"
                style={inputStyle}
                onChange={(event) => setImageFile(event.target.files?.[0] || null)}
              />
            </label>
            {imageFile ? <div style={fieldHintStyle}>已选择：{imageFile.name}</div> : null}
            {editor.entry?.img && !removeImage ? (
              <div style={historyImageEditorStyle}>
                <img src={editor.entry.img} alt="" style={historyEditorPreviewStyle} />
                <label style={historyImageToggleStyle}>
                  <input
                    type="checkbox"
                    checked={removeImage}
                    onChange={(event) => setRemoveImage(event.target.checked)}
                  />
                  <span>移除当前图片</span>
                </label>
              </div>
            ) : null}
          </>
        ) : null}
        {error ? <div style={errorBannerStyle}>{error}</div> : null}
        <div style={modalActionsStyle}>
          <button type="button" style={ghostButtonStyle} onClick={onClose}>
            Cancel
          </button>
          <button type="button" style={primaryButtonStyle} onClick={() => void handleSubmit()} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

const pageStyle: CSSProperties = {
  minHeight: "calc(100vh - 60px)",
  background:
    "linear-gradient(180deg, color-mix(in srgb, var(--x-color-accent-soft) 72%, white), var(--x-color-canvas) 45%, white)",
  color: "var(--x-color-ink)",
  fontFamily: "var(--x-font-sans)",
  paddingBottom: "48px",
};

const sectionShellStyle: CSSProperties = {
  maxWidth: "1120px",
  margin: "34px auto 0",
  padding: "0 24px",
};

const sectionHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "12px",
  marginBottom: "18px",
};

const sectionEyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--x-color-accent)",
  fontWeight: 700,
};

const sectionTitleStyle: CSSProperties = {
  margin: "8px 0 0",
  fontSize: "30px",
};

const cardGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: "18px",
};

const featureCardStyle: CSSProperties = {
  borderRadius: "var(--x-radius-lg)",
  background: "linear-gradient(180deg, white, var(--x-color-panel-alt))",
  border: "1px solid var(--x-color-line)",
  boxShadow: "0 18px 40px var(--x-color-shadow)",
  padding: "22px",
};

const cardHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "10px",
  alignItems: "flex-start",
};

const cardMetaStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
};

const cardMetaPrimaryStyle: CSSProperties = {
  fontWeight: 700,
};

const cardMetaSecondaryStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
};

const cardActionsStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  flexShrink: 0,
};

const bodyTextStyle: CSSProperties = {
  margin: "18px 0 0",
  lineHeight: 1.9,
  whiteSpace: "pre-wrap",
  fontSize: "15px",
};

const timelineStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "18px",
};

function timelineCardStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "140px minmax(0, 1fr)",
    gap: "18px",
    alignItems: "start",
    borderRadius: "var(--x-radius-lg)",
    background: "linear-gradient(180deg, white, var(--x-color-panel-alt))",
    border: "1px solid var(--x-color-line)",
    boxShadow: "0 18px 40px var(--x-color-shadow)",
    padding: "22px",
  };
}

const timelineDateStyle: CSSProperties = {
  fontSize: "36px",
  fontWeight: 800,
  lineHeight: 1,
  color: "var(--x-color-accent-strong)",
};

const timelineBodyStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
};

const timelineDateSubStyle: CSSProperties = {
  color: "var(--x-color-ink-muted)",
  fontSize: "13px",
};

const historyImageStyle: CSSProperties = {
  width: "100%",
  marginTop: "18px",
  borderRadius: "var(--x-radius-md)",
  boxShadow: "0 16px 34px rgba(0,0,0,0.16)",
  objectFit: "cover",
  maxHeight: "360px",
};

const memberContainerStyle: CSSProperties = {
  borderRadius: "var(--x-radius-lg)",
  background: "linear-gradient(180deg, white, var(--x-color-panel-alt))",
  border: "1px solid var(--x-color-line)",
  boxShadow: "0 18px 40px var(--x-color-shadow)",
  padding: "22px",
};

const memberGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "16px",
};

const memberSummaryStyle: CSSProperties = {
  display: "flex",
  gap: "12px",
  flexWrap: "wrap",
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
};

const memberPaginationStyle: CSSProperties = {
  display: "flex",
  justifyContent: "center",
  gap: "10px",
  marginTop: "18px",
};

const memberPageButtonStyle: CSSProperties = {
  padding: "10px 14px",
  borderRadius: "999px",
  border: "1px solid var(--x-color-line-soft)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  fontWeight: 700,
  cursor: "pointer",
};

const loadingCardStyle: CSSProperties = {
  padding: "18px",
  borderRadius: "var(--x-radius-md)",
  background: "var(--x-color-panel)",
  border: "1px solid var(--x-color-line-soft)",
  color: "var(--x-color-ink-muted)",
};

const loadingBadgeStyle: CSSProperties = {
  position: "fixed",
  right: "24px",
  bottom: "24px",
  padding: "12px 18px",
  borderRadius: "999px",
  background: "var(--x-color-ink)",
  color: "white",
  boxShadow: "0 18px 40px rgba(0,0,0,0.22)",
};

const primaryButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: "999px",
  padding: "11px 16px",
  background: "var(--x-color-accent)",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
};

const ghostButtonStyle: CSSProperties = {
  border: "1px solid var(--x-color-line)",
  borderRadius: "999px",
  padding: "10px 14px",
  background: "white",
  color: "var(--x-color-ink)",
  fontWeight: 600,
  cursor: "pointer",
};

const dangerGhostButtonStyle: CSSProperties = {
  ...ghostButtonStyle,
  color: "var(--x-color-danger)",
  background: "var(--x-color-danger-soft)",
  border: "1px solid color-mix(in srgb, var(--x-color-danger) 35%, white)",
};

const errorBannerStyle: CSSProperties = {
  maxWidth: "1120px",
  margin: "18px auto 0",
  padding: "14px 18px",
  borderRadius: "var(--x-radius-md)",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
  border: "1px solid color-mix(in srgb, var(--x-color-danger) 28%, white)",
};

const successBannerStyle: CSSProperties = {
  maxWidth: "1120px",
  margin: "18px auto 0",
  padding: "14px 18px",
  borderRadius: "var(--x-radius-md)",
  background: "var(--x-color-success-soft)",
  color: "var(--x-color-success)",
  border: "1px solid color-mix(in srgb, var(--x-color-success) 28%, white)",
};

const modalOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(8,15,25,0.48)",
  display: "grid",
  placeItems: "center",
  padding: "24px",
  zIndex: 40,
};

const modalCardStyle: CSSProperties = {
  width: "min(720px, 100%)",
  borderRadius: "var(--x-radius-lg)",
  background: "white",
  padding: "24px",
  boxShadow: "0 30px 80px rgba(0,0,0,0.28)",
};

const modalTitleStyle: CSSProperties = {
  margin: "8px 0 0",
  fontSize: "26px",
};

const textAreaStyle: CSSProperties = {
  width: "100%",
  minHeight: "220px",
  borderRadius: "var(--x-radius-md)",
  border: "1px solid var(--x-color-line)",
  padding: "14px 16px",
  marginTop: "18px",
  resize: "vertical",
  font: "inherit",
  lineHeight: 1.8,
  boxSizing: "border-box",
};

const inputStyle: CSSProperties = {
  width: "100%",
  borderRadius: "var(--x-radius-md)",
  border: "1px solid var(--x-color-line)",
  padding: "12px 14px",
  marginTop: "14px",
  font: "inherit",
  boxSizing: "border-box",
};

const fieldWrapStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
  marginTop: "14px",
};

const fieldLabelStyle: CSSProperties = {
  fontSize: "13px",
  fontWeight: 700,
  color: "var(--x-color-ink)",
};

const fieldHintStyle: CSSProperties = {
  marginTop: "10px",
  fontSize: "13px",
  color: "var(--x-color-ink-muted)",
};

const historyImageEditorStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
  marginTop: "14px",
};

const historyEditorPreviewStyle: CSSProperties = {
  width: "100%",
  maxHeight: "240px",
  objectFit: "cover",
  borderRadius: "var(--x-radius-md)",
  border: "1px solid var(--x-color-line-soft)",
};

const historyImageToggleStyle: CSSProperties = {
  display: "flex",
  gap: "8px",
  alignItems: "center",
  color: "var(--x-color-ink-muted)",
};

const modalActionsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "10px",
  marginTop: "18px",
};
