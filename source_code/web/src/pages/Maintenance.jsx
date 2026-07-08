import { useState } from "react";
import { FaPlus, FaTools } from "react-icons/fa";
import { useMaintenance } from "../hooks/useMaintenance";
import MaintenanceTaskCard  from "../components/MaintenanceTaskCard";
import MaintenanceTaskModal from "../components/MaintenanceTaskModal";
import Spinner from "../components/Spinner";

export default function Maintenance() {
  const { state, loading, error, addTask, editTask, removeTask, completeTask } = useMaintenance();
  const [modalTask, setModalTask] = useState(null); // null = closed, {} = new, {...} = editing
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  if (loading) return <Spinner message="Loading maintenance tasks..." />;

  const tasks = state?.tasks ?? [];
  const frequencies = state?.frequencies ?? [];

  function handleSave({ label, frequency }) {
    if (modalTask?.id) editTask(modalTask.id, { label, frequency });
    else addTask(label, frequency);
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.4rem", color: "#1e293b" }}>Maintenance</h1>
          <p style={{ margin: "2px 0 0", color: "#94a3b8", fontSize: "0.85rem" }}>
            Routine home upkeep — you'll get a weekly reminder for anything due until it's checked off.
          </p>
        </div>
        <button onClick={() => setModalTask({})} style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "#3b82f6", color: "white", border: "none",
          borderRadius: 10, padding: "0.65rem 1.1rem", fontWeight: 600, fontSize: "0.88rem",
          cursor: "pointer", whiteSpace: "nowrap",
        }}>
          <FaPlus size={12} /> Add Task
        </button>
      </div>

      {error && (
        <div style={{
          background: "#fffbeb", border: "1px solid #fbbf24", color: "#b45309",
          borderRadius: 10, padding: "0.75rem 1rem", marginBottom: "1.25rem", fontSize: "0.85rem",
        }}>
          {error}
        </div>
      )}

      {tasks.length === 0 ? (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
          color: "#94a3b8", padding: "3rem 1rem", textAlign: "center",
        }}>
          <FaTools size={28} />
          <p style={{ margin: 0 }}>No maintenance tasks yet — add one to start tracking it.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {tasks.map(task => (
            <MaintenanceTaskCard
              key={task.id}
              task={task}
              onComplete={completeTask}
              onEdit={setModalTask}
              onDelete={setConfirmDeleteId}
            />
          ))}
        </div>
      )}

      {modalTask && (
        <MaintenanceTaskModal
          task={modalTask.id ? modalTask : null}
          frequencies={frequencies}
          onClose={() => setModalTask(null)}
          onSave={handleSave}
        />
      )}

      {confirmDeleteId && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1000, padding: "1rem",
        }}>
          <div style={{
            background: "white", borderRadius: 16, maxWidth: 360, width: "100%",
            boxShadow: "0 25px 50px rgba(0,0,0,0.2)", padding: "1.5rem",
          }}>
            <p style={{ margin: "0 0 1.25rem", color: "#1e293b", fontWeight: 600 }}>
              Delete this maintenance task? This can't be undone.
            </p>
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button onClick={() => setConfirmDeleteId(null)} style={{ flex: 1, padding: "0.7rem", background: "#e2e8f0", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
              <button onClick={() => { removeTask(confirmDeleteId); setConfirmDeleteId(null); }} style={{ flex: 1, padding: "0.7rem", background: "#ef4444", color: "white", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
