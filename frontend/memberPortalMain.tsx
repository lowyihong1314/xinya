import ReactDOM from "react-dom/client";
import faCss from "@fortawesome/fontawesome-free/css/all.min.css?url";

import { ensureDesignTokens } from "./src/theme/designTokens";
import { MemberPortalPage } from "./src/form/react/member_portal/MemberPortalPage";

// 成员终端是独立入口：主 App 不在这里，需自己注入 FontAwesome + 设计令牌 CSS 变量，
// 否则内嵌的 EventFlowInline 等组件的图标 / 边框(var(--x-color-*)) 会消失。
(function mountCssOnce(href: string) {
  if ([...document.styleSheets].some((sheet) => sheet.href?.includes(href))) {
    return;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
})(faCss);

ensureDesignTokens();

const mount = document.getElementById("root") ?? document.getElementById("app");
if (!mount) {
  throw new Error("Member portal mount node not found. Expected #root or #app.");
}
ReactDOM.createRoot(mount as HTMLElement).render(<MemberPortalPage />);
