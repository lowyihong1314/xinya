import type { EditorMode, WorkspaceScreen } from "./workspaceTypes";
import { MUSIC_PLAYER_PATH } from "../../router/paths";

export type MusicPlayerRouteSection = "browse" | "player" | "queue" | "history";

export type MusicPlayerRouteState = {
  section: MusicPlayerRouteSection;
  screen: WorkspaceScreen;
  editorMode: EditorMode;
  albumId: number | null;
  musicId: number | null;
  search: string;
  albumPage: number;
  trackPage: number;
};

export type MusicPlayerRouteLocation = {
  pathname: string;
  searchParams: URLSearchParams;
};

const KNOWN_ROUTE_KEYS = [
  "section",
  "screen",
  "editor",
  "albumId",
  "musicId",
  "q",
  "albumPage",
  "trackPage",
] as const;

const DEFAULT_ROUTE_STATE: MusicPlayerRouteState = {
  section: "browse",
  screen: "albums",
  editorMode: null,
  albumId: null,
  musicId: null,
  search: "",
  albumPage: 1,
  trackPage: 1,
};

function parsePositiveInt(value: string | null) {
  const next = Number(value);
  if (!Number.isFinite(next) || next < 1) {
    return null;
  }
  return Math.floor(next);
}

export function parseMusicPlayerRouteState(searchParams: URLSearchParams): MusicPlayerRouteState {
  return parseMusicPlayerRouteStateFromLocation(MUSIC_PLAYER_PATH, searchParams);
}

function parseQueryRouteState(searchParams: URLSearchParams): MusicPlayerRouteState {
  const sectionParam = searchParams.get("section");
  const screenParam = searchParams.get("screen");
  const editorParam = searchParams.get("editor");

  return normalizeMusicPlayerRouteState({
    section:
      sectionParam === "player" ||
      sectionParam === "queue" ||
      sectionParam === "history"
        ? sectionParam
        : "browse",
    screen:
      screenParam === "tracks" || screenParam === "editor"
        ? screenParam
        : "albums",
    editorMode:
      editorParam === "album" || editorParam === "track"
        ? editorParam
        : null,
    albumId: parsePositiveInt(searchParams.get("albumId")),
    musicId: parsePositiveInt(searchParams.get("musicId")),
    search: searchParams.get("q") || "",
    albumPage: parsePositiveInt(searchParams.get("albumPage")) || 1,
    trackPage: parsePositiveInt(searchParams.get("trackPage")) || 1,
  });
}

function normalizeMusicPlayerPath(pathname: string) {
  if (pathname === MUSIC_PLAYER_PATH) {
    return "";
  }

  if (pathname.startsWith(`${MUSIC_PLAYER_PATH}/`)) {
    return pathname.slice(MUSIC_PLAYER_PATH.length);
  }

  return "";
}

function parsePathRouteState(pathname: string): Partial<MusicPlayerRouteState> {
  const relativePath = normalizeMusicPlayerPath(pathname);
  const segments = relativePath.split("/").filter(Boolean);
  const [first, second, third] = segments;

  if (first === "player" || first === "queue" || first === "history") {
    return { section: first };
  }

  if (!first) {
    return { section: "browse", screen: "albums" };
  }

  if (first === "tracks") {
    if (third === "edit") {
      const musicId = parsePositiveInt(second || null);
      if (musicId != null) {
        return {
          section: "browse",
          screen: "editor",
          editorMode: "track",
          musicId,
        };
      }
    }

    return {
      section: "browse",
      screen: "tracks",
      albumId: null,
      editorMode: null,
      musicId: null,
    };
  }

  if (first === "albums") {
    const albumId = parsePositiveInt(second || null);

    if (albumId == null) {
      return {
        section: "browse",
        screen: "albums",
      };
    }

    if (third === "edit") {
      return {
        section: "browse",
        screen: "editor",
        editorMode: "album",
        albumId,
      };
    }

    return {
      section: "browse",
      screen: "tracks",
      albumId,
      editorMode: null,
      musicId: null,
    };
  }

  return { section: "browse", screen: "albums" };
}

export function parseMusicPlayerRouteStateFromLocation(
  pathname: string,
  searchParams: URLSearchParams,
): MusicPlayerRouteState {
  const queryState = parseQueryRouteState(searchParams);
  const pathState = parsePathRouteState(pathname);

  if (
    pathState.section === "player" ||
    pathState.section === "queue" ||
    pathState.section === "history"
  ) {
    return normalizeMusicPlayerRouteState({
      ...queryState,
      section: pathState.section,
    });
  }

  if (pathState.screen || pathState.editorMode || pathState.albumId != null || pathState.musicId != null) {
    return normalizeMusicPlayerRouteState({
      ...queryState,
      ...pathState,
      section: "browse",
    });
  }

  return queryState;
}

