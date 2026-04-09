import { RouterProvider } from "react-router-dom";

import { UserStateProvider } from "../../../app/UserState";
import { MusicPlaybackProvider } from "../../music_player/logic/MusicPlaybackContext";
import { musicPortalRouter } from "../router/musicPortalRouter";

export function MusicPortalApp({ initialIsMobile = false }: { initialIsMobile?: boolean }) {
  return (
    <UserStateProvider initialIsMobile={initialIsMobile}>
      <MusicPlaybackProvider>
        <RouterProvider router={musicPortalRouter} />
      </MusicPlaybackProvider>
    </UserStateProvider>
  );
}
