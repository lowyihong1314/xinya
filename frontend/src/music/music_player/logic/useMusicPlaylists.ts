import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { showChoiceDialog, showConfirmDialog, showPromptDialog } from "../../../js/dialogs";
import {
  addPlaylistMember,
  createPlaylist,
  deletePlaylist,
  fetchPlaylists,
  removePlaylistMember,
  savePlaylist,
} from "./api";
import type { MusicRecord, PlaylistRecord } from "./types";

export type PlaylistNotice = { type: "success" | "error"; text: string } | null;

/**
 * 我的歌单：歌单与用户是多对多，这里拿到的是「当前用户是成员」的全部歌单。
 * 网页端和 APK 端共用；歌曲详情靠 libraryMusics 按 id 解析，所以不需要额外请求。
 */
export function useMusicPlaylists({
  enabled,
  libraryMusics,
  currentUserId,
}: {
  enabled: boolean;
  libraryMusics: MusicRecord[];
  currentUserId: number | null;
}) {
  const [playlists, setPlaylists] = useState<PlaylistRecord[]>([]);
  const [publicPlaylists, setPublicPlaylists] = useState<PlaylistRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<PlaylistNotice>(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);
  const loadedRef = useRef(false);

  const musicMap = useMemo(() => new Map(libraryMusics.map((music) => [music.id, music])), [libraryMusics]);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setPlaylists([]);
      setPublicPlaylists([]);
      return;
    }
    setLoading(true);
    try {
      const payload = await fetchPlaylists();
      setPlaylists(payload.playlists || []);
      setPublicPlaylists(payload.public_playlists || []);
      loadedRef.current = true;
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : "读取歌单失败" });
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (
      selectedPlaylistId != null &&
      !playlists.some((playlist) => playlist.id === selectedPlaylistId) &&
      !publicPlaylists.some((playlist) => playlist.id === selectedPlaylistId)
    ) {
      setSelectedPlaylistId(null);
    }
  }, [playlists, publicPlaylists, selectedPlaylistId]);

  const selectedPlaylist = useMemo(
    () =>
      playlists.find((playlist) => playlist.id === selectedPlaylistId) ||
      publicPlaylists.find((playlist) => playlist.id === selectedPlaylistId) ||
      null,
    [playlists, publicPlaylists, selectedPlaylistId],
  );

  const resolveTracks = useCallback(
    (playlist: PlaylistRecord | null): MusicRecord[] => {
      if (!playlist) return [];
      return (playlist.music_ids || [])
        .map((id) => musicMap.get(id))
        .filter((music): music is MusicRecord => Boolean(music));
    },
    [musicMap],
  );

  function upsert(playlist: PlaylistRecord) {
    setPlaylists((current) => {
      const index = current.findIndex((item) => item.id === playlist.id);
      if (index < 0) return [playlist, ...current];
      const next = [...current];
      next[index] = playlist;
      return next;
    });
  }

  async function run<T>(task: () => Promise<T>, fallbackError: string): Promise<T | null> {
    setBusy(true);
    try {
      return await task();
    } catch (error) {
      setNotice({ type: "error", text: error instanceof Error ? error.message : fallbackError });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate(initialMusicIds: number[] = []) {
    const name = await showPromptDialog({ title: "新建歌单", message: "给歌单取个名字", placeholder: "例如：晚课常用" });
    if (name == null) return null;
    const trimmed = name.trim();
    if (!trimmed) {
      setNotice({ type: "error", text: "歌单名称不能为空" });
      return null;
    }
    const created = await run(async () => {
      const payload = await createPlaylist({ name: trimmed, music_ids: initialMusicIds });
      if (payload.playlist) upsert(payload.playlist);
      return payload.playlist || null;
    }, "创建歌单失败");
    if (created) setNotice({ type: "success", text: `歌单「${created.name}」已创建` });
    return created;
  }

  async function handleRename(playlist: PlaylistRecord) {
    const name = await showPromptDialog({ title: "重命名歌单", message: "输入新的名称", initialValue: playlist.name });
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === playlist.name) return;
    const saved = await run(async () => {
      const payload = await savePlaylist(playlist.id, { name: trimmed });
      if (payload.playlist) upsert(payload.playlist);
      return payload.playlist;
    }, "重命名失败");
    if (saved) setNotice({ type: "success", text: "歌单已重命名" });
  }

  async function handleDelete(playlist: PlaylistRecord) {
    if (!(await showConfirmDialog({ message: `确定删除歌单「${playlist.name}」吗？所有成员都会看不到它。`, tone: "danger" }))) return;
    const ok = await run(async () => {
      await deletePlaylist(playlist.id);
      setPlaylists((current) => current.filter((item) => item.id !== playlist.id));
      return true;
    }, "删除歌单失败");
    if (ok) setNotice({ type: "success", text: "歌单已删除" });
  }

  async function handleLeave(playlist: PlaylistRecord) {
    if (currentUserId == null) return;
    if (!(await showConfirmDialog({ message: `退出歌单「${playlist.name}」？之后需要创建者再次邀请才能看到。`, tone: "danger" }))) return;
    const ok = await run(async () => {
      await removePlaylistMember(playlist.id, currentUserId);
      setPlaylists((current) => current.filter((item) => item.id !== playlist.id));
      return true;
    }, "退出歌单失败");
    if (ok) setNotice({ type: "success", text: "已退出歌单" });
  }

  async function handleSetMusicIds(playlist: PlaylistRecord, musicIds: number[], successText: string) {
    const saved = await run(async () => {
      const payload = await savePlaylist(playlist.id, { music_ids: musicIds });
      if (payload.playlist) upsert(payload.playlist);
      return payload.playlist;
    }, "保存歌单失败");
    if (saved) setNotice({ type: "success", text: successText });
    return saved;
  }

  async function handleAddTrack(playlist: PlaylistRecord, musicId: number) {
    const ids = playlist.music_ids || [];
    if (ids.includes(musicId)) {
      setNotice({ type: "success", text: `这首歌已经在「${playlist.name}」里了` });
      return playlist;
    }
    return handleSetMusicIds(playlist, [...ids, musicId], `已加入「${playlist.name}」`);
  }

  async function handleRemoveTrack(playlist: PlaylistRecord, musicId: number) {
    const ids = (playlist.music_ids || []).filter((id) => id !== musicId);
    return handleSetMusicIds(playlist, ids, "已从歌单移除");
  }

  async function handleMoveTrack(playlist: PlaylistRecord, musicId: number, direction: -1 | 1) {
    const ids = [...(playlist.music_ids || [])];
    const index = ids.indexOf(musicId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await handleSetMusicIds(playlist, ids, "顺序已调整");
  }

  /** 从任意地方「加入歌单」：先选歌单（或新建），再加进去。 */
  async function handleAddTrackWithPicker(musicId: number) {
    if (!enabled) {
      setNotice({ type: "error", text: "登录后才能使用歌单" });
      return;
    }
    if (!playlists.length) {
      const created = await handleCreate([musicId]);
      if (created) setNotice({ type: "success", text: `已建立歌单「${created.name}」并加入这首歌` });
      return;
    }
    const choice = await showChoiceDialog<string>({
      title: "加入歌单",
      message: "选择要加入的歌单",
      choices: [
        ...playlists.map((playlist) => ({
          value: String(playlist.id),
          label: `${playlist.name}（${playlist.music_ids?.length || 0} 首）`,
        })),
        { value: "__new__", label: "＋ 新建歌单…", primary: true },
      ],
    });
    if (choice == null) return;
    if (choice === "__new__") {
      const created = await handleCreate([musicId]);
      if (created) setNotice({ type: "success", text: `已建立歌单「${created.name}」并加入这首歌` });
      return;
    }
    const playlist = playlists.find((item) => String(item.id) === choice);
    if (playlist) await handleAddTrack(playlist, musicId);
  }

  /** 创建者切换公开 / 私有。 */
  async function handleTogglePublic(playlist: PlaylistRecord) {
    const next = !playlist.is_public;
    const saved = await run(async () => {
      const payload = await savePlaylist(playlist.id, { is_public: next });
      if (payload.playlist) upsert(payload.playlist);
      return payload.playlist;
    }, "设置失败");
    if (saved) setNotice({ type: "success", text: next ? "歌单已公开，其他人可以直接使用" : "歌单已改为私有" });
  }

  async function handleAddMember(playlist: PlaylistRecord) {
    const handle = await showPromptDialog({
      title: "添加成员",
      message: "输入对方的用户名或手机号，加入后对方也能编辑和播放这个歌单",
      placeholder: "用户名 / 手机号",
    });
    if (handle == null) return;
    const trimmed = handle.trim();
    if (!trimmed) return;
    const saved = await run(async () => {
      const payload = await addPlaylistMember(playlist.id, trimmed);
      if (payload.playlist) upsert(payload.playlist);
      return payload;
    }, "添加成员失败");
    if (saved) {
      setNotice({ type: "success", text: saved.already_member ? "对方已经是成员了" : "成员已加入" });
    }
  }

  async function handleRemoveMember(playlist: PlaylistRecord, userId: number, label: string) {
    if (!(await showConfirmDialog({ message: `把 ${label} 移出歌单「${playlist.name}」？`, tone: "danger" }))) return;
    const saved = await run(async () => {
      const payload = await removePlaylistMember(playlist.id, userId);
      if (payload.playlist) upsert(payload.playlist);
      return payload;
    }, "移除成员失败");
    if (saved) setNotice({ type: "success", text: "成员已移除" });
  }

  return {
    playlists,
    publicPlaylists,
    loading,
    busy,
    notice,
    selectedPlaylist,
    selectedPlaylistId,
    setSelectedPlaylistId,
    resolveTracks,
    refresh,
    handleCreate,
    handleRename,
    handleDelete,
    handleLeave,
    handleAddTrack,
    handleRemoveTrack,
    handleMoveTrack,
    handleAddTrackWithPicker,
    handleTogglePublic,
    handleAddMember,
    handleRemoveMember,
  };
}
