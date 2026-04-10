import { RouterProvider } from "react-router-dom";

import { OverlayProvider } from "./OverlayProvider";
import { UserStateProvider } from "./UserState";
import { EventDataProvider } from "../event/shared/EventDataContext";
import { IS_APK } from "../js/apiBase";
import { MusicPlaybackProvider } from "../music/music_player/logic/MusicPlaybackContext";
import { appRouter } from "../router/appRouter";

export function App({ initialIsMobile = false }: { initialIsMobile?: boolean }) {
  return (
    <UserStateProvider initialIsMobile={initialIsMobile}>
      <EventDataProvider>
        <OverlayProvider>
          {IS_APK ? (
            <RouterProvider router={appRouter} />
          ) : (
            <MusicPlaybackProvider>
              <RouterProvider router={appRouter} />
            </MusicPlaybackProvider>
          )}
        </OverlayProvider>
      </EventDataProvider>
    </UserStateProvider>
  );
}