export function normalizeMusicPlayerRouteState(
  routeState: MusicPlayerRouteState,
): MusicPlayerRouteState {
  const next: MusicPlayerRouteState = {
    section:
      routeState.section === "player" ||
      routeState.section === "queue" ||
      routeState.section === "history"
        ? routeState.section
        : "browse",
    screen:
      routeState.screen === "tracks" || routeState.screen === "editor"
        ? routeState.screen
        : "albums",
    editorMode:
      routeState.editorMode === "album" || routeState.editorMode === "track"
        ? routeState.editorMode
        : null,
    albumId: routeState.albumId && routeState.albumId > 0 ? routeState.albumId : null,
    musicId: routeState.musicId && routeState.musicId > 0 ? routeState.musicId : null,
    search: routeState.search || "",
    albumPage: Math.max(1, Math.floor(routeState.albumPage || 1)),
    trackPage: Math.max(1, Math.floor(routeState.trackPage || 1)),
  };

  if (next.screen === "albums") {
    return {
      ...next,
      editorMode: null,
      albumId: null,
      musicId: null,
    };
  }

  if (next.screen === "tracks") {
    return {
      ...next,
      editorMode: null,
      musicId: null,
    };
  }

  if (next.editorMode === "album" && next.albumId != null) {
    return {
      ...next,
      musicId: null,
    };
  }

  if (next.editorMode === "track" && next.musicId != null) {
    return next;
  }

  if (next.albumId != null) {
    return {
      ...next,
      screen: "tracks",
      editorMode: null,
      musicId: null,
    };
  }

  return {
    ...next,
    screen: "albums",
    editorMode: null,
    albumId: null,
    musicId: null,
  };
}

function buildMusicPlayerPath(routeState: MusicPlayerRouteState) {
  const next = normalizeMusicPlayerRouteState(routeState);

  if (next.section === "player" || next.section === "queue" || next.section === "history") {
    return `${MUSIC_PLAYER_PATH}/${next.section}`;
  }

  if (next.screen === "tracks") {
    return next.albumId != null
      ? `${MUSIC_PLAYER_PATH}/albums/${next.albumId}/tracks`
      : `${MUSIC_PLAYER_PATH}/tracks`;
  }

  if (next.screen === "editor") {
    if (next.editorMode === "album" && next.albumId != null) {
      return `${MUSIC_PLAYER_PATH}/albums/${next.albumId}/edit`;
    }
    if (next.editorMode === "track" && next.musicId != null) {
      return `${MUSIC_PLAYER_PATH}/tracks/${next.musicId}/edit`;
    }
  }

  return MUSIC_PLAYER_PATH;
}

export function buildMusicPlayerSearchParams(routeState: MusicPlayerRouteState) {
  const next = normalizeMusicPlayerRouteState(routeState);
  const params = new URLSearchParams();

  const keepBrowseContextInQuery = next.section !== "browse";

  if (keepBrowseContextInQuery && next.screen !== DEFAULT_ROUTE_STATE.screen) {
    params.set("screen", next.screen);
  }
  if (keepBrowseContextInQuery && next.screen === "editor" && next.editorMode) {
    params.set("editor", next.editorMode);
  }
  if (keepBrowseContextInQuery && next.albumId != null) {
    params.set("albumId", String(next.albumId));
  }
  if (keepBrowseContextInQuery && next.musicId != null) {
    params.set("musicId", String(next.musicId));
  }
  if (next.search) {
    params.set("q", next.search);
  }
  if (next.albumPage > 1) {
    params.set("albumPage", String(next.albumPage));
  }
  if (next.trackPage > 1) {
    params.set("trackPage", String(next.trackPage));
  }

  return params;
}

export function buildMusicPlayerLocation(
  routeState: MusicPlayerRouteState,
): MusicPlayerRouteLocation {
  const next = normalizeMusicPlayerRouteState(routeState);
  return {
    pathname: buildMusicPlayerPath(next),
    searchParams: buildMusicPlayerSearchParams(next),
  };
}

export function patchMusicPlayerRouteState(
  currentPathname: string,
  currentSearchParams: URLSearchParams,
  patch: Partial<MusicPlayerRouteState>,
) {
  const current = parseMusicPlayerRouteStateFromLocation(currentPathname, currentSearchParams);
  const next = buildMusicPlayerLocation({
    ...current,
    ...patch,
  });
  const merged = new URLSearchParams(currentSearchParams);

  KNOWN_ROUTE_KEYS.forEach((key) => {
    merged.delete(key);
  });

  next.searchParams.forEach((value, key) => {
    merged.set(key, value);
  });

  return {
    pathname: next.pathname,
    searchParams: merged,
  };
}
