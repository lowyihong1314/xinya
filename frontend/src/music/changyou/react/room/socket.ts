import { io, type Socket } from "socket.io-client";

const SOCKET_ORIGIN = "https://utbabuddha.com";

function getChangyouSocketRoom(roomId: string) {
  return `changyou:${roomId}`;
}

function getSocketOrigin() {
  return SOCKET_ORIGIN;
}

export type ChangyouSocketOptions = {
  /**
   * 每次 connect（含断线重连）加入房间后调用。
   * socket.io 重连只会重新 join，断线期间错过的 changyou_room_update 不会补发，
   * 调用方应在这里重新拉 /current 做状态对账。reconnect 为 true 表示不是首次连接。
   */
  onConnect?: (info: { reconnect: boolean }) => void;
};

export function connectChangyouRoom(roomId: string, options: ChangyouSocketOptions = {}) {
  const socket: Socket = io(getSocketOrigin(), {
    withCredentials: false,
    transports: ["websocket", "polling"],
  });
  let hasConnectedOnce = false;
  const join = () => socket.emit("join_room", { room: getChangyouSocketRoom(roomId) });
  const handleConnect = () => {
    join();
    const reconnect = hasConnectedOnce;
    hasConnectedOnce = true;
    options.onConnect?.({ reconnect });
  };
  socket.on("connect", handleConnect);
  if (socket.connected) handleConnect();
  return socket;
}
