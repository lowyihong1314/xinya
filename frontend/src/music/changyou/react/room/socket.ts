import { io, type Socket } from "socket.io-client";

const SOCKET_ORIGIN = "https://utbabuddha.com";

function getChangyouSocketRoom(roomId: string) {
  return `changyou:${roomId}`;
}

function getSocketOrigin() {
  return SOCKET_ORIGIN;
}

export function connectChangyouRoom(roomId: string) {
  const socket: Socket = io(getSocketOrigin(), {
    withCredentials: false,
    transports: ["websocket", "polling"],
  });
  const join = () => socket.emit("join_room", { room: getChangyouSocketRoom(roomId) });
  socket.on("connect", join);
  if (socket.connected) join();
  return socket;
}
