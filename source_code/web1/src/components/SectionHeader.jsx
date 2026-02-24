import { FaChevronDown, FaChevronUp } from "react-icons/fa";

export default function SectionHeader({ title, isExpanded, onClick, icon: Icon, count, accentColor = "#3b82f6" }) {
  return (
    <div className="section-header" onClick={onClick} style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "1.25rem 1.5rem", background: "white", borderRadius: "12px",
      boxShadow: "0 1px 3px rgba(0,0,0,0.08)", border: "1px solid #e2e8f0",
      cursor: "pointer", marginBottom: "1rem", transition: "box-shadow 0.2s",
      height: "80px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <div style={{
          width: 44, height: 44, borderRadius: 10,
          background: `linear-gradient(135deg, ${accentColor} 0%, ${accentColor}cc 100%)`,
          display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: "1.1rem",
        }}>
          <Icon />
        </div>
        <div>
          <h2 style={{ fontSize: "1.2rem", fontWeight: 700, color: "#1e293b", margin: 0 }}>{title}</h2>
          {count != null && <p style={{ color: "#94a3b8", fontSize: "0.8rem", margin: 0 }}>{count} devices</p>}
        </div>
      </div>
      <div style={{ color: "#cbd5e1" }}>
        {isExpanded ? <FaChevronUp /> : <FaChevronDown />}
      </div>
    </div>
  );
}
