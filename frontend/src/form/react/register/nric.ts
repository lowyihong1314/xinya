// NRIC → 出生日期 / 年龄（完整生日口径，和旧 register/nric.js 一致；age < 19 需家长同意书）。

export function parseDobFromIc(icRaw: string): Date | null {
  const digits = String(icRaw || "").replace(/\D/g, "");
  if (digits.length < 6) return null;
  const yy = Number(digits.slice(0, 2));
  const mm = Number(digits.slice(2, 4));
  const dd = Number(digits.slice(4, 6));
  if (![yy, mm, dd].every((n) => Number.isFinite(n))) return null;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;

  const today = new Date();
  const curYY = Number(String(today.getFullYear()).slice(-2));
  const year = yy > curYY ? 1900 + yy : 2000 + yy;
  const dob = new Date(year, mm - 1, dd);
  if (dob.getFullYear() !== year || dob.getMonth() !== mm - 1 || dob.getDate() !== dd) return null;
  return dob;
}

export function calcAgeFromIc(icRaw: string): number | null {
  const dob = parseDobFromIc(icRaw);
  if (!dob) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDelta = today.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < dob.getDate())) age -= 1;
  if (!Number.isFinite(age) || age < 0 || age > 120) return null;
  return age;
}
