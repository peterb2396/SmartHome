import { FaCar, FaLock, FaLockOpen } from "react-icons/fa";

function CarButton({ label, icon: Icon, onClick, busy, success, message, color, successColor = "#10b981" }) {
  const bg = busy
    ? "linear-gradient(135deg, #f59e0b, #d97706)"
    : success
      ? `linear-gradient(135deg, ${successColor}, #059669)`
      : `linear-gradient(135deg, ${color[0]}, ${color[1]})`;

  return (
    <div style={{ flex: 1, position: "relative" }}>
      <button
        onClick={onClick}
        disabled={busy}
        style={{
          width: "100%", height: 90, border: "none", borderRadius: 12,
          background: bg, color: "white", cursor: busy ? "not-allowed" : "pointer",
          display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", gap: 6, transition: "all 0.25s",
          boxShadow: `0 8px 24px ${color[0]}44`,
          animation: busy ? "pulse 1.4s ease-in-out infinite" : "none",
          opacity: busy ? 0.85 : 1,
        }}>
        <Icon style={{ fontSize: "1.5rem", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.2))" }} />
        <span style={{ fontSize: "0.8rem", fontWeight: 600, letterSpacing: "0.03em" }}>
          {busy ? `${label.replace("Car", "")}ing...` : success ? "Done!" : label}
        </span>
      </button>
      {message && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
          textAlign: "center", fontSize: "0.73rem", fontWeight: 500, padding: "3px 8px",
          borderRadius: 6, animation: "slideDown 0.2s ease-out",
          color: success ? "#059669" : "#dc2626",
          background: success ? "#d1fae5" : "#fee2e2",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {message}
        </div>
      )}
    </div>
  );
}

export default function CarControls({ start, lock, unlock }) {
  return (
    <>
      <style>{`
        @keyframes pulse { 0%,100% { transform:scale(1); } 50% { transform:scale(1.02); } }
        @keyframes slideDown { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }
      `}</style>
      <div style={{ display: "flex", gap: 10, marginBottom: "1.5rem" }}>
        <CarButton label="Start Car"  icon={FaCar}      color={["#ef4444","#dc2626"]} {...start}  />
        <CarButton label="Lock Car"   icon={FaLock}     color={["#3b82f6","#2563eb"]} {...lock}   />
        <CarButton label="Unlock Car" icon={FaLockOpen} color={["#f59e0b","#d97706"]} {...unlock} />
      </div>
    </>
  );
}
