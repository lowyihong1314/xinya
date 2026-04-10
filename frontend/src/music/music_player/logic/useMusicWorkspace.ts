import { useEffect, useMemo, useRef, useState } from "react";

import { hasUserPermission } from "../../../app/permissions";
import { useUserState } from "../../../app/UserState";
import { showConfirmDialog } from "../../../js/dialogs";
import {
  createAlbum,
  deleteAlbum,
  deleteMusic,
  editAlbum,
  editMusic,
  fetchAlbum,
  fetchAlbums,
  fetchMusicDetail,
  fetchMinuteLogs,
  fetchMusicList,
  replaceMusicFile,
  uploadAlbumCover,
  uploadMusic,
} from "./api";
import {
  countUniqueListeners,
  groupMinuteLogsIntoSessions,
  sumSessionMinutes,
} from "./listeningActivity";
import { useMusicPlayback } from "./MusicPlaybackContext";
import type {
  AlbumRecord,
  MinuteLogRecord,
  MusicRecord,
  PlaylistRecord,
} from "./types";
import {
  EMPTY_ALBUM_DRAFT,
  EMPTY_PLAYLIST_DRAFT,
  EMPTY_TRACK_DRAFT,
  type AlbumDraft,
  type EditorMode,
  type PlaylistDraft,
  type Toast,
  type TrackDraft,
  type WorkspaceScreen,
} from "./workspaceTypes";

const ALBUMS_PER_PAGE = 8;
const TRACKS_PER_PAGE = 20;
const CURRENT_STORAGE_KEY = "xinya.music.current.id";

