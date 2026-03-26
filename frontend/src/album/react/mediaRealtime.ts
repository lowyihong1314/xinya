import { io, type Socket } from "socket.io-client";

const SOCKET_ORIGIN = "https://utbabuddha.com";
export const MEDIA_ROOM_UPDATE_EVENT = "media_room_update";

export type MediaNotification = {
  event?: string;
  room?: string;
  event_code?: string;
  timestamp?: string;
  event_id?: number;
  file_id?: number;
  file_name?: string;
  file_type?: string;
  user_id?: number;
  username?: string;
  video_id?: number;
  video?: string;
  type?: string;
  percent?: number;
  current?: number;
  total?: number;
  eta?: number | null;
  angle?: number;
  force?: boolean;
  variant?: string;
  value?: string;
};

function getSocketOrigin() {
  return SOCKET_ORIGIN;
}

function getEventMediaSocketRoom(eventCode: string) {
  return `media:${eventCode}`;
}

export async function connectEventMediaRoom(eventCode: string) {
  const socket: Socket = io(getSocketOrigin(), {
    withCredentials: true,
    transports: ["websocket", "polling"],
  });

  const joinRoom = () => {
    socket.emit("join_room", { room: getEventMediaSocketRoom(eventCode) });
  };

  socket.on("connect", joinRoom);
  if (socket.connected) {
    joinRoom();
  }

  return socket;
}
