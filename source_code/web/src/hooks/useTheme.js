import { useCallback, useEffect, useState } from "react";

// 'light' | 'dark' | 'system' — 'system' means "no explicit choice made
// yet," which is the initial state and also what a user can pick to go
// back to following the OS. Persisted so the choice survives a reload.
const STORAGE_KEY = "smarthome-theme";

function applyTheme(pref) {
  const root = document.documentElement;
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
}

function resolvedTheme(pref) {
  if (pref !== "system") return pref;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme() {
  const [preference, setPreference] = useState(() => localStorage.getItem(STORAGE_KEY) || "system");
  const [resolved, setResolved] = useState(() => resolvedTheme(preference));

  useEffect(() => {
    applyTheme(preference);
    setResolved(resolvedTheme(preference));
    if (preference === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, preference);
  }, [preference]);

  // Track OS changes live while following 'system', so the page updates
  // without needing a reload if the user flips their OS theme mid-session.
  useEffect(() => {
    if (preference !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(resolvedTheme("system"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preference]);

  const toggle = useCallback(() => {
    setPreference((prev) => (resolvedTheme(prev) === "dark" ? "light" : "dark"));
  }, []);

  return { theme: resolved, preference, setPreference, toggle };
}
