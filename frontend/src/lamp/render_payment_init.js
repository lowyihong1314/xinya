import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { LampPage } from "./react/LampPage";
import { LampPaymentPage } from "./react/LampPaymentPage";
import { LAMP_META, render_lamp_init } from "./render_lamp_init.js";

const ROOT_KEY = "__xinyaLampRoot";

export { LAMP_META };

export function render_payment_init(app, selected) {
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
  root.render(
    createElement(LampPaymentPage, {
      hostElement: app,
      selected: Array.isArray(selected) ? selected : [],
      onBack: () => render_lamp_init(app),
      onCompleted: () => {
        root.render(createElement(LampPage, { hostElement: app }));
      },
    }),
  );
}
