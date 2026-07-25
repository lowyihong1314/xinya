// 显示用途时去掉开头的「【做账分配：xxx】」前缀（做账分配不在用途里展示）。
export function displayPurpose(purpose?: string | null): string {
  if (!purpose) return "";
  return purpose.replace(/^【做账分配：[^】]*】\s*/u, "").trim();
}
