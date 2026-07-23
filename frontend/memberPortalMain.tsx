import ReactDOM from "react-dom/client";

import { MemberPortalPage } from "./src/form/react/member_portal/MemberPortalPage";

const mount = document.getElementById("root") ?? document.getElementById("app");
if (!mount) {
  throw new Error("Member portal mount node not found. Expected #root or #app.");
}
ReactDOM.createRoot(mount as HTMLElement).render(<MemberPortalPage />);
