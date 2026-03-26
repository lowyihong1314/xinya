import { RouterProvider } from "react-router-dom";

import { UserStateProvider } from "./UserState";
import { EventDataProvider } from "../event/shared/EventDataContext";
import { ApkMusicRuntime } from "../music/music_player/ApkMusicRuntime";
import { MusicPlaybackProvider } from "../music/music_player/MusicPlaybackContext";
import { appRouter } from "../router/appRouter";

export function App({ initialIsMobile = false }: { initialIsMobile?: boolean }) {
  return (
    <UserStateProvider initialIsMobile={initialIsMobile}>
      <EventDataProvider>
        <MusicPlaybackProvider>
          <ApkMusicRuntime />
          <RouterProvider router={appRouter} />
        </MusicPlaybackProvider>
      </EventDataProvider>
    </UserStateProvider>
  );
}
