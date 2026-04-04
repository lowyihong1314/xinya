import ReactDOM from "react-dom/client";

import { ChangyouRoomPublicPage } from "./src/music/changyou/react/room/ChangyouRoomPublicPage";

<<<<<<< HEAD
=======
type ChangyouRoomPublicVariant = "default" | "v2";

>>>>>>> 7410128 (update changyou)
function readRoomId() {
  const mountNode = document.getElementById("root") ?? document.getElementById("app");
  if (!mountNode) {
    throw new Error("React mount node not found. Expected #root or #app.");
  }

  const dataRoomId = mountNode.getAttribute("data-room-id");
<<<<<<< HEAD
  if (dataRoomId) {
    return { mountNode, roomId: dataRoomId };
=======
  const variant = mountNode.getAttribute("data-room-view") === "v2" ? "v2" : "default";
  if (dataRoomId) {
    return { mountNode, roomId: dataRoomId, variant: variant as ChangyouRoomPublicVariant };
>>>>>>> 7410128 (update changyou)
  }

  const segments = window.location.pathname.split("/").filter(Boolean);
  const roomId = segments[segments.length - 1];
  if (!roomId) {
    throw new Error("Room ID not found in mount node or URL path.");
  }
<<<<<<< HEAD
  return { mountNode, roomId: decodeURIComponent(roomId) };
}

const { mountNode, roomId } = readRoomId();

ReactDOM.createRoot(mountNode as HTMLElement).render(<ChangyouRoomPublicPage roomId={roomId} />);
=======
  return { mountNode, roomId: decodeURIComponent(roomId), variant: variant as ChangyouRoomPublicVariant };
}

const { mountNode, roomId, variant } = readRoomId();

ReactDOM.createRoot(mountNode as HTMLElement).render(
  <ChangyouRoomPublicPage roomId={roomId} variant={variant} />,
);
>>>>>>> 7410128 (update changyou)
