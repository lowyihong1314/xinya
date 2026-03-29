import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { getUserPermissionNames } from "../../app/permissions";
import { useUserState } from "../../app/UserState";
import { CachedImage } from "../../components/CachedMedia";
import { PageHero } from "../../components/PageHero";
import { UserCard } from "../../CRM/user_control/react/UserControlView";
import { fetchAllUsers } from "../../CRM/user_control/react/api";
import type { UserRecord } from "../../CRM/user_control/react/types";
import { ensureDesignTokens } from "../../theme/designTokens";
import {
  createTreeHoleEntry,
  deleteTreeHoleEntry,
  deleteAboutEntry,
  deleteHistoryEntry,
  fetchAboutEntries,
  fetchHistoryEntries,
  fetchTreeHoleEntries,
  saveAboutEntry,
  saveHistoryEntry,
  updateTreeHoleEntry,
} from "./api";
import type { AboutEntry, HistoryEntry, TreeHoleEntry } from "./types";

const MEMBERS_PAGE_SIZE = 4;

const INFO_SECTION_ITEMS = [
  {
    key: "history",
    title: "地南佛学会历程",
    eyebrow: "History",
    subtitle: "沿着年份回看地南佛学会的重要节点与故事。",
  },
  {
    key: "about",
    title: "我们的简介",
    eyebrow: "About",
    subtitle: "认识地南佛学会的宗旨、气质与日常面貌。",
  },
  {
    key: "members",
    title: "成员",
    eyebrow: "Members",
    subtitle: "浏览成员资料与彼此当前的公共展示信息。",
  },
  {
    key: "tree-hole",
    title: "树洞",
    eyebrow: "Tree Hole",
    subtitle: "先把子路由和页面骨架搭好，后续再接内容流。",
  },
] as const;

type InfoSectionKey = (typeof INFO_SECTION_ITEMS)[number]["key"];

type EditorState =
  | { kind: "about"; mode: "add" | "edit"; entry?: AboutEntry }
  | { kind: "history"; mode: "add" | "edit"; entry?: HistoryEntry }
  | null;

