/**
 * 应用入口。**全仓唯一一个。**
 *
 * 旧前端有 8 个入口（main / musicPortal / formPublic / changyouRoom …），
 * 各自配一份后端模板，为的是分包。按路由懒加载能达到同样效果，
 * 而且不用维护 8 份入口 + 8 份模板 —— 那 8 份已经删掉。
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@/shared/styles/globals.css";
import { App } from "./app/App";

const container = document.getElementById("root");
if (!container) {
  throw new Error('找不到 #root —— 检查 index.html 是否有 <div id="root">');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
