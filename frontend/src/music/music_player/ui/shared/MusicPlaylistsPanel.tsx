import type { CSSProperties } from "react";

import type { MusicRecord, PlaylistRecord } from "../../logic/types";
import type { PlaylistNotice } from "../../logic/useMusicPlaylists";
import { buildMusicCoverCacheKey } from "../../logic/musicCoverUtils";
import { MusicCoverImage } from "./MusicCoverImage";

type Props = {
  isMobile: boolean;
  enabled: boolean;
  loading: boolean;
  busy: boolean;
  notice: PlaylistNotice;
  playlists: PlaylistRecord[];
  /** 别人设为公开的歌单，只读。 */
  publicPlaylists?: PlaylistRecord[];
  selectedPlaylist: PlaylistRecord | null;
  currentMusicId: number | null;
  currentUserId: number | null;
  resolveTracks: (playlist: PlaylistRecord | null) => MusicRecord[];
  onSelectPlaylist: (playlistId: number | null) => void;
  onCreate: () => void;
  onRename: (playlist: PlaylistRecord) => void;
  onDelete: (playlist: PlaylistRecord) => void;
  onLeave: (playlist: PlaylistRecord) => void;
  onPlayPlaylist: (playlist: PlaylistRecord, startMusicId?: number) => void;
  onQueuePlaylist?: (playlist: PlaylistRecord) => void;
  onRemoveTrack: (playlist: PlaylistRecord, musicId: number) => void;
  onMoveTrack: (playlist: PlaylistRecord, musicId: number, direction: -1 | 1) => void;
  onAddCurrentTrack?: (playlist: PlaylistRecord) => void;
  onAddMember: (playlist: PlaylistRecord) => void;
  onRemoveMember: (playlist: PlaylistRecord, userId: number, label: string) => void;
  onTogglePublic?: (playlist: PlaylistRecord) => void;
};

