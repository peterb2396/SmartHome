import { FaMoon, FaSun } from "react-icons/fa";
import { useTheme } from "../hooks/useTheme";

// A single sun/moon toggle rather than a 3-way light/dark/system picker —
// 'system' is still honored as the initial state (see useTheme.js), this
// control just collapses to "flip to the opposite of however it's
// currently resolved" once the user actually touches it, which is what
// people expect from a toggle in a nav bar.
export default function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      style={{
        background: "var(--bg-surface-alt)",
        border: "1px solid var(--border)",
        color: "var(--text-secondary)",
        borderRadius: 8,
        width: 34, height: 34,
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer",
        fontSize: "0.9rem",
        flexShrink: 0,
      }}
    >
      {isDark ? <FaSun /> : <FaMoon />}
    </button>
  );
}
