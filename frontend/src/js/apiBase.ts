// Set by VITE_API_BASE at build time.
// Empty string = relative paths (normal web build).
// "https://utbabuddha.com" = absolute URLs (APK build).
export const API_BASE: string = (import.meta.env.VITE_API_BASE as string) ?? "";
