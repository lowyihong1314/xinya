import { RouterProvider } from "react-router-dom";

import { UserStateProvider } from "./UserState";
import { EventDataProvider } from "../event/shared/EventDataContext";
import { MusicPlaybackProvider } from "../music/react/MusicPlaybackContext";
import { appRouter } from "../router/appRouter";

export function App({ initialIsMobile = false }: { initialIsMobile?: boolean }) {
  return (
    <UserStateProvider initialIsMobile={initialIsMobile}>
      <EventDataProvider>
        <MusicPlaybackProvider>
          <RouterProvider router={appRouter} />
        </MusicPlaybackProvider>
      </EventDataProvider>
    </UserStateProvider>
  );
}