export function InfoPage() {
  ensureDesignTokens();

  const { section = "history" } = useParams();
  const { user, isAuthenticated, isMobile } = useUserState();
  const [aboutEntries, setAboutEntries] = useState<AboutEntry[]>([]);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [members, setMembers] = useState<UserRecord[]>([]);
  const [treeHoleEntries, setTreeHoleEntries] = useState<TreeHoleEntry[]>([]);
  const [treeHoleLoading, setTreeHoleLoading] = useState(false);
  const [memberPage, setMemberPage] = useState(1);
  const [activeMemberGroup, setActiveMemberGroup] = useState<string>("");
  const [editor, setEditor] = useState<EditorState>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const permissionNames = useMemo(() => getUserPermissionNames(user), [user]);
  const canManageTreeHole = permissionNames.has("info_tree_hole");

  const activeSection = isInfoSectionKey(section) ? section : "history";
  const activeSectionItem = INFO_SECTION_ITEMS.find((item) => item.key === activeSection) ?? INFO_SECTION_ITEMS[0];

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    setEditor(null);
  }, [activeSection]);

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

  const memberGroups = useMemo(() => buildMemberGroups(sortedMembers), [sortedMembers]);
  const currentMemberGroup =
    memberGroups.find((group) => group.key === activeMemberGroup) ?? memberGroups[0] ?? null;
  const memberTotalPages = Math.max(
    1,
    Math.ceil((currentMemberGroup?.users.length ?? 0) / MEMBERS_PAGE_SIZE),
  );
  const pagedMembers = useMemo(() => {
    const start = (memberPage - 1) * MEMBERS_PAGE_SIZE;
    return (currentMemberGroup?.users ?? []).slice(start, start + MEMBERS_PAGE_SIZE);
  }, [currentMemberGroup, memberPage]);

  useEffect(() => {
    setMemberPage(1);
  }, [members]);

  useEffect(() => {
    if (!memberGroups.length) {
      if (activeMemberGroup) {
        setActiveMemberGroup("");
      }
      return;
    }
    if (!memberGroups.some((group) => group.key === activeMemberGroup)) {
      setActiveMemberGroup(memberGroups[0].key);
    }
  }, [activeMemberGroup, memberGroups]);

  useEffect(() => {
    setMemberPage((prev) => Math.min(prev, memberTotalPages));
  }, [memberTotalPages]);

  useEffect(() => {
    setMemberPage(1);
  }, [activeMemberGroup]);

  useEffect(() => {
    if (activeSection !== "tree-hole" || !canManageTreeHole) {
      return;
    }
    void loadTreeHoleEntries();
  }, [activeSection, canManageTreeHole]);

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

  async function loadTreeHoleEntries() {
    if (!canManageTreeHole) {
      return;
    }
    setTreeHoleLoading(true);
    try {
      const entries = await fetchTreeHoleEntries();
      setTreeHoleEntries(Array.isArray(entries) ? entries : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "树洞留言加载失败");
    } finally {
      setTreeHoleLoading(false);
    }
  }

  async function handleCreateTreeHole(input: { author_name?: string; message: string }) {
    await createTreeHoleEntry(input);
    setMessage("树洞留言已送出");
    if (canManageTreeHole) {
      await loadTreeHoleEntries();
    }
  }

  async function handleUpdateTreeHole(
    id: number,
    input: { author_name?: string; message: string; display: boolean; is_spam: boolean },
  ) {
    const result = await updateTreeHoleEntry(id, input);
    if (result.data) {
      setTreeHoleEntries((prev) => prev.map((entry) => (entry.id === id ? result.data || entry : entry)));
    } else {
      await loadTreeHoleEntries();
    }
    setMessage("树洞留言已更新");
  }

  async function handleDeleteTreeHole(id: number) {
    await deleteTreeHoleEntry(id);
    setTreeHoleEntries((prev) => prev.filter((entry) => entry.id !== id));
    setMessage("树洞留言已删除");
  }

  if (!isInfoSectionKey(section)) {
    return <Navigate to="/info/history" replace />;
  }

  return (
    <div style={pageStyle}>
      <PageHero title={activeSectionItem.title} subtitle="地南佛学会" />

      <section style={sectionShellStyle}>
        <div style={sectionNavGridStyle(isMobile)}>
          {INFO_SECTION_ITEMS.map((item) => (
            <Link
              key={item.key}
              to={`/info/${item.key}`}
              style={sectionNavCardStyle(item.key === activeSection)}
              aria-current={item.key === activeSection ? "page" : undefined}
            >
              <div style={sectionNavEyebrowStyle}>{item.eyebrow}</div>
              <div style={sectionNavTitleStyle}>{item.title}</div>
              <div style={sectionNavSubtitleStyle}>{item.subtitle}</div>
            </Link>
          ))}
        </div>
      </section>

      {error ? <div style={errorBannerStyle}>{error}</div> : null}
      {message ? <div style={successBannerStyle}>{message}</div> : null}

      {activeSection === "history" ? (
        <HistorySection
          isAuthenticated={isAuthenticated}
          isMobile={isMobile}
          entries={historyEntries}
          onAdd={() => setEditor({ kind: "history", mode: "add" })}
          onEdit={(entry) => setEditor({ kind: "history", mode: "edit", entry })}
          onDelete={handleDeleteHistory}
        />
      ) : null}

      {activeSection === "about" ? (
        <AboutSection
          isAuthenticated={isAuthenticated}
          entries={aboutEntries}
          onAdd={() => setEditor({ kind: "about", mode: "add" })}
          onEdit={(entry) => setEditor({ kind: "about", mode: "edit", entry })}
          onDelete={handleDeleteAbout}
        />
      ) : null}

      {activeSection === "members" ? (
        <MembersSection
          groups={memberGroups}
          activeGroup={activeMemberGroup}
          members={pagedMembers}
          currentPage={memberPage}
          totalPages={memberTotalPages}
          totalCount={currentMemberGroup?.users.length ?? 0}
          allCount={sortedMembers.length}
          onGroupChange={setActiveMemberGroup}
          onPageChange={setMemberPage}
        />
      ) : null}

      {activeSection === "tree-hole" ? (
        <TreeHoleSection
          canManage={canManageTreeHole}
          entries={treeHoleEntries}
          loading={treeHoleLoading}
          onCreate={handleCreateTreeHole}
          onRefresh={loadTreeHoleEntries}
          onUpdate={handleUpdateTreeHole}
          onDelete={handleDeleteTreeHole}
        />
      ) : null}

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
              {entry.img ? <CachedImage src={entry.img} alt="" style={historyImageStyle} /> : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function MembersSection(props: {
  groups: { key: string; label: string; users: UserRecord[] }[];
  activeGroup: string;
  members: UserRecord[];
  currentPage: number;
  totalPages: number;
  totalCount: number;
  allCount: number;
  onGroupChange: (group: string) => void;
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
          <span>共 {props.allCount} 位展示成员</span>
          <span>
            第 {props.currentPage} / {props.totalPages} 页
          </span>
        </div>
      </div>

      <div style={memberContainerStyle}>
        {props.groups.length ? (
          <div style={memberGroupBarStyle}>
            {props.groups.map((group) => (
              <button
                key={group.key}
                type="button"
                style={memberGroupButtonStyle(group.key === props.activeGroup)}
                onClick={() => props.onGroupChange(group.key)}
              >
                <span>{group.label}</span>
                <span style={memberGroupCountStyle}>{group.users.length}</span>
              </button>
            ))}
          </div>
        ) : null}
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

function TreeHoleSection(props: {
  canManage: boolean;
  entries: TreeHoleEntry[];
  loading: boolean;
  onCreate: (input: { author_name?: string; message: string }) => Promise<void>;
  onRefresh: () => Promise<void>;
  onUpdate: (id: number, input: { author_name?: string; message: string; display: boolean; is_spam: boolean }) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [authorName, setAuthorName] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingAuthorName, setEditingAuthorName] = useState("");
  const [editingMessage, setEditingMessage] = useState("");
  const [editingDisplay, setEditingDisplay] = useState(true);
  const [editingSpam, setEditingSpam] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    setSubmitMessage(null);
    try {
      await props.onCreate({
        author_name: authorName.trim() || undefined,
        message: draftMessage.trim(),
      });
      setAuthorName("");
      setDraftMessage("");
      setSubmitMessage("留言已经送出，内容仅提供给有权限的管理员查看。");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "留言提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(entry: TreeHoleEntry) {
    setEditingId(entry.id);
    setEditingAuthorName(entry.author_name || "");
    setEditingMessage(entry.message || "");
    setEditingDisplay(Boolean(entry.display));
    setEditingSpam(Boolean(entry.is_spam));
  }

  function stopEdit() {
    setEditingId(null);
    setEditingAuthorName("");
    setEditingMessage("");
    setEditingDisplay(true);
    setEditingSpam(false);
  }

  async function handleSaveEdit(entryId: number) {
    setSavingEdit(true);
    try {
      await props.onUpdate(entryId, {
        author_name: editingAuthorName.trim() || undefined,
        message: editingMessage.trim(),
        display: editingDisplay,
        is_spam: editingSpam,
      });
      stopEdit();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "留言更新失败");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(entryId: number) {
    if (!window.confirm("确认删除这条树洞留言？")) return;
    try {
      await props.onDelete(entryId);
      if (editingId === entryId) {
        stopEdit();
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "留言删除失败");
    }
  }

  return (
    <section style={sectionShellStyle}>
      <div style={sectionHeaderStyle}>
        <div>
          <div style={sectionEyebrowStyle}>Tree Hole</div>
          <h2 style={sectionTitleStyle}>树洞</h2>
        </div>
      </div>

      <div style={treeHoleLayoutStyle}>
        <article style={treeHoleFormCardStyle}>
          <div style={placeholderBadgeStyle}>Public Submit</div>
          <h3 style={placeholderTitleStyle}>给树洞留一句话</h3>
          <p style={placeholderBodyStyle}>
            不管有没有登录都可以留言。系统不会收集你的账号名称，默认也不会公开展示，只有带 `info_tree_hole` 权限的人才看得到并能管理内容。
          </p>
          <label style={fieldWrapStyle}>
            <span style={fieldLabelStyle}>称呼 / 昵称</span>
            <input
              value={authorName}
              onChange={(event) => setAuthorName(event.target.value)}
              placeholder="可留空，系统会记作匿名"
              style={inputStyle}
            />
          </label>
          <label style={fieldWrapStyle}>
            <span style={fieldLabelStyle}>留言内容</span>
            <textarea
              value={draftMessage}
              onChange={(event) => setDraftMessage(event.target.value)}
              placeholder="把想说的话留在这里"
              style={treeHoleTextAreaStyle}
            />
          </label>
          {submitError ? <div style={errorBannerStyle}>{submitError}</div> : null}
          {submitMessage ? <div style={successBannerStyle}>{submitMessage}</div> : null}
          <div style={treeHoleFormActionsStyle}>
            <button
              type="button"
              style={primaryButtonStyle}
              disabled={submitting || !draftMessage.trim()}
              onClick={() => void handleSubmit()}
            >
              {submitting ? "提交中..." : "送出留言"}
            </button>
          </div>
        </article>

        {props.canManage ? (
          <article style={treeHoleHintCardStyle}>
            <div style={placeholderBadgeStyle}>Manager</div>
            <h3 style={placeholderTitleStyle}>树洞管理区</h3>
            <p style={placeholderBodyStyle}>
              你当前拥有 info_tree_hole 权限，可以查看、编辑、隐藏或删除所有留言。
            </p>
            <div style={treeHoleManagerSummaryStyle}>
              <span>当前 {props.entries.length} 条留言</span>
              <button type="button" style={ghostButtonStyle} onClick={() => void props.onRefresh()}>
                刷新列表
              </button>
            </div>
          </article>
        ) : null}
      </div>

      {props.canManage ? (
        <div style={treeHoleManagerListStyle}>
          {props.loading ? <div style={loadingCardStyle}>正在读取树洞留言…</div> : null}
          {!props.loading && !props.entries.length ? <div style={loadingCardStyle}>还没有新的树洞留言</div> : null}
          {props.entries.map((entry) => {
            const editing = editingId === entry.id;
            return (
              <article key={entry.id} style={featureCardStyle}>
                <div style={cardHeaderStyle}>
                  <div style={cardMetaStyle}>
                    <div style={cardMetaPrimaryStyle}>
                      {entry.author_name || "匿名留言"}
                    </div>
                    <div style={cardMetaSecondaryStyle}>
                      {formatTreeHoleMeta(entry)}
                    </div>
                  </div>
                  <div style={cardActionsStyle}>
                    {!editing ? (
                      <button type="button" style={ghostButtonStyle} onClick={() => startEdit(entry)}>
                        Edit
                      </button>
                    ) : null}
                    <button type="button" style={dangerGhostButtonStyle} onClick={() => void handleDelete(entry.id)}>
                      Delete
                    </button>
                  </div>
                </div>

                <div style={treeHoleChipRowStyle}>
                  {!entry.display ? <span style={treeHoleChipStyle("muted")}>已隐藏</span> : null}
                  {entry.is_spam ? <span style={treeHoleChipStyle("danger")}>垃圾留言</span> : null}
                </div>

                {editing ? (
                  <div style={treeHoleEditWrapStyle}>
                    <label style={fieldWrapStyle}>
                      <span style={fieldLabelStyle}>称呼 / 昵称</span>
                      <input
                        value={editingAuthorName}
                        onChange={(event) => setEditingAuthorName(event.target.value)}
                        style={inputStyle}
                      />
                    </label>
                    <label style={fieldWrapStyle}>
                      <span style={fieldLabelStyle}>留言内容</span>
                      <textarea
                        value={editingMessage}
                        onChange={(event) => setEditingMessage(event.target.value)}
                        style={treeHoleTextAreaStyle}
                      />
                    </label>
                    <label style={treeHoleCheckboxStyle}>
                      <input
                        type="checkbox"
                        checked={editingDisplay}
                        onChange={(event) => setEditingDisplay(event.target.checked)}
                      />
                      <span>保留显示</span>
                    </label>
                    <label style={treeHoleCheckboxStyle}>
                      <input
                        type="checkbox"
                        checked={editingSpam}
                        onChange={(event) => setEditingSpam(event.target.checked)}
                      />
                      <span>标记为垃圾留言</span>
                    </label>
                    <div style={treeHoleFormActionsStyle}>
                      <button type="button" style={ghostButtonStyle} onClick={stopEdit}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        style={primaryButtonStyle}
                        disabled={savingEdit || !editingMessage.trim()}
                        onClick={() => void handleSaveEdit(entry.id)}
                      >
                        {savingEdit ? "保存中..." : "保存"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p style={bodyTextStyle}>{entry.message}</p>
                )}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function EditorModal({
  editor,
  onClose,
  onSaved,
}: {
  editor: EditorState;
  onClose: () => void;
  onSaved: (kind: "about" | "history", payload: AboutEntry[] | HistoryEntry[]) => void;
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
                <CachedImage src={editor.entry.img} alt="" style={historyEditorPreviewStyle} />
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

function isInfoSectionKey(value: string | undefined): value is InfoSectionKey {
  return INFO_SECTION_ITEMS.some((item) => item.key === value);
}

function buildMemberGroups(members: UserRecord[]) {
  const groupMap = new Map<string, { key: string; label: string; users: UserRecord[] }>();

  for (const member of members) {
    const groupNames = getMemberGroupNames(member);
    for (const groupName of groupNames) {
      if (!groupMap.has(groupName)) {
        groupMap.set(groupName, { key: groupName, label: groupName, users: [] });
      }
      groupMap.get(groupName)?.users.push(member);
    }
  }

  return [...groupMap.values()].sort((left, right) => {
    const leftRank = getMemberGroupRank(left.label);
    const rightRank = getMemberGroupRank(right.label);
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    if (left.users.length !== right.users.length) {
      return right.users.length - left.users.length;
    }
    return left.label.localeCompare(right.label, "zh-CN");
  });
}

function getMemberGroupNames(member: UserRecord) {
  const names = new Set<string>();

  for (const department of member.departments ?? []) {
    const name = String(department.name || "").trim();
    if (!name) continue;
    if (name.startsWith("理事会")) {
      names.add("理事会");
      continue;
    }
    if (name.startsWith("青芽小组")) {
      names.add("青芽小组");
      continue;
    }
    names.add(name);
  }

  if (!names.size) {
    names.add("未分组");
  }

  return [...names];
}

function getMemberGroupRank(groupName: string) {
  if (groupName === "青芽") return 8;
  if (groupName === "未分组") return 9;
  if (groupName === "理事会") return 1;
  if (groupName === "青芽小组") return 2;
  if (groupName === "青芽干部") return 3;
  return 4;
}

function formatTreeHoleMeta(entry: TreeHoleEntry) {
  const parts = [];
  if (entry.created_at) {
    parts.push(new Date(entry.created_at).toLocaleString("zh-CN"));
  }
  if (entry.ip) {
    parts.push(`IP ${entry.ip}`);
  }
  return parts.join(" · ");
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

function sectionNavGridStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "repeat(4, minmax(0, 1fr))",
    gap: "16px",
  };
}

function sectionNavCardStyle(active: boolean): CSSProperties {
  return {
    display: "grid",
    gap: "10px",
    padding: "20px",
    textDecoration: "none",
    borderRadius: "var(--x-radius-lg)",
    border: active ? "1px solid color-mix(in srgb, var(--x-color-accent) 38%, white)" : "1px solid var(--x-color-line)",
    background: active
      ? "linear-gradient(145deg, color-mix(in srgb, var(--x-color-accent-soft) 72%, white), white)"
      : "linear-gradient(180deg, white, var(--x-color-panel-alt))",
    boxShadow: active ? "0 22px 50px color-mix(in srgb, var(--x-color-accent) 16%, transparent)" : "0 18px 40px var(--x-color-shadow)",
    color: "var(--x-color-ink)",
  };
}

const sectionNavEyebrowStyle: CSSProperties = {
  fontSize: "12px",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--x-color-accent)",
  fontWeight: 800,
};

const sectionNavTitleStyle: CSSProperties = {
  fontSize: "20px",
  fontWeight: 800,
  lineHeight: 1.2,
};

const sectionNavSubtitleStyle: CSSProperties = {
  fontSize: "14px",
  lineHeight: 1.7,
  color: "var(--x-color-ink-muted)",
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

const memberGroupBarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
  marginBottom: "18px",
};

function memberGroupButtonStyle(active: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "10px",
    padding: "10px 14px",
    borderRadius: "999px",
    border: active
      ? "1px solid color-mix(in srgb, var(--x-color-accent) 38%, white)"
      : "1px solid var(--x-color-line-soft)",
    background: active
      ? "linear-gradient(135deg, color-mix(in srgb, var(--x-color-accent-soft) 72%, white), white)"
      : "var(--x-color-panel)",
    color: "var(--x-color-ink)",
    fontWeight: 700,
    cursor: "pointer",
  };
}

const memberGroupCountStyle: CSSProperties = {
  minWidth: "22px",
  padding: "2px 8px",
  borderRadius: "999px",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink-muted)",
  fontSize: "12px",
  textAlign: "center",
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

const placeholderPanelStyle: CSSProperties = {
  borderRadius: "var(--x-radius-lg)",
  background: "linear-gradient(145deg, white, color-mix(in srgb, var(--x-color-info-soft) 48%, white))",
  border: "1px solid color-mix(in srgb, var(--x-color-info) 18%, white)",
  boxShadow: "0 18px 40px var(--x-color-shadow)",
  padding: "28px",
};

const placeholderBadgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "8px 12px",
  borderRadius: "999px",
  background: "var(--x-color-info-soft)",
  color: "var(--x-color-info)",
  fontSize: "12px",
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const placeholderTitleStyle: CSSProperties = {
  margin: "18px 0 0",
  fontSize: "28px",
};

const placeholderBodyStyle: CSSProperties = {
  margin: "14px 0 0",
  maxWidth: "640px",
  lineHeight: 1.8,
  color: "var(--x-color-ink-muted)",
};

const treeHoleLayoutStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: "18px",
};

const treeHoleFormCardStyle: CSSProperties = {
  ...featureCardStyle,
  alignContent: "start",
};

const treeHoleHintCardStyle: CSSProperties = {
  ...placeholderPanelStyle,
  alignContent: "start",
};

const treeHoleTextAreaStyle: CSSProperties = {
  ...textAreaStyle,
  minHeight: "180px",
  marginTop: 0,
};

const treeHoleFormActionsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "10px",
  marginTop: "18px",
};

const treeHoleManagerSummaryStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  marginTop: "18px",
  flexWrap: "wrap",
  color: "var(--x-color-ink-muted)",
};

const treeHoleManagerListStyle: CSSProperties = {
  display: "grid",
  gap: "18px",
  marginTop: "22px",
};

const treeHoleChipRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
  marginTop: "14px",
};

function treeHoleChipStyle(kind: "info" | "danger" | "muted"): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "6px 10px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 700,
    background:
      kind === "danger"
        ? "var(--x-color-danger-soft)"
        : kind === "info"
          ? "var(--x-color-info-soft)"
          : "var(--x-color-panel-alt)",
    color:
      kind === "danger"
        ? "var(--x-color-danger)"
        : kind === "info"
          ? "var(--x-color-info)"
          : "var(--x-color-ink-muted)",
  };
}

const treeHoleEditWrapStyle: CSSProperties = {
  display: "grid",
  gap: "12px",
  marginTop: "16px",
};

const treeHoleCheckboxStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  color: "var(--x-color-ink-muted)",
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
