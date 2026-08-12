import { useState, useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { FaBars, FaTimes } from "react-icons/fa";
import ThemeToggle from "./components/ThemeToggle";

const LINKS = [
  { to: "/",        label: "Home"     },
  { to: "/sensors", label: "Sensors"  },
  { to: "/cameras", label: "Cameras"  },
  { to: "/finance", label: "Finance"  },
  { to: "/thermostat", label: "Thermostat" },
  { to: "/maintenance", label: "Maintenance" },
  { to: "/console", label: "Console" },
  { to: "/sound",   label: "Sound" },
  { to: "/settings",label: "Settings" },
];

export default function Nav() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Close the mobile dropdown whenever the route changes.
  useEffect(() => { setOpen(false); }, [location.pathname]);

  const current = LINKS.find(l =>
    l.to === "/" ? location.pathname === "/" : location.pathname.startsWith(l.to)
  ) ?? LINKS[0];

  const linkStyle = ({ isActive }) => ({
    padding: "0.38rem 0.85rem",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: "0.88rem",
    textDecoration: "none",
    transition: "all 0.15s",
    background: isActive ? "var(--bg-surface-alt)" : "transparent",
    color: isActive ? "var(--accent-dark)" : "var(--text-secondary)",
  });

  return (
    <nav style={{
      background: "var(--bg-card)",
      borderBottom: "1px solid var(--border)",
      boxShadow: "var(--shadow-card)",
      position: "sticky", top: 0, zIndex: 100,
      width: "100%",
    }}>
      <style>{`
        .nav-links { display: flex; gap: 0.15rem; align-items: center; }
        .nav-current, .nav-toggle { display: none; }
        @media (max-width: 720px) {
          .nav-links {
            display: none;
            position: absolute; top: 52px; left: 0; right: 0;
            flex-direction: column;
            align-items: stretch;
            gap: 2px;
            background: var(--bg-card);
            padding: 0.5rem;
            border-bottom: 1px solid var(--border);
            box-shadow: 0 8px 20px rgba(0,0,0,0.1);
          }
          .nav-links.open { display: flex; }
          .nav-links a { padding: 0.7rem 0.9rem !important; }
          .nav-current { display: block; font-weight: 700; color: var(--text-primary); font-size: 0.95rem; }
          .nav-toggle { display: flex; }
        }
      `}</style>
      <div style={{
        width: "100%", maxWidth: 1400,
        margin: "0 auto",
        padding: "0 1.25rem",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        height: 52,
        boxSizing: "border-box",
        position: "relative",
        gap: "0.6rem",
      }}>
        <span className="nav-current">{current.label}</span>

        <div className={`nav-links${open ? " open" : ""}`}>
          {LINKS.map(({ to, label }) => (
            <NavLink key={to} to={to} end={to === "/"} style={linkStyle}>
              {label}
            </NavLink>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginLeft: "auto" }}>
          <ThemeToggle />
          <button
            className="nav-toggle"
            onClick={() => setOpen(o => !o)}
            aria-label="Toggle navigation menu"
            style={{
              background: "none", border: "none", color: "var(--text-secondary)",
              fontSize: "1.1rem", cursor: "pointer",
              alignItems: "center", justifyContent: "center",
              width: 36, height: 36, padding: 0,
            }}
          >
            {open ? <FaTimes /> : <FaBars />}
          </button>
        </div>
      </div>
    </nav>
  );
}
