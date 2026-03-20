function resolveApp(hostElement?: HTMLElement | null): HTMLElement | null {
  return hostElement || window.app || document.getElementById("app");
}

export function reset_style(hostElement?: HTMLElement | null) {
  const app = resolveApp(hostElement);
  if (!app) {
    return;
  }

  app.innerHTML = "";
  Object.assign(app.style, {
    minHeight: "",
    background: "",
    paddingTop: "",
    overflow: "",
  });
}