export function useMusicWorkspace() {
  const { user, isMobile } = useUserState();
  const {
    currentMusicId,
    setLibraryMusics: setPlaybackLibraryMusics,
    setCurrentMusicId,
    setQueue,
    selectMusic,
    appendToQueue,
  } = useMusicPlayback();
  const canManage = hasUserPermission(user, "music_edit");
  const canViewListening = canManage;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  const [albums, setAlbums] = useState<AlbumRecord[]>([]);
  const [libraryMusics, setLibraryMusics] = useState<MusicRecord[]>([]);
  const [musics, setMusics] = useState<MusicRecord[]>([]);
  const [playlists] = useState<PlaylistRecord[]>([]);
  const [playlistDraft, setPlaylistDraft] = useState<PlaylistDraft>(EMPTY_PLAYLIST_DRAFT);
  const [selectedAlbumId, setSelectedAlbumId] = useState<number | null>(null);
  const [selectedAlbumDetail, setSelectedAlbumDetail] = useState<AlbumRecord | null>(null);
  const [editingMusicId, setEditingMusicId] = useState<number | null>(null);
  const [editingMusicDetail, setEditingMusicDetail] = useState<MusicRecord | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingAlbum, setSavingAlbum] = useState(false);
  const [savingTrack, setSavingTrack] = useState(false);
  const [uploadingMusicState, setUploadingMusicState] = useState(false);
  const [replacingFile, setReplacingFile] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [minuteLogs, setMinuteLogs] = useState<MinuteLogRecord[]>([]);
  const [listeningLoading, setListeningLoading] = useState(false);
  const [listeningTimezone, setListeningTimezone] = useState("Asia/Kuala_Lumpur");
  const [newAlbumName, setNewAlbumName] = useState("");
  const [albumDraft, setAlbumDraft] = useState<AlbumDraft>(EMPTY_ALBUM_DRAFT);
  const [trackDraft, setTrackDraft] = useState<TrackDraft>(EMPTY_TRACK_DRAFT);
  const [screen, setScreen] = useState<WorkspaceScreen>("albums");
  const [editorMode, setEditorMode] = useState<EditorMode>(null);
  const [albumPage, setAlbumPage] = useState(1);
  const [trackPage, setTrackPage] = useState(1);

  const allMusicsSorted = useMemo(
    () => [...libraryMusics].sort((a, b) => (b.play_minutes ?? 0) - (a.play_minutes ?? 0)),
    [libraryMusics],
  );
  const normalizedSearch = search.trim().toLowerCase();

  const filteredMusics = useMemo(() => {
    const base = selectedAlbumId === null ? allMusicsSorted : musics;
    if (!normalizedSearch) return base;
    return base.filter((music) => {
      const title = music.title?.toLowerCase() || "";
      const albumName = music.album?.name?.toLowerCase() || "";
      return title.includes(normalizedSearch) || albumName.includes(normalizedSearch);
    });
  }, [musics, allMusicsSorted, normalizedSearch, selectedAlbumId]);

  const filteredLibraryMusics = useMemo(() => {
    if (!normalizedSearch) return allMusicsSorted;
    return allMusicsSorted.filter((music) => {
      const title = music.title?.toLowerCase() || "";
      const albumName = music.album?.name?.toLowerCase() || "";
      return title.includes(normalizedSearch) || albumName.includes(normalizedSearch);
    });
  }, [allMusicsSorted, normalizedSearch]);

  const filteredAlbums = useMemo(() => {
    if (!normalizedSearch) return albums;

    const matchedAlbumIds = new Set<number>();
    libraryMusics.forEach((music) => {
      const title = music.title?.toLowerCase() || "";
      const albumName = music.album?.name?.toLowerCase() || "";
      if (title.includes(normalizedSearch) || albumName.includes(normalizedSearch)) {
        const albumId = music.album_id ?? music.album?.id ?? null;
        if (albumId != null) {
          matchedAlbumIds.add(albumId);
        }
      }
    });

    return albums.filter((album) => {
      const albumName = album.name?.toLowerCase() || "";
      return albumName.includes(normalizedSearch) || matchedAlbumIds.has(album.id);
    });
  }, [albums, libraryMusics, normalizedSearch]);

  const albumTrackCountMap = useMemo(() => {
    const next = new Map<number, number>();
    libraryMusics.forEach((music) => {
      if (music.album_id == null) return;
      next.set(music.album_id, (next.get(music.album_id) || 0) + 1);
    });
    return next;
  }, [libraryMusics]);

  const listeningSessions = useMemo(
    () => groupMinuteLogsIntoSessions(minuteLogs),
    [minuteLogs],
  );

  const listeningSummary = useMemo(
    () => ({
      totalMinutes: sumSessionMinutes(listeningSessions),
      uniqueListeners: countUniqueListeners(listeningSessions),
    }),
    [listeningSessions],
  );

  const totalAlbumPages = Math.max(1, Math.ceil(filteredAlbums.length / ALBUMS_PER_PAGE));
  const pagedAlbums = useMemo(() => {
    const start = (albumPage - 1) * ALBUMS_PER_PAGE;
    return filteredAlbums.slice(start, start + ALBUMS_PER_PAGE);
  }, [filteredAlbums, albumPage]);
  const totalTrackPages = Math.max(1, Math.ceil(filteredMusics.length / TRACKS_PER_PAGE));
  const pagedFilteredMusics = useMemo(() => {
    const start = (trackPage - 1) * TRACKS_PER_PAGE;
    return filteredMusics.slice(start, start + TRACKS_PER_PAGE);
  }, [filteredMusics, trackPage]);

  useEffect(() => {
    void loadInitial();
  }, []);

  useEffect(() => {
    setAlbumPage((current) => Math.min(current, totalAlbumPages));
  }, [totalAlbumPages]);

  useEffect(() => {
    setTrackPage((current) => Math.min(current, totalTrackPages));
  }, [totalTrackPages]);

  useEffect(() => {
    setAlbumPage(1);
    setTrackPage(1);
  }, [normalizedSearch]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!canViewListening) {
      setMinuteLogs([]);
      setListeningLoading(false);
      return;
    }

    let cancelled = false;
    setListeningLoading(true);

    void fetchMinuteLogs({ perPage: 240 })
      .then((payload) => {
        if (cancelled) return;
        setMinuteLogs(payload.items || []);
        setListeningTimezone(payload.timezone || "Asia/Kuala_Lumpur");
      })
      .catch((error) => {
        if (!cancelled) {
          setToast({
            type: "error",
            text: error instanceof Error ? error.message : "读取听歌记录失败",
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setListeningLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canViewListening]);

  async function loadInitial() {
    setLoading(true);
    try {
      const [albumList, musicListPayload] = await Promise.all([fetchAlbums(), fetchMusicList()]);
      const allMusics = musicListPayload.musics || [];
      setAlbums(albumList);
      setLibraryMusics(allMusics);
      setPlaybackLibraryMusics(allMusics);
      setMusics(allMusics);
      setSelectedAlbumId(null);
      setSelectedAlbumDetail(null);
      setScreen("albums");
      const storedCurrentId = (() => {
        try {
          const raw = window.localStorage.getItem(CURRENT_STORAGE_KEY);
          return raw ? Number(raw) || null : null;
        } catch {
          return null;
        }
      })();
      const preferredCurrentId =
        currentMusicId && allMusics.some((music) => music.id === currentMusicId)
          ? currentMusicId
          : storedCurrentId && allMusics.some((music) => music.id === storedCurrentId)
            ? storedCurrentId
            : null;
      if (preferredCurrentId != null) {
        setCurrentMusicId(preferredCurrentId);
      }
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "载入音乐资料失败" });
    } finally {
      setLoading(false);
    }
  }

  async function refreshWorkspace(options?: { preserveScreen?: boolean }) {
    setRefreshing(true);
    try {
      const responses = await Promise.all([
        fetchAlbums(),
        fetchMusicList(),
        canViewListening ? fetchMinuteLogs({ perPage: 240 }) : Promise.resolve(null),
      ]);
      const [albumList, musicListPayload, minuteLogPayload] = responses;
      const allMusics = musicListPayload.musics || [];
      setAlbums(albumList);
      setLibraryMusics(allMusics);
      setPlaybackLibraryMusics(allMusics);

      if (minuteLogPayload) {
        setMinuteLogs(minuteLogPayload.items || []);
        setListeningTimezone(minuteLogPayload.timezone || "Asia/Kuala_Lumpur");
      }

      if (selectedAlbumId) {
        const album = await fetchAlbum(selectedAlbumId);
        setSelectedAlbumDetail(album);
        setMusics(album.music_list || []);
      } else {
        setSelectedAlbumDetail(null);
        setMusics(allMusics);
      }

      if (editingMusicId) {
        const detail = await fetchMusicDetail(editingMusicId);
        setEditingMusicDetail(detail);
        setTrackDraft({
          title: detail.title || "",
          album_id: detail.album_id ? String(detail.album_id) : "",
        });
      }

      if (currentMusicId && !allMusics.some((music) => music.id === currentMusicId)) {
        setCurrentMusicId(null);
      }

      if (options?.preserveScreen !== true) {
        setScreen(selectedAlbumId ? "tracks" : "albums");
      }
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "刷新失败" });
    } finally {
      setRefreshing(false);
    }
  }

  async function openAlbumTracks(albumId: number | null) {
    setSelectedAlbumId(albumId);
    setEditorMode(null);
    setEditingMusicId(null);
    setEditingMusicDetail(null);
    setTrackPage(1);
    if (albumId == null) {
      setSelectedAlbumDetail(null);
      setMusics(libraryMusics);
      setScreen("tracks");
      return;
    }
    setRefreshing(true);
    try {
      const album = await fetchAlbum(albumId);
      setSelectedAlbumDetail(album);
      setMusics(album.music_list || []);
      setScreen("tracks");
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "读取专辑失败" });
    } finally {
      setRefreshing(false);
    }
  }

  async function openAlbumEditor(albumId: number) {
    setSelectedAlbumId(albumId);
    setRefreshing(true);
    try {
      const album = await fetchAlbum(albumId);
      setSelectedAlbumDetail(album);
      setAlbumDraft({
        name: album.name || "",
        description: album.description || "",
      });
      setEditorMode("album");
      setScreen("editor");
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "读取专辑失败" });
    } finally {
      setRefreshing(false);
    }
  }

  async function openTrackEditor(musicId: number) {
    setEditingMusicId(musicId);
    setRefreshing(true);
    try {
      const detail = await fetchMusicDetail(musicId);
      setEditingMusicDetail(detail);
      setTrackDraft({
        title: detail.title || "",
        album_id: detail.album_id ? String(detail.album_id) : "",
      });
      setEditorMode("track");
      setScreen("editor");
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "读取歌曲失败" });
    } finally {
      setRefreshing(false);
    }
  }

  async function handleCreateAlbum(nameOverride?: string) {
    const name = (nameOverride ?? newAlbumName).trim();
    if (!name) {
      setToast({ type: "error", text: "请输入专辑名称" });
      return;
    }
    setSavingAlbum(true);
    try {
      const payload = await createAlbum(name);
      const albumId = payload.album?.id || payload.id;
      setNewAlbumName("");
      setToast({ type: "success", text: "专辑已创建" });
      await refreshWorkspace({ preserveScreen: true });
      if (albumId) {
        await openAlbumEditor(albumId);
      } else {
        setScreen("albums");
      }
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "创建专辑失败" });
    } finally {
      setSavingAlbum(false);
    }
  }

  async function handleSaveAlbum() {
    if (!selectedAlbumId) return;
    const name = albumDraft.name.trim();
    if (!name) {
      setToast({ type: "error", text: "专辑名称不能为空" });
      return;
    }
    setSavingAlbum(true);
    try {
      await editAlbum(selectedAlbumId, {
        name,
        description: albumDraft.description.trim(),
      });
      setToast({ type: "success", text: "专辑已更新" });
      await refreshWorkspace({ preserveScreen: true });
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "保存专辑失败" });
    } finally {
      setSavingAlbum(false);
    }
  }

  async function handleDeleteAlbum() {
    if (!selectedAlbumId) return;
    if (!(await showConfirmDialog({ message: "确定删除这个专辑吗？其中歌曲也会被移除。", tone: "danger" }))) return;
    setSavingAlbum(true);
    try {
      await deleteAlbum(selectedAlbumId);
      setSelectedAlbumId(null);
      setSelectedAlbumDetail(null);
      setAlbumDraft(EMPTY_ALBUM_DRAFT);
      setScreen("albums");
      setEditorMode(null);
      await refreshWorkspace({ preserveScreen: true });
      setToast({ type: "success", text: "专辑已删除" });
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "删除专辑失败" });
    } finally {
      setSavingAlbum(false);
    }
  }

  async function handleCoverSelected(file: File | null) {
    if (!selectedAlbumId || !file) return;
    setSavingAlbum(true);
    try {
      await uploadAlbumCover(selectedAlbumId, file);
      setToast({ type: "success", text: "封面已更新" });
      await refreshWorkspace({ preserveScreen: true });
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "上传封面失败" });
    } finally {
      setSavingAlbum(false);
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  }

  async function handleUploadMusic(files: FileList | null) {
    if (!selectedAlbumId || !files?.length) return;
    setUploadingMusicState(true);
    try {
      await uploadMusic(selectedAlbumId, Array.from(files));
      setToast({ type: "success", text: "歌曲已添加" });
      await refreshWorkspace({ preserveScreen: true });
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "上传歌曲失败" });
    } finally {
      setUploadingMusicState(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function resolveTrackSelectionQueue() {
    if (selectedAlbumId != null) {
      return musics.length ? musics : filteredMusics;
    }
    return filteredMusics.length ? filteredMusics : allMusicsSorted;
  }

  function handleSelectTrack(musicId: number) {
    const nextQueue = resolveTrackSelectionQueue();
    setQueue(nextQueue);
    selectMusic(musicId);
  }

  function handleQueueTrack(musicId: number) {
    appendToQueue(musicId);
    setToast({ type: "success", text: "已加入播放队列" });
  }

  async function handleSaveTrack() {
    if (!editingMusicId) return;
    const title = trackDraft.title.trim();
    if (!title) {
      setToast({ type: "error", text: "歌曲标题不能为空" });
      return;
    }
    setSavingTrack(true);
    try {
      await editMusic(editingMusicId, {
        title,
        album_id: trackDraft.album_id ? Number(trackDraft.album_id) : null,
      });
      setToast({ type: "success", text: "歌曲已更新" });
      await refreshWorkspace({ preserveScreen: true });
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "保存歌曲失败" });
    } finally {
      setSavingTrack(false);
    }
  }

  async function handleDeleteTrack() {
    if (!editingMusicId) return;
    if (!(await showConfirmDialog({ message: "确定删除这首歌曲吗？", tone: "danger" }))) return;
    setSavingTrack(true);
    try {
      await deleteMusic(editingMusicId);
      setToast({ type: "success", text: "歌曲已删除" });
      setEditingMusicId(null);
      setEditingMusicDetail(null);
      setTrackDraft(EMPTY_TRACK_DRAFT);
      setScreen("tracks");
      setEditorMode(null);
      await refreshWorkspace({ preserveScreen: true });
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "删除歌曲失败" });
    } finally {
      setSavingTrack(false);
    }
  }

  async function handleReplaceSelected(file: File | null) {
    if (!editingMusicId || !file) return;
    setReplacingFile(true);
    try {
      await replaceMusicFile(editingMusicId, file);
      setToast({ type: "success", text: "音频文件已替换" });
      await refreshWorkspace({ preserveScreen: true });
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "替换音频失败" });
    } finally {
      setReplacingFile(false);
      if (replaceInputRef.current) replaceInputRef.current.value = "";
    }
  }

  return {
    state: {
      isMobile,
      canManage,
      albums,
      filteredAlbums,
      filteredLibraryMusicCount: filteredLibraryMusics.length,
      pagedAlbums,
      albumPage,
      totalAlbumPages,
      pagedFilteredMusics,
      trackPage,
      totalTrackPages,
      selectedAlbumId,
      selectedAlbumDetail,
      musics,
      filteredMusics,
      currentMusicId,
      editingMusicDetail,
      search,
      newAlbumName,
      albumDraft,
      trackDraft,
      playlistDraft,
      playlists,
      canViewListening,
      toast,
      loading,
      refreshing,
      listeningLoading,
      listeningTimezone,
      listeningSummary,
      listeningSessions,
      savingAlbum,
      savingTrack,
      uploadingMusic: uploadingMusicState,
      replacingFile,
      screen,
      editorMode,
      fileInputRef,
      coverInputRef,
      replaceInputRef,
      albumTrackCountMap,
    },
    actions: {
      setSearch,
      setNewAlbumName,
      setAlbumDraft,
      setTrackDraft,
      setPlaylistDraft,
      setAlbumPage,
      setTrackPage,
      openAlbumTracks,
      openAlbumEditor,
      openTrackEditor,
      refreshWorkspace,
      handleCreateAlbum,
      handleSaveAlbum,
      handleDeleteAlbum,
      handleCoverSelected,
      handleUploadMusic,
      handleSelectTrack,
      handleQueueTrack,
      handleSaveTrack,
      handleDeleteTrack,
      handleReplaceSelected,
      openAlbums: () => {
        setScreen("albums");
        setEditorMode(null);
      },
      backFromEditor: () => {
        setScreen("tracks");
        setEditorMode(null);
      },
      backToAlbums: () => {
        setScreen("albums");
        setEditorMode(null);
      },
    },
  };
}
