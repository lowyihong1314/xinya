function getSocketOrigin() {
  if (typeof window === "undefined") {
    return "https://utbabuddha.com";
  }
  return window.location.origin;
}

function loadSocketIoScript() {
  return new Promise((resolve, reject) => {
    if (typeof window !== "undefined" && typeof window.io === "function") {
      resolve(window.io);
      return;
    }

    const existing = document.querySelector('script[data-xinya-socket-io="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.io), { once: true });
      existing.addEventListener("error", () => reject(new Error("socket.io 加载失败")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.socket.io/4.8.1/socket.io.min.js";
    script.async = true;
    script.dataset.xinyaSocketIo = "true";
    script.onload = () => resolve(window.io);
    script.onerror = () => reject(new Error("socket.io 加载失败"));
    document.head.appendChild(script);
  });
}

export async function connectParentalSignRoom(room, onMessage) {
  if (!room) {
    return null;
  }

  const ioFactory = await loadSocketIoScript();
  if (typeof ioFactory !== "function") {
    throw new Error("socket.io client 不可用");
  }

  const socket = ioFactory(getSocketOrigin(), {
    withCredentials: true,
    transports: ["websocket", "polling"],
  });

  const joinRoom = () => {
    socket.emit("join_room", { room });
  };

  socket.on("connect", joinRoom);
  if (socket.connected) {
    joinRoom();
  }

  const handleMessage = (message) => {
    if (!message || message.room !== room) {
      return;
    }
    onMessage?.(message);
  };

  socket.on("parental_sign_data", handleMessage);

  return {
    socket,
    emitSign(sign_json_data) {
      socket.emit("parental_sign_sync", {
        room,
        sign_json_data,
      });
    },
    disconnect() {
      socket.off("parental_sign_data", handleMessage);
      socket.disconnect();
    },
  };
}

export function buildParentalRoomId(form, payload) {
  const formId = form?.id;
  const nric = String(payload?.nric || "").trim();
  if (!formId || !nric) {
    return "";
  }
  return `parental_sign_${formId}_${nric}`;
}

export function encodeShareJson(value) {
  const text = JSON.stringify(value ?? null);
  return btoa(unescape(encodeURIComponent(text)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function buildParentalShareUrl({ form, payload, parent, room }) {
  const url = new URL("/api/form/parental_sign", window.location.origin);
  url.searchParams.set("form", encodeShareJson(form));
  url.searchParams.set("payload", encodeShareJson(payload));
  url.searchParams.set("parent", encodeShareJson(parent || {}));
  if (room) {
    url.searchParams.set("room", room);
  }
  return url.toString();
}

export async function createShortParentalShareUrl({ form, payload, parent, room }) {
  const response = await fetch("/api/form/parental_sign_share", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      form,
      payload,
      parent: parent || {},
      room: room || "",
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.message || "创建家长签名链接失败");
  }

  if (result.url) {
    return result.url;
  }

  throw new Error("后端未返回家长签名链接");
}
