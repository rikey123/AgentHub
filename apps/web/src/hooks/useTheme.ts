import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "auto";
export type Density = "cozy" | "compact";

const THEME_KEY = "agenthub.theme";
const DENSITY_KEY = "agenthub.density";

function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark" || stored === "auto") return stored;
  } catch {
    // ignore
  }
  return "auto";
}

function getStoredDensity(): Density {
  try {
    const stored = localStorage.getItem(DENSITY_KEY);
    if (stored === "cozy" || stored === "compact") return stored;
  } catch {
    // ignore
  }
  return "cozy";
}

function applyTheme(theme: Theme): void {
  const html = document.documentElement;
  if (theme === "auto") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    html.setAttribute("data-theme", prefersDark ? "dark" : "light");
  } else {
    html.setAttribute("data-theme", theme);
  }
}

function applyDensity(density: Density): void {
  document.documentElement.setAttribute("data-density", density);
}

export function useTheme(): {
  theme: Theme;
  density: Density;
  setTheme: (t: Theme) => void;
  setDensity: (d: Density) => void;
  toggleTheme: () => void;
  toggleDensity: () => void;
} {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);
  const [density, setDensityState] = useState<Density>(getStoredDensity);

  useEffect(() => {
    applyTheme(theme);
    applyDensity(density);
  }, [theme, density]);

  // Listen for system theme changes when in auto mode
  useEffect(() => {
    if (theme !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      applyTheme(e.matches ? "dark" : "light");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      // ignore
    }
    setThemeState(t);
  }, []);

  const setDensity = useCallback((d: Density) => {
    try {
      localStorage.setItem(DENSITY_KEY, d);
    } catch {
      // ignore
    }
    setDensityState(d);
  }, []);

  const toggleTheme = useCallback(() => {
    const next: Theme = theme === "light" ? "dark" : theme === "dark" ? "auto" : "light";
    setTheme(next);
  }, [theme, setTheme]);

  const toggleDensity = useCallback(() => {
    setDensity(density === "cozy" ? "compact" : "cozy");
  }, [density, setDensity]);

  return { theme, density, setTheme, setDensity, toggleTheme, toggleDensity };
}

export function initThemeOnMount(): void {
  applyTheme(getStoredTheme());
  applyDensity(getStoredDensity());
}
