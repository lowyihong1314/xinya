import { io, type Socket } from 'socket.io-client';

function getSocketOrigin() {
  if (typeof window === 'undefined') return 'https://utbabuddha.com';
  const { hostname, origin } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'https://utbabuddha.com';
  return origin;
}

export function connectChangyouRoom(roomId: string) {
  const socket: Socket = io(getSocketOrigin(), {
    withCredentials: true,
    transports: ['websocket', 'polling'],
  });
  const join = () => socket.emit('changyou_join_room', { room_id: roomId });
  socket.on('connect', join);
  if (socket.connected) join();
  return socket;
}
