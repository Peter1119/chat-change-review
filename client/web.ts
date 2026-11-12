import { Platform } from "react-native";

// Not an official Paseo API: reads the settings the desktop (web) app keeps in localStorage.
const SETTINGS_KEYS = ["@paseo:app-settings", "@paseo:settings"] as const;

type WebStorage = { getItem(key: string): string | null };
type StorageEvent = { key: string | null };
type WebWindow = {
  localStorage?: WebStorage;
  addEventListener(type: "storage", listener: (event: StorageEvent) => void): void;
  removeEventListener(type: "storage", listener: (event: StorageEvent) => void): void;
};

export type CodeFontSettings = { size: number | null; family: string | null };

function webWindow(): WebWindow | null {
  if (Platform.OS !== "web") return null;
  return (globalThis as { window?: WebWindow }).window ?? null;
}

// The value may be JSON-encoded twice, so decode up to two times.
function decode(raw: string): Record<string, unknown> | null {
  let value: unknown = raw;
  for (let attempt = 0; attempt < 2 && typeof value === "string"; attempt += 1) {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

export function readCodeFontSettings(): CodeFontSettings {
  const empty = { size: null, family: null };
  try {
    const storage = webWindow()?.localStorage;
    if (!storage) return empty;
    for (const key of SETTINGS_KEYS) {
      const raw = storage.getItem(key);
      const settings = raw ? decode(raw) : null;
      if (!settings) continue;
      const size = typeof settings.codeFontSize === "number" && Number.isFinite(settings.codeFontSize)
        ? Math.min(22, Math.max(9, Math.round(settings.codeFontSize)))
        : null;
      const family = typeof settings.monoFontFamily === "string" && settings.monoFontFamily.trim()
        ? settings.monoFontFamily.trim()
        : null;
      return { size, family };
    }
  } catch {
    return empty;
  }
  return empty;
}

export function subscribeSettingsChange(listener: () => void): () => void {
  const target = webWindow();
  if (!target) return () => {};
  const handler = (event: StorageEvent) => {
    if (event.key === null || SETTINGS_KEYS.some((key) => key === event.key)) listener();
  };
  target.addEventListener("storage", handler);
  return () => target.removeEventListener("storage", handler);
}
