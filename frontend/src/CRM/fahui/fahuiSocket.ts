import { io, type Socket } from "socket.io-client";

import { API_BASE } from "../../js/apiBase";

function getSocketOrigin(): string {
  if (API_BASE) {
    return API_BASE;
  }
  if (typeof window === "undefined") {
    return "";
  }
  if (window.location.port === "5173") {
    return `${window.location.protocol}//${window.location.hostname}:5102`;
  }
  return window.location.origin;
}

export function connectFahuiSocket(): Socket {
  return io(getSocketOrigin(), {
    withCredentials: true,
    transports: ["websocket", "polling"],
  });
}
