import { FaCheck, FaPencilAlt, FaTrash } from "react-icons/fa";

function formatDue(task) {
  const { isDue, daysUntilDue } = task;
  if (isDue) {
    if (daysUntilDue === 0) return "Due today";
    const overdueDays = Math.abs(daysUntilDue);
    return `${overdueDays} ${overdueDays === 1 ? "day" : "days"} overdue`;
  }
  if (daysUntilDue >= 30) {
    const months = Math.round(daysUntilDue / 30);
    return `in ${months} ${months === 1 ? "month" : "months"}`;
  }
  if (daysUntilDue >= 7) {
    const weeks = Math.round(daysUntilDue / 7);
    return `in ${weeks} ${weeks === 1 ? "week" : "weeks"}`;
  }
  return `in ${daysUntilDue} ${daysUntilDue === 1 ? "day" : "days"}`;
}

export default function MaintenanceTaskCard({ task, onComplete, onEdit, onDelete }) {
  const { isDue } = task;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      background: isDue ? "#fef2f2" : "white",
      border: `1px solid ${isDue ? "#fecaca" : "var(--border)"}`,
      borderRadius: 14, padding: "1rem 1.25rem",
      boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontWeight: 600, color: "var(--text-primary)", margin: 0, fontSize: "0.95rem" }}>{task.label}</p>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 4 }}>
          <span style={{
            fontSize: "0.72rem", fontWeight: 600, color: "#475569",
            background: "var(--bg-surface-alt)", borderRadius: 999, padding: "0.15rem 0.55rem",
          }}>
            {task.frequency}
          </span>
          <span style={{
            fontSize: "0.8rem", fontWeight: isDue ? 700 : 500,
            color: isDue ? "#dc2626" : "var(--text-secondary)",
          }}>
            {formatDue(task)}
          </span>
        </div>
      </div>

      <button onClick={() => onComplete(task.id)} title="Mark complete" style={{
        display: "flex", alignItems: "center", gap: 6,
        background: "var(--accent)", color: "white", border: "none",
        borderRadius: 10, padding: "0.5rem 0.85rem", fontWeight: 600, fontSize: "0.82rem",
        cursor: "pointer", whiteSpace: "nowrap",
      }}>
        <FaCheck size={11} /> Complete
      </button>
      <button onClick={() => onEdit(task)} title="Edit task" style={{
        background: "var(--bg-surface-alt)", border: "none", borderRadius: 10,
        width: 34, height: 34, color: "var(--text-secondary)", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <FaPencilAlt size={12} />
      </button>
      <button onClick={() => onDelete(task.id)} title="Delete task" style={{
        background: "var(--bg-surface-alt)", border: "none", borderRadius: 10,
        width: 34, height: 34, color: "var(--danger)", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <FaTrash size={12} />
      </button>
    </div>
  );
}
