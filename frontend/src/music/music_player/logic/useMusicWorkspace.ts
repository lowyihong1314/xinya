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
import { buildMusicAudioRevision, warmPinnedMusicAudioTracks } from "./musicAudioCache";
import { getPinnedAllSongsCacheCandidates, sortAllSongsByListOrder } from "./musicListOrder";
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
  type MusicUploadDraft,
  type PlaylistDraft,
  type Toast,
  type TrackDraft,
  type WorkspaceScreen,
} from "./workspaceTypes";
import type { MusicPlayerRouteState } from "./routeState";

const ALBUMS_PER_PAGE = 8;
const TRACKS_PER_PAGE = 20;
const CURRENT_STORAGE_KEY = "xinya.music.current.id";

type RouteNavigationOptions = {
  replace?: boolean;
};

type TrackRouteNavigationOptions = RouteNavigationOptions & {
  clearSearch?: boolean;
  resetTrackPage?: boolean;
};

type MusicWorkspaceRouteActions = {
  setSearch: (value: string, options?: RouteNavigationOptions) => void;
  setAlbumPage: (page: number, options?: RouteNavigationOptions) => void;
  setTrackPage: (page: number, options?: RouteNavigationOptions) => void;
  openAlbums: (options?: RouteNavigationOptions) => void;
  openAlbumTracks: (albumId: number | null, options?: TrackRouteNavigationOptions) => void;
  openAlbumEditor: (albumId: number, options?: RouteNavigationOptions) => void;
  openTrackEditor: (
    musicId: number,
    albumId: number | null,
    options?: RouteNavigationOptions,
  ) => void;
};

