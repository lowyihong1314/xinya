import ReactDOM from "react-dom/client";

import { RegisterPage } from "./src/form/react/register/RegisterPage";

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
  return { mountNode, formId };
}

const { mountNode, formId } = readMount();

ReactDOM.createRoot(mountNode as HTMLElement).render(<RegisterPage formId={formId} />);
