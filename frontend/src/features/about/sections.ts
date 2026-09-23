/**
 * 简介页的四个分节。**与旧版对齐**（原 src/info/react/InfoPage.tsx 的
 * INFO_SECTION_ITEMS）—— 标题、eyebrow、副标题一字未改，用户已经认得。
 *
 * 旧地址是 /info/:section，新地址是 /about/:section
 * （后端占着 /info/*，撞车的前端路由永远到不了浏览器）。
 */
export const ABOUT_SECTIONS = [
  {
    key: "history",
    title: "地南佛学会历程",
    eyebrow: "History",
    subtitle: "沿着年份回看地南佛学会的重要节点与故事。",
  },
  {
    key: "about",
    title: "我们的简介",
    eyebrow: "About",
    subtitle: "认识地南佛学会的宗旨、气质与日常面貌。",
  },
  {
    key: "members",
    title: "成员",
    eyebrow: "Members",
    subtitle: "浏览成员资料与彼此当前的公共展示信息。",
  },
  {
    key: "tree-hole",
    title: "树洞",
    eyebrow: "Tree Hole",
    subtitle: "匿名留言。需要权限才看得到。",
  },
] as const;

export type AboutSectionKey = (typeof ABOUT_SECTIONS)[number]["key"];

/** 默认分节。旧版进 /info 会 Navigate 到 /info/history。 */
export const DEFAULT_SECTION: AboutSectionKey = "history";

export function isAboutSection(value: string | undefined): value is AboutSectionKey {
  return ABOUT_SECTIONS.some((s) => s.key === value);
}
