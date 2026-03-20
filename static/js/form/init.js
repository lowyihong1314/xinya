import { handleEntry } from "./register/poster.js";
export {
  available_time_slot_json,
  lastEvent,
} from "./register/state.js";

function bootstrapFormPage() {
  if (!window.form_data) {
    console.error("form_data not found");
    return;
  }

  const container = document.querySelector(".container");
  if (!container) {
    return;
  }

  Object.assign(container.style, {
    position: "relative",
    minHeight: "100vh",
    width: "100%",
    overflow: "hidden",
    boxSizing: "border-box",
  });

  const bgLayer = document.createElement("div");
  Object.assign(bgLayer.style, {
    position: "absolute",
    inset: "0",
    zIndex: "0",
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    filter: "blur(14px)",
    transform: "scale(1.1)",
  });

  const ogMeta = document.querySelector('meta[property="og:image"]');
  const bgUrl = ogMeta?.getAttribute("content");
  if (bgUrl) {
    bgLayer.style.backgroundImage = `url("${bgUrl}")`;
  }

  const overlay = document.createElement("div");
  Object.assign(overlay.style, {
    position: "absolute",
    inset: "0",
    zIndex: "1",
  });

  const content = document.createElement("div");
  Object.assign(content.style, {
    position: "relative",
    zIndex: "2",
    width: "100%",
    maxWidth: "680px",
    margin: "0 auto",
    padding: "24px",
    boxSizing: "border-box",
  });

  while (container.firstChild) {
    content.appendChild(container.firstChild);
  }

  container.append(bgLayer, overlay, content);
  handleEntry(window.form_data);
}

document.addEventListener("DOMContentLoaded", bootstrapFormPage);
