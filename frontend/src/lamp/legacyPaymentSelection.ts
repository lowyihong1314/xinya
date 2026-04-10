const LEGACY_LAMP_PAYMENT_SELECTION_KEY = "xinya.lamp.legacyPaymentSelection";

export function stashLegacyLampPaymentSelection(selected: unknown) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(
      LEGACY_LAMP_PAYMENT_SELECTION_KEY,
      JSON.stringify(Array.isArray(selected) ? selected : []),
    );
  } catch {
    console.warn("Unable to persist legacy lamp payment selection.");
  }
}

export function takeLegacyLampPaymentSelection<T>() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(LEGACY_LAMP_PAYMENT_SELECTION_KEY);
    window.sessionStorage.removeItem(LEGACY_LAMP_PAYMENT_SELECTION_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    window.sessionStorage.removeItem(LEGACY_LAMP_PAYMENT_SELECTION_KEY);
    return null;
  }
}
