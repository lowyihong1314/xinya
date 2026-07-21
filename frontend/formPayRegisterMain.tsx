import ReactDOM from "react-dom/client";

import { PayRegisterPage } from "./src/form/react/PayRegisterPage";

function readMount() {
  const mountNode = document.getElementById("root") ?? document.getElementById("app");
  if (!mountNode) {
    throw new Error("React mount node not found. Expected #root or #app.");
  }

  const dataFormId = mountNode.getAttribute("data-form-id");
  let formId = dataFormId ? Number(dataFormId) : NaN;
  if (!Number.isFinite(formId)) {
    const segments = window.location.pathname.split("/").filter(Boolean);
    formId = Number(segments[segments.length - 1]);
  }
  if (!Number.isFinite(formId)) {
    throw new Error("Form ID not found in mount node or URL path.");
  }

  const formTitle = mountNode.getAttribute("data-form-title") || undefined;
  return { mountNode, formId, formTitle };
}

const { mountNode, formId, formTitle } = readMount();

ReactDOM.createRoot(mountNode as HTMLElement).render(
  <PayRegisterPage formId={formId} formTitle={formTitle} />,
);
