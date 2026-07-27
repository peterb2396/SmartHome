export default function Spinner({ message = "Loading..." }) {
  return (
    <div style={{
      minHeight: "60vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: "1rem",
    }}>
      <div style={{
        width: 52, height: 52,
        border: "3px solid var(--border)",
        borderTop: "3px solid var(--accent)",
        borderRadius: "50%",
        animation: "spin 0.9s linear infinite",
      }} />
      <p style={{ color: "var(--text-muted)", fontWeight: 500, margin: 0 }}>{message}</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
