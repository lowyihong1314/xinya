import { io, type Socket } from "socket.io-client";

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
  if (typeof window === "undefined") {
    return "https://utbabuddha.com";
  }

  const { hostname, origin } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "https://utbabuddha.com";
  }

  return origin;
}

export async function connectEventMediaRoom(eventCode: string) {
  const socket: Socket = io(getSocketOrigin(), {
    withCredentials: true,
    transports: ["websocket", "polling"],
  });

  const joinRoom = () => {
    socket.emit("join_room", { room: eventCode });
  };

  socket.on("connect", joinRoom);
  if (socket.connected) {
    joinRoom();
  }

  return socket;
}
