import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { LampPage } from "./react/LampPage";

const ROOT_KEY = "__xinyaLampRoot";

export const LAMP_META = {
  lamp_168: { label: "光明灯 + 供养八大菩萨", amount: 168, withAmount: false },
  lamp_88: { label: "光明灯", amount: 88, withAmount: false },
  gong_zai: { label: "随缘供斋 / 功德金", withAmount: true },
};

export async function render_lamp_init(app) {
  if (!app) {
    return;
  }

  app.removeAttribute("style");
  app.innerHTML = "";

  const mountNode = document.createElement("div");
  mountNode.style.minHeight = "100%";
  app.appendChild(mountNode);

  if (app[ROOT_KEY]) {
    app[ROOT_KEY].unmount();
  }

  const root = createRoot(mountNode);
  app[ROOT_KEY] = root;
  root.render(createElement(LampPage, { hostElement: app }));
}