export function MusicPlaylistsPanel({
  isMobile,
  enabled,
  loading,
  busy,
  notice,
  playlists,
  publicPlaylists = [],
  selectedPlaylist,
  currentMusicId,
  currentUserId,
  resolveTracks,
  onSelectPlaylist,
  onCreate,
  onRename,
  onDelete,
  onLeave,
  onPlayPlaylist,
  onQueuePlaylist,
  onRemoveTrack,
  onMoveTrack,
  onAddCurrentTrack,
  onAddMember,
  onRemoveMember,
  onTogglePublic,
}: Props) {
  if (!enabled) {
    return (
      <section style={shellStyle(isMobile)}>
        <div style={emptyStyle}>登录后就可以建立自己的歌单，并和其他人共用。</div>
      </section>
    );
  }

  const tracks = resolveTracks(selectedPlaylist);
  const isOwner = Boolean(selectedPlaylist && currentUserId != null && selectedPlaylist.owner_id === currentUserId);
  // 别人的公开歌单：只能播和加入列队。
  const canEdit = Boolean(selectedPlaylist && (selectedPlaylist.can_edit ?? true));

  return (
    <section style={shellStyle(isMobile)}>
      <div style={heroStyle(isMobile)}>
        <div>
          <div style={eyebrowStyle}>My Playlists</div>
          <div style={titleStyle}>{selectedPlaylist ? selectedPlaylist.name : "我的歌单"}</div>
          <div style={copyStyle}>
            {selectedPlaylist
              ? canEdit
                ? `${tracks.length} 首 · ${selectedPlaylist.members?.length || 1} 位成员${isOwner ? " · 我创建的" : ""}${selectedPlaylist.is_public ? " · 公开" : ""}`
                : `${tracks.length} 首 · ${selectedPlaylist.owner_name || "其他人"} 的公开歌单`
              : playlists.length
                ? `${playlists.length} 个歌单。歌单可以和其他人共用，成员都能加歌和播放。`
                : "还没有歌单。新建一个，或在歌曲旁点「+歌单」。"}
          </div>
        </div>
        <div style={heroActionsStyle}>
          {selectedPlaylist ? (
            <>
              <button type="button" style={ghostButtonStyle} onClick={() => onSelectPlaylist(null)}>
                <i className="fas fa-arrow-left" />
                <span>全部歌单</span>
              </button>
              <button
                type="button"
                style={primaryButtonStyle}
                disabled={!tracks.length || busy}
                onClick={() => onPlayPlaylist(selectedPlaylist)}
              >
                <i className="fas fa-play" />
                <span>播放全部</span>
              </button>
            </>
          ) : (
            <button type="button" style={primaryButtonStyle} disabled={busy} onClick={onCreate}>
              <i className="fas fa-plus" />
              <span>新建歌单</span>
            </button>
          )}
        </div>
      </div>

      {notice ? <div style={noticeStyle(notice.type)}>{notice.text}</div> : null}
      {loading && !playlists.length ? <div style={emptyStyle}>读取歌单中…</div> : null}

      {!selectedPlaylist ? (
        <>
          {playlists.length ? (
            <div style={listStyle}>
              {playlists.map((playlist) => {
                const count = playlist.music_ids?.length || 0;
                const mine = currentUserId != null && playlist.owner_id === currentUserId;
                return (
                  <article key={playlist.id} style={cardStyle(isMobile)}>
                    <button type="button" style={cardMainButtonStyle} onClick={() => onSelectPlaylist(playlist.id)}>
                      <span style={cardIconStyle}>
                        <i className="fas fa-list-music" />
                      </span>
                      <span style={cardTextStyle}>
                        <span style={cardNameStyle}>{playlist.name}</span>
                        <span style={cardMetaStyle}>
                          {count} 首 · {playlist.members?.length || 1} 位成员{mine ? "" : " · 共享给我"}{playlist.is_public ? " · 公开" : ""}
                        </span>
                      </span>
                    </button>
                    <div style={cardActionsStyle}>
                      <button
                        type="button"
                        style={smallButtonStyle}
                        disabled={!count || busy}
                        onClick={() => onPlayPlaylist(playlist)}
                        title="播放全部"
                      >
                        <i className="fas fa-play" />
                      </button>
                      {onAddCurrentTrack && currentMusicId != null ? (
                        <button
                          type="button"
                          style={smallButtonStyle}
                          disabled={busy}
                          onClick={() => onAddCurrentTrack(playlist)}
                          title="把正在播放的歌加进来"
                        >
                          <i className="fas fa-plus" />
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}

          {publicPlaylists.length ? (
            <>
              <div style={sectionDividerStyle}>
                <i className="fas fa-globe" style={{ marginRight: "6px" }} />
                别人的公开歌单
              </div>
              <div style={listStyle}>
                {publicPlaylists.map((playlist) => {
                  const count = playlist.music_ids?.length || 0;
                  return (
                    <article key={playlist.id} style={cardStyle(isMobile)}>
                      <button type="button" style={cardMainButtonStyle} onClick={() => onSelectPlaylist(playlist.id)}>
                        <span style={{ ...cardIconStyle, background: "var(--x-color-panel-alt)", color: "var(--x-color-ink-muted)" }}>
                          <i className="fas fa-globe" />
                        </span>
                        <span style={cardTextStyle}>
                          <span style={cardNameStyle}>{playlist.name}</span>
                          <span style={cardMetaStyle}>
                            {count} 首 · {playlist.owner_name || "其他人"}
                          </span>
                        </span>
                      </button>
                      <div style={cardActionsStyle}>
                        <button
                          type="button"
                          style={smallButtonStyle}
                          disabled={!count || busy}
                          onClick={() => onPlayPlaylist(playlist)}
                          title="播放全部"
                        >
                          <i className="fas fa-play" />
                        </button>
                        {onQueuePlaylist ? (
                          <button
                            type="button"
                            style={smallButtonStyle}
                            disabled={!count || busy}
                            onClick={() => onQueuePlaylist(playlist)}
                            title="加入列队"
                          >
                            <i className="fas fa-list-ul" />
                          </button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          ) : null}
        </>
      ) : (
        <>
          <div style={toolbarStyle}>
            {onQueuePlaylist ? (
              <button type="button" style={smallTextButtonStyle} disabled={!tracks.length || busy} onClick={() => onQueuePlaylist(selectedPlaylist)}>
                <i className="fas fa-list-ul" /> 加入列队
              </button>
            ) : null}
            {canEdit && onAddCurrentTrack && currentMusicId != null ? (
              <button type="button" style={smallTextButtonStyle} disabled={busy} onClick={() => onAddCurrentTrack(selectedPlaylist)}>
                <i className="fas fa-plus" /> 加入正在播放的歌
              </button>
            ) : null}
            {canEdit ? (
              <button type="button" style={smallTextButtonStyle} disabled={busy} onClick={() => onRename(selectedPlaylist)}>
                <i className="fas fa-pen" /> 重命名
              </button>
            ) : null}
            {isOwner && onTogglePublic ? (
              <button type="button" style={smallTextButtonStyle} disabled={busy} onClick={() => onTogglePublic(selectedPlaylist)}>
                <i className={selectedPlaylist.is_public ? "fas fa-lock" : "fas fa-globe"} /> {selectedPlaylist.is_public ? "改为私有" : "设为公开"}
              </button>
            ) : null}
            {canEdit ? (
              isOwner ? (
                <button type="button" style={dangerTextButtonStyle} disabled={busy} onClick={() => onDelete(selectedPlaylist)}>
                  <i className="fas fa-trash" /> 删除歌单
                </button>
              ) : (
                <button type="button" style={dangerTextButtonStyle} disabled={busy} onClick={() => onLeave(selectedPlaylist)}>
                  <i className="fas fa-right-from-bracket" /> 退出歌单
                </button>
              )
            ) : null}
          </div>

          {canEdit ? (
          <div style={membersBoxStyle}>
            <div style={membersHeaderStyle}>
              <span style={membersTitleStyle}>成员</span>
              {isOwner ? (
                <button type="button" style={smallTextButtonStyle} disabled={busy} onClick={() => onAddMember(selectedPlaylist)}>
                  <i className="fas fa-user-plus" /> 添加成员
                </button>
              ) : null}
            </div>
            <div style={memberChipsStyle}>
              {(selectedPlaylist.members || []).map((member) => {
                const label = member.display_name || member.username || `用户 #${member.id}`;
                const removable = isOwner && !member.is_owner;
                return (
                  <span key={member.id} style={memberChipStyle(Boolean(member.is_owner))}>
                    {member.is_owner ? <i className="fas fa-crown" style={{ marginRight: 5 }} /> : null}
                    {label}
                    {removable ? (
                      <button
                        type="button"
                        style={memberRemoveStyle}
                        disabled={busy}
                        onClick={() => onRemoveMember(selectedPlaylist, member.id, label)}
                        aria-label={`移除 ${label}`}
                        title="移出歌单"
                      >
                        ×
                      </button>
                    ) : null}
                  </span>
                );
              })}
            </div>
          </div>
          ) : null}

          {tracks.length ? (
            <div style={listStyle}>
              {tracks.map((music, index) => {
                const active = music.id === currentMusicId;
                return (
                  <article key={music.id} style={rowStyle(active, isMobile)}>
                    <button type="button" style={rowPlayButtonStyle} onClick={() => onPlayPlaylist(selectedPlaylist, music.id)}>
                      <span style={rowIndexStyle(active)}>{String(index + 1).padStart(2, "0")}</span>
                      <span style={rowCoverStyle}>
                        <MusicCoverImage
                          source={music.album || music.cover_url}
                          cacheKey={buildMusicCoverCacheKey("playlist-row", music.id)}
                          alt={music.title}
                          style={rowCoverImgStyle}
                        />
                      </span>
                      <span style={rowTextStyle}>
                        <span style={rowNameStyle(active)}>{music.title}</span>
                        <span style={rowSubStyle}>{music.album?.name || "未分配专辑"}</span>
                      </span>
                    </button>
                    {canEdit ? (
                      <div style={rowActionsStyle}>
                        <button type="button" style={smallButtonStyle} disabled={busy || index === 0} onClick={() => onMoveTrack(selectedPlaylist, music.id, -1)} title="上移">
                          <i className="fas fa-arrow-up" />
                        </button>
                        <button type="button" style={smallButtonStyle} disabled={busy || index === tracks.length - 1} onClick={() => onMoveTrack(selectedPlaylist, music.id, 1)} title="下移">
                          <i className="fas fa-arrow-down" />
                        </button>
                        <button type="button" style={smallDangerButtonStyle} disabled={busy} onClick={() => onRemoveTrack(selectedPlaylist, music.id)} title="从歌单移除">
                          <i className="fas fa-xmark" />
                        </button>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <div style={emptyStyle}>{canEdit ? "这个歌单还是空的。去「找歌」里点歌曲旁的「+歌单」把歌加进来。" : "这个公开歌单还是空的。"}</div>
          )}
        </>
      )}
    </section>
  );
}

function shellStyle(isMobile: boolean): CSSProperties {
  return {
    display: "grid",
    gap: "14px",
    padding: isMobile ? "12px 0 0" : "22px",
    borderRadius: isMobile ? 0 : "24px",
    background: isMobile ? "transparent" : "var(--x-color-panel-strongest)",
    border: isMobile ? "none" : "1px solid var(--x-color-line-soft)",
    boxShadow: isMobile ? "none" : "0 14px 32px var(--x-color-shadow-soft)",
    alignContent: "start",
  };
}

function heroStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
    alignItems: "flex-start",
    justifyContent: "space-between",
    flexDirection: isMobile ? "column" : "row",
  };
}

const heroActionsStyle: CSSProperties = { display: "flex", gap: "8px", flexWrap: "wrap" };

const eyebrowStyle: CSSProperties = {
  fontSize: "12px",
  fontWeight: 800,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--x-color-accent)",
};

const titleStyle: CSSProperties = { fontSize: "24px", fontWeight: 800, color: "var(--x-color-ink)", marginTop: "4px" };

const copyStyle: CSSProperties = { fontSize: "13px", color: "var(--x-color-ink-muted)", marginTop: "4px", lineHeight: 1.6 };

const baseButton: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  minHeight: "40px",
  padding: "0 14px",
  borderRadius: "12px",
  fontWeight: 700,
  fontSize: "13px",
  cursor: "pointer",
};

const primaryButtonStyle: CSSProperties = {
  ...baseButton,
  border: "none",
  background: "var(--x-color-accent)",
  color: "#fff",
};

const ghostButtonStyle: CSSProperties = {
  ...baseButton,
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
};

const smallTextButtonStyle: CSSProperties = {
  ...baseButton,
  minHeight: "34px",
  padding: "0 12px",
  fontSize: "12px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
};

const dangerTextButtonStyle: CSSProperties = {
  ...smallTextButtonStyle,
  border: "1px solid var(--x-color-danger-border)",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
};

const smallButtonStyle: CSSProperties = {
  width: "34px",
  height: "34px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "10px",
  border: "1px solid var(--x-color-line)",
  background: "var(--x-color-panel)",
  color: "var(--x-color-ink)",
  cursor: "pointer",
};

const smallDangerButtonStyle: CSSProperties = {
  ...smallButtonStyle,
  border: "1px solid var(--x-color-danger-border)",
  background: "var(--x-color-danger-soft)",
  color: "var(--x-color-danger)",
};

function noticeStyle(type: "success" | "error"): CSSProperties {
  return {
    padding: "10px 14px",
    borderRadius: "12px",
    fontSize: "13px",
    fontWeight: 600,
    background: type === "success" ? "var(--x-color-accent-soft)" : "var(--x-color-danger-soft)",
    color: type === "success" ? "var(--x-color-accent-strong)" : "var(--x-color-danger)",
    border: `1px solid ${type === "success" ? "var(--x-color-accent-border)" : "var(--x-color-danger-border)"}`,
  };
}

const emptyStyle: CSSProperties = {
  padding: "24px",
  borderRadius: "18px",
  background: "var(--x-color-panel-alt)",
  color: "var(--x-color-ink-muted)",
  textAlign: "center",
  lineHeight: 1.7,
};

const listStyle: CSSProperties = { display: "grid", gap: "8px" };

function cardStyle(isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: isMobile ? "8px" : "12px",
    padding: "10px 12px",
    borderRadius: "16px",
    border: "1px solid var(--x-color-line)",
    background: "var(--x-color-panel)",
    minWidth: 0,
  };
}

const cardMainButtonStyle: CSSProperties = {
  flex: "1 1 0%",
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: "12px",
  padding: 0,
  border: "none",
  background: "transparent",
  textAlign: "left",
  cursor: "pointer",
  color: "inherit",
};

const cardIconStyle: CSSProperties = {
  width: "44px",
  height: "44px",
  flexShrink: 0,
  display: "grid",
  placeItems: "center",
  borderRadius: "14px",
  background: "linear-gradient(135deg, var(--x-color-panel-alt), var(--x-color-accent-soft))",
  color: "var(--x-color-accent-strong)",
  fontSize: "18px",
};

const cardTextStyle: CSSProperties = { display: "grid", gap: "3px", minWidth: 0 };

const cardNameStyle: CSSProperties = {
  fontSize: "15px",
  fontWeight: 700,
  color: "var(--x-color-ink)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const cardMetaStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)" };

const cardActionsStyle: CSSProperties = { display: "flex", gap: "6px", flexShrink: 0 };

const toolbarStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: "8px" };

const sectionDividerStyle: CSSProperties = {
  marginTop: "6px",
  fontSize: "12px",
  fontWeight: 800,
  letterSpacing: "0.06em",
  color: "var(--x-color-ink-muted)",
};

const membersBoxStyle: CSSProperties = {
  display: "grid",
  gap: "8px",
  padding: "12px 14px",
  borderRadius: "16px",
  border: "1px dashed var(--x-color-line)",
  background: "var(--x-color-panel-alt)",
};

const membersHeaderStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" };

const membersTitleStyle: CSSProperties = { fontSize: "13px", fontWeight: 800, color: "var(--x-color-ink)" };

const memberChipsStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: "6px" };

function memberChipStyle(owner: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    minHeight: "28px",
    padding: "0 10px",
    borderRadius: "999px",
    fontSize: "12px",
    fontWeight: 600,
    background: owner ? "var(--x-color-accent-soft)" : "var(--x-color-panel)",
    color: owner ? "var(--x-color-accent-strong)" : "var(--x-color-ink)",
    border: `1px solid ${owner ? "var(--x-color-accent-border)" : "var(--x-color-line)"}`,
  };
}

const memberRemoveStyle: CSSProperties = {
  marginLeft: "4px",
  width: "18px",
  height: "18px",
  borderRadius: "999px",
  border: "none",
  background: "transparent",
  color: "inherit",
  fontSize: "14px",
  lineHeight: 1,
  cursor: "pointer",
};

function rowStyle(active: boolean, isMobile: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: isMobile ? "6px" : "10px",
    padding: "8px 10px",
    borderRadius: "14px",
    border: `1px solid ${active ? "var(--x-color-accent-border)" : "var(--x-color-line)"}`,
    background: active ? "var(--x-color-accent-soft)" : "var(--x-color-panel)",
    minWidth: 0,
  };
}

const rowPlayButtonStyle: CSSProperties = {
  flex: "1 1 0%",
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: "10px",
  padding: 0,
  border: "none",
  background: "transparent",
  textAlign: "left",
  cursor: "pointer",
  color: "inherit",
};

function rowIndexStyle(active: boolean): CSSProperties {
  return { width: "24px", flexShrink: 0, fontSize: "12px", fontWeight: 800, color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink-muted)" };
}

const rowCoverStyle: CSSProperties = { width: "40px", height: "40px", flexShrink: 0, borderRadius: "10px", overflow: "hidden", background: "var(--x-color-panel-alt)" };

const rowCoverImgStyle: CSSProperties = { display: "block", width: "100%", height: "100%", objectFit: "cover" };

const rowTextStyle: CSSProperties = { display: "grid", gap: "2px", minWidth: 0 };

function rowNameStyle(active: boolean): CSSProperties {
  return { fontSize: "14px", fontWeight: 700, color: active ? "var(--x-color-accent-strong)" : "var(--x-color-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };
}

const rowSubStyle: CSSProperties = { fontSize: "12px", color: "var(--x-color-ink-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

const rowActionsStyle: CSSProperties = { display: "flex", gap: "4px", flexShrink: 0 };
