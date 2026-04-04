import ReactDOM from "react-dom/client";

import { ChangyouRoomPublicPage } from "./src/music/changyou/react/room/ChangyouRoomPublicPage";

function readRoomId() {
  const mountNode = document.getElementById("root") ?? document.getElementById("app");
  if (!mountNode) {
    throw new Error("React mount node not found. Expected #root or #app.");
  }

  const dataRoomId = mountNode.getAttribute("data-room-id");
  if (dataRoomId) {
    return { mountNode, roomId: dataRoomId };
  }

  const segments = window.location.pathname.split("/").filter(Boolean);
  const roomId = segments[segments.length - 1];
  if (!roomId) {
    throw new Error("Room ID not found in mount node or URL path.");
  }
  return { mountNode, roomId: decodeURIComponent(roomId) };
}

const { mountNode, roomId } = readRoomId();

ReactDOM.createRoot(mountNode as HTMLElement).render(<ChangyouRoomPublicPage roomId={roomId} />);
