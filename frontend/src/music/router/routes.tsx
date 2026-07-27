import type { RouteObject } from "react-router-dom";
import { Navigate, Outlet } from "react-router-dom";

import { IS_APK } from "../../js/apiBase";
import { ChangyouDetailPage } from "../changyou/react/ChangyouDetailPage";
import { ChangyouPage } from "../changyou/react/ChangyouPage";
import { ChangyouRoomPage } from "../changyou/react/room/ChangyouRoomPage";
import { ChangyouRoomPublicAppPage } from "../changyou/react/room/ChangyouRoomPublicPage";
import { MusicPage } from "../music_player/ui/web/MusicPage";
import { MusicPageApk } from "../music_player/apk/MusicPageApk";
import { GamePlayerPage } from "../turntable/game/GamePlayerPage";
import { QuizGuestPage } from "../turntable/quiz/QuizGuestPage";
import { TurntablePage } from "../turntable/TurntablePage";

export const musicRoute: RouteObject = {
  path: "music",
  element: <Outlet />,
  children: [
    { index: true, element: <Navigate to="music_player" replace /> },
    { path: "music_player/*", element: IS_APK ? <MusicPageApk /> : <MusicPage /> },
    { path: "turntable/quiz", element: <QuizGuestPage /> },
    { path: "turntable/game", element: <GamePlayerPage /> },
    { path: "turntable", element: <TurntablePage /> },
    { path: "changyou", element: <ChangyouPage /> },
    { path: "changyou/:entryId", element: <ChangyouDetailPage /> },
    { path: "changyou/room", element: <ChangyouRoomPage /> },
    { path: "changyou/room/player/:roomId", element: <ChangyouRoomPublicAppPage /> },
    { path: "changyou/room/:roomId", element: <ChangyouRoomPage /> },
  ],
};
