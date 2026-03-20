import React from "react";
import ReactDOM from "react-dom/client";
import faCss from "@fortawesome/fontawesome-free/css/all.min.css?url";

import { App } from "./src/app/App";

function detectMobile() {
  if (typeof window === "undefined") {
    return false;
  }
  return window.matchMedia("(max-width: 900px)").matches;
}

(function mountCssOnce(href: string) {
  if ([...document.styleSheets].some((sheet) => sheet.href?.includes(href))) {
    return;
  }

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
})(faCss);

const mountNode = document.getElementById("root") ?? document.getElementById("app");

if (!mountNode) {
  throw new Error("React mount node not found. Expected #root or #app.");
}

ReactDOM.createRoot(mountNode as HTMLElement).render(<App initialIsMobile={detectMobile()} />);