export function useMusicWorkspace({
  routeState,
  routeActions,
}: {
  routeState: MusicPlayerRouteState;
  routeActions: MusicWorkspaceRouteActions;
}) {
  const { user, isMobile, isAuthenticated } = useUserState();
  const {
    currentMusicId,
    setLibraryMusics: setPlaybackLibraryMusics,
    setCurrentMusicId,
    setQueue,
    selectMusic,
    appendToQueue,
  } = useMusicPlayback();
  const canManage = hasUserPermission(user, "music_edit");
  const canViewListening = isAuthenticated;

  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  const [albums, setAlbums] = useState<AlbumRecord[]>([]);
  const [libraryMusics, setLibraryMusics] = useState<MusicRecord[]>([]);
  const [musics, setMusics] = useState<MusicRecord[]>([]);
  const [playlists] = useState<PlaylistRecord[]>([]);
  const [playlistDraft, setPlaylistDraft] = useState<PlaylistDraft>(EMPTY_PLAYLIST_DRAFT);
  const [selectedAlbumDetail, setSelectedAlbumDetail] = useState<AlbumRecord | null>(null);
  const [editingMusicDetail, setEditingMusicDetail] = useState<MusicRecord | null>(null);
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
  const [albumDraft, setAlbumDraft] = useState<AlbumDraft>(EMPTY_ALBUM_DRAFT);
  const [trackDraft, setTrackDraft] = useState<TrackDraft>(EMPTY_TRACK_DRAFT);
  const {
    screen,
    editorMode,
    albumId: selectedAlbumId,
    musicId: editingMusicId,
    search,
    albumPage,
    trackPage,
  } = routeState;

  const allMusicsSorted = useMemo(
    () => sortAllSongsByListOrder(libraryMusics),
    [libraryMusics],
  );
  const pinnedAllSongsCacheTracks = useMemo(
    () => getPinnedAllSongsCacheCandidates(allMusicsSorted),
    [allMusicsSorted],
  );
  const pinnedAllSongsCacheIds = useMemo(
    () => pinnedAllSongsCacheTracks.map((music) => music.id),
    [pinnedAllSongsCacheTracks],
  );
  const pinnedAllSongsCacheSignature = useMemo(
    () => pinnedAllSongsCacheTracks.map((music) => buildMusicAudioRevision(music)).join("|"),
    [pinnedAllSongsCacheTracks],
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
    if (albumPage > totalAlbumPages) {
      routeActions.setAlbumPage(totalAlbumPages, { replace: true });
    }
  }, [albumPage, routeActions, totalAlbumPages]);

  useEffect(() => {
    if (trackPage > totalTrackPages) {
      routeActions.setTrackPage(totalTrackPages, { replace: true });
    }
  }, [routeActions, totalTrackPages, trackPage]);

  useEffect(() => {
    if (selectedAlbumId == null) {
      setSelectedAlbumDetail(null);
      setMusics(libraryMusics);
      if (editorMode !== "album") {
        setAlbumDraft(EMPTY_ALBUM_DRAFT);
      }
      return;
    }

    let cancelled = false;
    setRefreshing(true);

    void fetchAlbum(selectedAlbumId)
      .then((album) => {
        if (cancelled) {
          return;
        }
        setSelectedAlbumDetail(album);
        setMusics(album.music_list || []);
        if (editorMode === "album") {
          setAlbumDraft({
            name: album.name || "",
            description: album.description || "",
          });
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setSelectedAlbumDetail(null);
        setMusics([]);
        setToast({
          type: "error",
          text: error instanceof Error ? error.message : "读取专辑失败",
        });
        routeActions.openAlbums({ replace: true });
      })
      .finally(() => {
        if (!cancelled) {
          setRefreshing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [editorMode, libraryMusics, routeActions, selectedAlbumId]);

  useEffect(() => {
    if (editingMusicId == null) {
      setEditingMusicDetail(null);
      if (editorMode !== "track") {
        setTrackDraft(EMPTY_TRACK_DRAFT);
      }
      return;
    }

    let cancelled = false;
    setRefreshing(true);

    void fetchMusicDetail(editingMusicId)
      .then((detail) => {
        if (cancelled) {
          return;
        }
        setEditingMusicDetail(detail);
        setTrackDraft({
          title: detail.title || "",
          album_id: detail.album_id ? String(detail.album_id) : "",
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setEditingMusicDetail(null);
        setToast({
          type: "error",
          text: error instanceof Error ? error.message : "读取歌曲失败",
        });
        routeActions.openAlbumTracks(selectedAlbumId, { replace: true, resetTrackPage: false });
      })
      .finally(() => {
        if (!cancelled) {
          setRefreshing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [editingMusicId, editorMode, libraryMusics, routeActions, selectedAlbumId]);

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

  useEffect(() => {
    if (!pinnedAllSongsCacheTracks.length) {
      return;
    }

    let cancelled = false;
    void warmPinnedMusicAudioTracks(pinnedAllSongsCacheTracks).catch((error) => {
      if (!cancelled) {
        console.warn("Pinned all-songs audio prewarm failed", error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [pinnedAllSongsCacheSignature]);

  async function loadInitial() {
    setLoading(true);
    try {
      const [albumList, musicListPayload] = await Promise.all([fetchAlbums(), fetchMusicList()]);
      const allMusics = musicListPayload.musics || [];
      setAlbums(albumList);
      setLibraryMusics(allMusics);
      setPlaybackLibraryMusics(allMusics);
      setMusics(allMusics);
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

  async function refreshWorkspace(_options?: { preserveScreen?: boolean }) {
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
      if (selectedAlbumId == null) {
        setMusics(allMusics);
      }

      if (minuteLogPayload) {
        setMinuteLogs(minuteLogPayload.items || []);
        setListeningTimezone(minuteLogPayload.timezone || "Asia/Kuala_Lumpur");
      }

      if (currentMusicId && !allMusics.some((music) => music.id === currentMusicId)) {
        setCurrentMusicId(null);
      }
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "刷新失败" });
    } finally {
      setRefreshing(false);
    }
  }

  async function openAlbumTracks(albumId: number | null) {
    setEditingMusicDetail(null);
    routeActions.openAlbumTracks(albumId, { clearSearch: albumId != null });
  }

  async function openAlbumEditor(albumId: number) {
    routeActions.openAlbumEditor(albumId);
  }

  async function openTrackEditor(musicId: number) {
    routeActions.openTrackEditor(musicId, selectedAlbumId);
  }

  async function handleCreateAlbum(nameOverride?: string) {
    const name = (nameOverride ?? "").trim();
    if (!name) {
      setToast({ type: "error", text: "请输入专辑名称" });
      return;
    }
    setSavingAlbum(true);
    try {
      const payload = await createAlbum(name);
      const albumId = payload.album?.id || payload.id;
      setToast({ type: "success", text: "专辑已创建" });
      await refreshWorkspace({ preserveScreen: true });
      if (albumId) {
        await openAlbumEditor(albumId);
      } else {
        routeActions.openAlbums({ replace: true });
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
      setSelectedAlbumDetail(null);
      setAlbumDraft(EMPTY_ALBUM_DRAFT);
      routeActions.openAlbums({ replace: true });
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

  async function handleUploadMusic(upload: MusicUploadDraft | null) {
    if (!selectedAlbumId || !upload) return;
    setUploadingMusicState(true);
    try {
      await uploadMusic(selectedAlbumId, upload);
      setToast({ type: "success", text: "歌曲已添加" });
      await refreshWorkspace({ preserveScreen: true });
    } catch (error) {
      setToast({ type: "error", text: error instanceof Error ? error.message : "上传歌曲失败" });
    } finally {
      setUploadingMusicState(false);
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
      setEditingMusicDetail(null);
      setTrackDraft(EMPTY_TRACK_DRAFT);
      routeActions.openAlbumTracks(selectedAlbumId, { replace: true, resetTrackPage: false });
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
      pinnedAllSongsCacheIds,
      savingAlbum,
      savingTrack,
      uploadingMusic: uploadingMusicState,
      replacingFile,
      screen,
      editorMode,
      coverInputRef,
      replaceInputRef,
      albumTrackCountMap,
    },
    actions: {
      setSearch: (value: string) => {
        routeActions.setSearch(value, { replace: true });
      },
      setAlbumDraft,
      setTrackDraft,
      setPlaylistDraft,
      setAlbumPage: (page: number) => {
        routeActions.setAlbumPage(page, { replace: true });
      },
      setTrackPage: (page: number) => {
        routeActions.setTrackPage(page, { replace: true });
      },
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
      openAlbums: () => routeActions.openAlbums(),
      backFromEditor: () => {
        routeActions.openAlbumTracks(selectedAlbumId, { resetTrackPage: false });
      },
      backToAlbums: () => routeActions.openAlbums(),
    },
  };
}
