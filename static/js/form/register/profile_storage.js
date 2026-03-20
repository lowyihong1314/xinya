const PROFILE_STORAGE_KEY = "xinya_form_register_profile_v1";

function readStorage() {
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.warn("[form-register] failed to read profile storage", error);
    return {};
  }
}

export function loadRegisterProfile() {
  if (typeof window === "undefined" || !window.localStorage) {
    return {};
  }
  return readStorage();
}

export function saveRegisterProfile(nextProfile) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    const prev = readStorage();
    const merged = { ...prev, ...sanitizeProfile(nextProfile) };
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(merged));
  } catch (error) {
    console.warn("[form-register] failed to save profile storage", error);
  }
}

export function clearRegisterProfile() {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.removeItem(PROFILE_STORAGE_KEY);
  } catch (error) {
    console.warn("[form-register] failed to clear profile storage", error);
  }
}

function sanitizeProfile(profile) {
  if (!profile || typeof profile !== "object") {
    return {};
  }

  return {
    name: normalize(profile.name),
    name_cn: normalize(profile.name_cn),
    phone: normalize(profile.phone),
    nric: normalize(profile.nric),
    gender: normalize(profile.gender),
    email: normalize(profile.email),
    address: normalize(profile.address),
    parent_1: normalize(profile.parent_1),
    parent_1_phone: normalize(profile.parent_1_phone),
    parent_2: normalize(profile.parent_2),
    parent_2_phone: normalize(profile.parent_2_phone),
    parent_cn: normalize(profile.parent_cn),
    parent_en: normalize(profile.parent_en),
    parent_nric: normalize(profile.parent_nric),
    parent_phone: normalize(profile.parent_phone),
    child_cn: normalize(profile.child_cn),
    child_en: normalize(profile.child_en),
    child_nric: normalize(profile.child_nric),
    child_phone: normalize(profile.child_phone),
  };
}

function normalize(value) {
  if (value == null) {
    return "";
  }
  return String(value).trim();
}
