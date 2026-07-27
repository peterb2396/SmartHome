import { useState, useEffect, useCallback } from "react";
import { getCameraSnapshot, getCameraStorage } from "../api";
import { FaVideoSlash, FaCog, FaPlay, FaStop, FaVideo, FaHistory, FaThumbtack } from "react-icons/fa";

function iconBtn(bg, color) {
  return {
    width: 32, height: 32, background: bg, border: "none", borderRadius: 8,
    display: "flex", alignItems: "center", justifyContent: "center",
    color, cursor: "pointer", transition: "opacity 0.15s", flexShrink: 0,
  };
}

function StorageBar({ used, max }) {
  const pct = Math.min(100, Math.round((used / (max * 1024)) * 100)) || 0;
  const color = pct > 85 ? "var(--danger)" : pct > 60 ? "#f59e0b" : "var(--success)";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: 4 }}>
        <span>{(used / 1024).toFixed(1)} GB used</span>
        <span>{max} GB max</span>
      </div>
      <div style={{ height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width 0.4s" }} />
      </div>
      <div style={{ fontSize: "0.72rem", color, marginTop: 2, fontWeight: 600 }}>{pct}% full</div>
    </div>
  );
}

// One camera's snapshot-polling tile — shared by the Cameras page and the
// Console's pinned-cameras panel so the 30s-poll/base64-snapshot rendering
// only lives in one place. `onSettings`/`onToggleRecord` are optional so
// Console (which only pins for viewing) doesn't need to wire up the full
// management affordances that the Cameras page uses.
export default function CameraTile({ camera, onSelect, onSettings, onToggleRecord, pinned, onTogglePin, showStorage = true }) {
  const [snapshot, setSnapshot] = useState(null);
  const [snapLoading, setSnapLoading] = useState(false);
  const [storage, setStorage] = useState(null);

  const fetchSnapshot = useCallback(async () => {
    if (!camera.streamUrl && !camera.snapshotUrl) return;
    setSnapLoading(true);
    try {
      const { data } = await getCameraSnapshot(camera.cameraId);
      if (data.snapshot) setSnapshot(`data:image/jpeg;base64,${data.snapshot}`);
    } catch {}
    setSnapLoading(false);
  }, [camera.cameraId, camera.streamUrl, camera.snapshotUrl]);

  const fetchStorage = useCallback(async () => {
    if (!showStorage) return;
    try {
      const { data } = await getCameraStorage(camera.cameraId);
      setStorage(data);
    } catch {}
  }, [camera.cameraId, showStorage]);

  useEffect(() => {
    fetchSnapshot();
    fetchStorage();
    const id = setInterval(fetchSnapshot, 30000);
    return () => clearInterval(id);
  }, [fetchSnapshot, fetchStorage]);

  const hasStream = !!(camera.streamUrl || camera.snapshotUrl);

  return (
    <div style={{
      background: "var(--bg-card)", borderRadius: 16, border: "1px solid var(--border)",
      boxShadow: "0 2px 8px rgba(0,0,0,0.07)", overflow: "hidden",
      opacity: camera.enabled ? 1 : 0.55,
    }}>
      {/* Thumbnail / live preview */}
      <div
        onClick={() => hasStream && onSelect?.(camera)}
        style={{
          position: "relative", paddingBottom: "56.25%", background: "#0f172a",
          cursor: hasStream && onSelect ? "pointer" : "default",
        }}
      >
        {snapshot
          ? <img src={snapshot} alt={camera.label} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
          : (
            <div style={{
              position: "absolute", inset: 0, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", color: "#475569", gap: 8,
            }}>
              {snapLoading
                ? <div style={{ width: 28, height: 28, border: "2px solid #475569", borderTop: "2px solid var(--text-muted)", borderRadius: "50%", animation: "spin 0.9s linear infinite" }} />
                : <><FaVideoSlash style={{ fontSize: "2rem" }} /><span style={{ fontSize: "0.8rem" }}>{hasStream ? "No preview" : "No stream configured"}</span></>
              }
            </div>
          )
        }

        {camera.isRecording && (
          <div style={{
            position: "absolute", top: 10, left: 10,
            display: "flex", alignItems: "center", gap: 5,
            background: "rgba(0,0,0,0.6)", borderRadius: 20, padding: "3px 8px",
          }}>
            <div style={{ width: 8, height: 8, background: "var(--danger)", borderRadius: "50%", animation: "recPulse 1.2s ease-in-out infinite" }} />
            <span style={{ color: "white", fontSize: "0.72rem", fontWeight: 700 }}>REC</span>
          </div>
        )}

        {onTogglePin && (
          <button
            onClick={e => { e.stopPropagation(); onTogglePin(camera); }}
            title={pinned ? "Unpin from Console" : "Pin to Console"}
            style={{
              position: "absolute", top: 10, right: 10,
              ...iconBtn(pinned ? "var(--accent)" : "rgba(15,23,42,0.6)", "white"),
              backdropFilter: "blur(4px)",
            }}>
            <FaThumbtack style={{ fontSize: "0.72rem" }} />
          </button>
        )}

        {snapshot && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0)", transition: "background 0.2s",
          }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(0,0,0,0.3)"}
            onMouseLeave={e => e.currentTarget.style.background = "rgba(0,0,0,0)"}
          >
            <FaPlay style={{ color: "white", fontSize: "2rem", opacity: 0, transition: "opacity 0.2s" }}
              onMouseEnter={e => e.currentTarget.style.opacity = 1}
            />
          </div>
        )}
      </div>

      {/* Info row */}
      <div style={{ padding: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div>
            <h3 style={{ margin: 0, fontWeight: 700, color: "var(--text-primary)", fontSize: "0.95rem" }}>{camera.label}</h3>
            {camera.location && <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--text-muted)" }}>{camera.location}</p>}
          </div>
          {(onSettings || onToggleRecord || onSelect) && (
            <div style={{ display: "flex", gap: 6 }}>
              {onSettings && (
                <button onClick={() => onSettings(camera)} title="Configure" style={iconBtn("var(--bg-surface-alt)", "var(--text-secondary)")}>
                  <FaCog style={{ fontSize: "0.85rem" }} />
                </button>
              )}
              {onToggleRecord && (
                <button
                  onClick={() => onToggleRecord(camera)}
                  title={camera.isRecording ? "Stop recording" : "Start recording"}
                  style={iconBtn(camera.isRecording ? "#fef2f2" : "#f0fdf4", camera.isRecording ? "var(--danger)" : "var(--success)")}
                >
                  {camera.isRecording ? <FaStop style={{ fontSize: "0.85rem" }} /> : <FaVideo style={{ fontSize: "0.85rem" }} />}
                </button>
              )}
              {onSelect && (
                <button onClick={() => onSelect(camera)} title="View history" style={iconBtn("#eff6ff", "var(--accent-dark)")}>
                  <FaHistory style={{ fontSize: "0.85rem" }} />
                </button>
              )}
            </div>
          )}
        </div>

        {showStorage && storage && <StorageBar used={storage.usedMB} max={storage.maxGB} />}
      </div>
    </div>
  );
}

export { iconBtn };
