import { NavLink } from "react-router-dom";

const LINKS = [
  { to: "/",        label: "Home"     },
  { to: "/sensors", label: "Sensors"  },
  { to: "/cameras", label: "Cameras"  },
  { to: "/finance", label: "Finance"  },
  { to: "/settings",label: "Settings" },
];

export default function Nav() {
  return (
    <nav style={{
      background: "white",
      borderBottom: "1px solid #e2e8f0",
      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      position: "sticky", top: 0, zIndex: 100,
      width: "100%",
    }}>
      <div style={{
        width: "100%", maxWidth: 1400,
        margin: "0 auto",
        padding: "0 1.5rem",
        display: "flex", alignItems: "center",
        height: 52,
        boxSizing: "border-box",
      }}>
        <div style={{ display: "flex", gap: "0.15rem" }}>
          {LINKS.map(({ to, label }) => (
            <NavLink
              key={to} to={to} end={to === "/"}
              style={({ isActive }) => ({
                padding: "0.38rem 0.85rem",
                borderRadius: 8,
                fontWeight: 600,
                fontSize: "0.88rem",
                textDecoration: "none",
                transition: "all 0.15s",
                background: isActive ? "#eff6ff" : "transparent",
                color: isActive ? "#2563eb" : "#64748b",
              })}
            >
              {label}
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  );
}
