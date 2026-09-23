/**
 * 关于我们 / 历史 / 树洞。
 *
 * **只有这个文件知道 /info/* 接口长什么样**。页面组件一律通过这里的函数取数，
 * 不要在组件里直接写路径 —— 接口一改就得全仓搜。
 *
 * 后端：backend/api/content/router.py（挂载前缀 /info）
 * ⚠️ 前端路由用的是 /about（后端占着 /info，撞车了）。见 docs/frontend_rewrite/01。
 */
import { http } from "@/shared/api/client";

import type { AboutUsEntry, HistoryEntry, TreeHoleMessage } from "./types";

export const aboutKeys = {
  all: ["about"] as const,
  aboutUs: () => [...aboutKeys.all, "about-us"] as const,
  history: () => [...aboutKeys.all, "history"] as const,
  treeHole: () => [...aboutKeys.all, "tree-hole"] as const,
};

/** 这两条是**公开**的（后端没挂 login_required），未登录也能看。 */
export const fetchAboutUs = () => http.get<AboutUsEntry[]>("/info/get_about_us_text");
export const fetchHistory = () => http.get<HistoryEntry[]>("/info/get_our_history");

/** 树洞要 view_tree_hole 权限；没权限时后端回 403 + 中文文案，由 ErrorState 显示。 */
export const fetchTreeHole = () => http.get<TreeHoleMessage[]>("/info/tree_hole/messages");

export const createTreeHoleMessage = (content: string) =>
  http.post("/info/tree_hole/messages", { content });

export const deleteTreeHoleMessage = (id: number) =>
  http.delete(`/info/tree_hole/messages/${id}`);
