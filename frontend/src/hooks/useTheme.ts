import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
const KEY = "ibible_theme";
const listeners = new Set<() => void>();

function current(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function applyTheme(theme: Theme) {
  // switch instantly: suppress colour transitions for a frame so cards don't animate between palettes
  const root = document.documentElement;
  root.classList.add("theme-switching");
  root.dataset.theme = theme;
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute("content", theme === "dark" ? "#0b1426" : "#f7f4ec");
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* storage unavailable */
  }
  listeners.forEach((l) => l());
}

export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    current,
    () => "light" as Theme,
  );
  return [theme, () => applyTheme(theme === "dark" ? "light" : "dark")];
}
