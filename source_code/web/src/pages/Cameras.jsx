import { useState, useEffect, useCallback, useRef } from "react";
import {
  getCameras, addCamera, updateCamera, deleteCamera,
  getCameraSnapshot, startCameraRecord, stopCameraRecord,
  getCameraRecordings, streamRecordingUrl, deleteRecording, getCameraStorage,
} from "../api";
import { formatDate, formatRelativeTime } from "../utils";
import Spinner from "../components/Spinner";
import {
  FaVideo, FaVideoSlash, FaPlus, FaTrash, FaCog, FaPlay,
  FaStop, FaDownload, FaSync, FaHdd, FaHistory, FaCamera,
} from "react-icons/fa";

// ── Storage bar ───────────────────────────────────────────────────────────────
function StorageBar({ used, max }) {
  const pct = Math.min(100, Math.round((used / (max * 1024)) * 100)) || 0;
  const color = pct > 85 ? "#ef4444" : pct > 60 ? "#f59e0b" : "#10b981";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "#64748b", marginBottom: 4 }}>
        <span>{(used / 1024).toFixed(1)} GB used</span>
        <span>{max} GB max</span>
      </div>
      <div style={{ height: 6, background: "#e2e8f0", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width 0.4s" }} />
      </div>
      <div style={{ fontSize: "0.72rem", color, marginTop: 2, fontWeight: 600 }}>{pct}% full</div>
    </div>
  );
}

// ── Camera card ───────────────────────────────────────────────────────────────
function CameraCard({ camera, onSelect, onSettings, onToggleRecord }) {
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
    try {
      const { data } = await getCameraStorage(camera.cameraId);
      setStorage(data);
    } catch {}
  }, [camera.cameraId]);

  useEffect(() => {
    fetchSnapshot();
    fetchStorage();
    // Refresh snapshot every 30s
    const id = setInterval(fetchSnapshot, 30000);
    return () => clearInterval(id);
  }, [fetchSnapshot, fetchStorage]);

  const hasStream = !!(camera.streamUrl || camera.snapshotUrl);

  return (
    <div style={{
      background: "white", borderRadius: 16, border: "1px solid #e2e8f0",
      boxShadow: "0 2px 8px rgba(0,0,0,0.07)", overflow: "hidden",
      opacity: camera.enabled ? 1 : 0.55,
    }}>
      {/* Thumbnail / live preview */}
      <div
        onClick={() => hasStream && onSelect(camera)}
        style={{
          position: "relative", paddingBottom: "56.25%", background: "#0f172a",
          cursor: hasStream ? "pointer" : "default",
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
                ? <div style={{ width: 28, height: 28, border: "2px solid #475569", borderTop: "2px solid #94a3b8", borderRadius: "50%", animation: "spin 0.9s linear infinite" }} />
                : <><FaVideoSlash style={{ fontSize: "2rem" }} /><span style={{ fontSize: "0.8rem" }}>{hasStream ? "No preview" : "No stream configured"}</span></>
              }
            </div>
          )
        }

        {/* Recording indicator */}
        {camera.isRecording && (
          <div style={{
            position: "absolute", top: 10, left: 10,
            display: "flex", alignItems: "center", gap: 5,
            background: "rgba(0,0,0,0.6)", borderRadius: 20, padding: "3px 8px",
          }}>
            <div style={{ width: 8, height: 8, background: "#ef4444", borderRadius: "50%", animation: "recPulse 1.2s ease-in-out infinite" }} />
            <span style={{ color: "white", fontSize: "0.72rem", fontWeight: 700 }}>REC</span>
          </div>
        )}

        {/* Play overlay */}
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
            <h3 style={{ margin: 0, fontWeight: 700, color: "#1e293b", fontSize: "0.95rem" }}>{camera.label}</h3>
            {camera.location && <p style={{ margin: 0, fontSize: "0.78rem", color: "#94a3b8" }}>{camera.location}</p>}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => onSettings(camera)} title="Configure"
              style={iconBtn("#f1f5f9", "#64748b")}>
              <FaCog style={{ fontSize: "0.85rem" }} />
            </button>
            <button
              onClick={() => onToggleRecord(camera)}
              title={camera.isRecording ? "Stop recording" : "Start recording"}
              style={iconBtn(camera.isRecording ? "#fef2f2" : "#f0fdf4", camera.isRecording ? "#ef4444" : "#10b981")}
            >
              {camera.isRecording ? <FaStop style={{ fontSize: "0.85rem" }} /> : <FaVideo style={{ fontSize: "0.85rem" }} />}
            </button>
            <button onClick={() => onSelect(camera)} title="View history"
              style={iconBtn("#eff6ff", "#2563eb")}>
              <FaHistory style={{ fontSize: "0.85rem" }} />
            </button>
          </div>
        </div>

        {storage && <StorageBar used={storage.usedMB} max={storage.maxGB} />}
      </div>
    </div>
  );
}

// ── Live view modal ───────────────────────────────────────────────────────────
function LiveModal({ camera, onClose }) {
  const [snapshot, setSnapshot]   = useState(null);
  const [recordings, setRecordings] = useState([]);
  const [recLoading, setRecLoading] = useState(true);
  const [playingRec, setPlayingRec] = useState(null);
  const [view, setView]             = useState("live"); // "live" | "history"
  const intervalRef = useRef(null);

  const refreshSnap = useCallback(async () => {
    try {
      const { data } = await getCameraSnapshot(camera.cameraId);
      if (data.snapshot) setSnapshot(`data:image/jpeg;base64,${data.snapshot}`);
    } catch {}
  }, [camera.cameraId]);

  const fetchRecordings = useCallback(async () => {
    setRecLoading(true);
    try {
      const { data } = await getCameraRecordings(camera.cameraId, { limit: 100 });
      setRecordings(data.recordings || []);
    } catch {}
    setRecLoading(false);
  }, [camera.cameraId]);

  useEffect(() => {
    refreshSnap();
    fetchRecordings();
    if (view === "live") {
      intervalRef.current = setInterval(refreshSnap, 5000);
    }
    return () => clearInterval(intervalRef.current);
  }, [view, refreshSnap, fetchRecordings]);

  const handleDelete = async (recId) => {
    if (!window.confirm("Delete this recording?")) return;
    try {
      await deleteRecording(recId);
      setRecordings(prev => prev.filter(r => r._id !== recId));
    } catch {}
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)",
      zIndex: 1000, display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.85rem 1.25rem", background: "#0f172a", borderBottom: "1px solid #1e293b",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <FaCamera style={{ color: "#94a3b8" }} />
          <div>
            <span style={{ color: "white", fontWeight: 700 }}>{camera.label}</span>
            {camera.location && <span style={{ color: "#64748b", fontSize: "0.8rem", marginLeft: 8 }}>{camera.location}</span>}
          </div>
          {camera.isRecording && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, background: "#ef444422", border: "1px solid #ef4444", borderRadius: 20, padding: "2px 8px" }}>
              <div style={{ width: 6, height: 6, background: "#ef4444", borderRadius: "50%", animation: "recPulse 1.2s ease-in-out infinite" }} />
              <span style={{ color: "#ef4444", fontSize: "0.72rem", fontWeight: 700 }}>LIVE</span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {/* View tabs */}
          {["live", "history"].map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: "0.35rem 0.85rem", borderRadius: 8, border: "none", cursor: "pointer",
              background: view === v ? "#2563eb" : "#1e293b",
              color: view === v ? "white" : "#64748b", fontWeight: 600, fontSize: "0.85rem",
              textTransform: "capitalize",
            }}>{v}</button>
          ))}
          <button onClick={onClose} style={{
            marginLeft: 8, background: "#1e293b", border: "none", borderRadius: 8,
            color: "#94a3b8", cursor: "pointer", padding: "0.35rem 0.75rem", fontSize: "1.1rem",
          }}>✕</button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>
        {view === "live" ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem" }}>
            {snapshot
              ? (
                <div style={{ position: "relative", maxWidth: "100%", maxHeight: "calc(100vh - 160px)" }}>
                  <img src={snapshot} alt="Live" style={{ maxWidth: "100%", maxHeight: "calc(100vh - 160px)", borderRadius: 8, display: "block" }} />
                  <div style={{
                    position: "absolute", bottom: 12, right: 12,
                    background: "rgba(0,0,0,0.6)", borderRadius: 8, padding: "4px 10px",
                    display: "flex", alignItems: "center", gap: 6,
                  }}>
                    <FaSync style={{ color: "#94a3b8", fontSize: "0.75rem" }} />
                    <span style={{ color: "#94a3b8", fontSize: "0.75rem" }}>Refreshes every 5s</span>
                  </div>
                  {/* If there's an actual HLS/stream URL, embed it */}
                  {camera.streamUrl?.startsWith("http") && (
                    <div style={{ marginTop: 12, textAlign: "center" }}>
                      <a href={camera.streamUrl} target="_blank" rel="noreferrer"
                        style={{ color: "#60a5fa", fontSize: "0.8rem" }}>
                        Open raw stream ↗
                      </a>
                    </div>
                  )}
                </div>
              )
              : (
                <div style={{ textAlign: "center", color: "#475569" }}>
                  <FaVideoSlash style={{ fontSize: "3rem", marginBottom: 12 }} />
                  <p>No snapshot available</p>
                  <button onClick={refreshSnap} style={{
                    padding: "0.5rem 1.25rem", background: "#2563eb", color: "white",
                    border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600,
                  }}>Try Again</button>
                </div>
              )
            }
          </div>
        ) : (
          /* History */
          <div style={{ padding: "1.25rem" }}>
            {playingRec && (
              <div style={{ marginBottom: "1.25rem" }}>
                <video
                  controls autoPlay
                  src={streamRecordingUrl(playingRec)}
                  style={{ width: "100%", maxHeight: "50vh", borderRadius: 10, background: "#0f172a" }}
                />
                <button onClick={() => setPlayingRec(null)} style={{
                  marginTop: 8, padding: "0.4rem 1rem", background: "#1e293b",
                  color: "#94a3b8", border: "none", borderRadius: 8, cursor: "pointer", fontSize: "0.85rem",
                }}>
                  Close player
                </button>
              </div>
            )}

            {recLoading ? <Spinner message="Loading recordings..." /> : recordings.length === 0 ? (
              <div style={{ textAlign: "center", color: "#475569", padding: "3rem" }}>
                <FaHistory style={{ fontSize: "2.5rem", marginBottom: 12, opacity: 0.4 }} />
                <p>No recordings yet</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                {recordings.map(rec => (
                  <div key={rec._id} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    background: "#1e293b", borderRadius: 10, padding: "0.75rem 1rem",
                    border: playingRec === rec._id ? "1px solid #2563eb" : "1px solid #334155",
                  }}>
                    <div>
                      <p style={{ margin: 0, color: "white", fontWeight: 600, fontSize: "0.85rem" }}>
                        {formatDate(rec.startedAt)}
                      </p>
                      <p style={{ margin: 0, color: "#64748b", fontSize: "0.75rem" }}>
                        {rec.filename}
                        {rec.sizeMB ? ` · ${rec.sizeMB.toFixed(1)} MB` : ""}
                        {rec.durationSec ? ` · ${Math.round(rec.durationSec / 60)}m` : ""}
                      </p>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => setPlayingRec(playingRec === rec._id ? null : rec._id)}
                        style={iconBtn("#162032", "#60a5fa")} title="Play">
                        <FaPlay style={{ fontSize: "0.8rem" }} />
                      </button>
                      <a href={streamRecordingUrl(rec._id)} download={rec.filename}
                        style={{ ...iconBtn("#162032", "#10b981"), display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}
                        title="Download">
                        <FaDownload style={{ fontSize: "0.8rem" }} />
                      </a>
                      <button onClick={() => handleDelete(rec._id)}
                        style={iconBtn("#162032", "#ef4444")} title="Delete">
                        <FaTrash style={{ fontSize: "0.8rem" }} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Add / Edit modal ──────────────────────────────────────────────────────────
function CameraFormModal({ existing, onClose, onSave }) {
  const [form, setForm] = useState(existing || {
    cameraId: "", label: "", streamUrl: "", snapshotUrl: "",
    location: "", recordingPath: "", maxStorageGB: 10, enabled: true,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState("");

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleSave = async () => {
    if (!form.cameraId || !form.label) { setErr("Camera ID and Label are required."); return; }
    setSaving(true);
    try {
      if (existing) {
        await updateCamera(existing.cameraId, form);
      } else {
        await addCamera(form);
      }
      onSave();
      onClose();
    } catch (e) {
      setErr(e.response?.data?.error || "Error saving camera.");
    }
    setSaving(false);
  };

  const fields = [
    { key: "cameraId",      label: "Camera ID",          placeholder: "e.g. front-door",         disabled: !!existing },
    { key: "label",         label: "Display Name",        placeholder: "e.g. Front Door" },
    { key: "location",      label: "Location",            placeholder: "e.g. Outside / Front" },
    { key: "streamUrl",     label: "Stream URL (RTSP/HTTP)", placeholder: "rtsp://192.168.1.x:554/stream" },
    { key: "snapshotUrl",   label: "Snapshot URL (optional)", placeholder: "http://camera-ip/snapshot.jpg" },
    { key: "recordingPath", label: "Recording Path",      placeholder: "/mnt/recordings/front-door" },
    { key: "maxStorageGB",  label: "Max Storage (GB)",    type: "number", placeholder: "10" },
  ];

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1100, padding: "1rem",
    }}>
      <div style={{
        background: "white", borderRadius: 16, maxWidth: 500, width: "100%",
        maxHeight: "90vh", overflow: "auto", boxShadow: "0 25px 50px rgba(0,0,0,0.25)",
      }}>
        <div style={{
          padding: "1.25rem 1.5rem",
          background: "linear-gradient(135deg, #0f172a, #1e293b)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <h2 style={{ color: "white", margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>
            {existing ? "Edit Camera" : "Add Camera"}
          </h2>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: "50%", width: 30, height: 30, color: "white", cursor: "pointer", fontSize: "1.1rem" }}>×</button>
        </div>
        <div style={{ padding: "1.5rem" }}>
          {fields.map(({ key, label, placeholder, type = "text", disabled = false }) => (
            <div key={key} style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", fontWeight: 600, fontSize: "0.82rem", color: "#1e293b", marginBottom: 4 }}>{label}</label>
              <input
                type={type}
                value={form[key] ?? ""}
                onChange={e => set(key, type === "number" ? +e.target.value : e.target.value)}
                placeholder={placeholder}
                disabled={disabled}
                style={{ ...formInput, opacity: disabled ? 0.6 : 1 }}
              />
            </div>
          ))}

          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem" }}>
            <input type="checkbox" id="enabled" checked={form.enabled} onChange={e => set("enabled", e.target.checked)} />
            <label htmlFor="enabled" style={{ fontWeight: 600, fontSize: "0.85rem", color: "#1e293b", cursor: "pointer" }}>
              Camera enabled
            </label>
          </div>

          {err && <p style={{ color: "#ef4444", fontSize: "0.85rem", margin: "0 0 1rem" }}>{err}</p>}

          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button onClick={onClose} style={{ flex: 1, padding: "0.7rem", background: "#e2e8f0", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
            <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: "0.7rem", background: "#0f172a", color: "white", border: "none", borderRadius: 10, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1 }}>
              {saving ? "Saving..." : "Save Camera"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Cameras() {
  const [cameras,     setCameras]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [selected,    setSelected]    = useState(null);  // camera for live modal
  const [editing,     setEditing]     = useState(null);  // camera for form (null=add, obj=edit)
  const [showForm,    setShowForm]    = useState(false);
  const [deleting,    setDeleting]    = useState(null);

  const fetchCameras = useCallback(async () => {
    try {
      const { data } = await getCameras();
      setCameras(data);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchCameras();
    const id = setInterval(fetchCameras, 15000);
    return () => clearInterval(id);
  }, [fetchCameras]);

  const handleToggleRecord = async (camera) => {
    try {
      if (camera.isRecording) {
        await stopCameraRecord(camera.cameraId);
      } else {
        await startCameraRecord(camera.cameraId);
      }
      fetchCameras();
    } catch (e) {
      alert("Failed: " + (e.response?.data?.error || e.message));
    }
  };

  const handleDelete = async (camera) => {
    if (!window.confirm(`Delete "${camera.label}"? Recordings in the database will be removed but files on disk will not be deleted.`)) return;
    setDeleting(camera.cameraId);
    try {
      await deleteCamera(camera.cameraId);
      setCameras(prev => prev.filter(c => c.cameraId !== camera.cameraId));
    } catch {}
    setDeleting(null);
  };

  if (loading) return <Spinner message="Loading cameras..." />;

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "1.5rem" }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes recPulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
      `}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ fontSize: "1.6rem", fontWeight: 800, color: "#1e293b", margin: 0 }}>Cameras</h1>
          <p style={{ color: "#94a3b8", margin: 0, fontSize: "0.85rem" }}>
            {cameras.length} camera{cameras.length !== 1 ? "s" : ""} · {cameras.filter(c => c.isRecording).length} recording
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button onClick={fetchCameras} style={headerBtn("#f1f5f9", "#64748b")}>
            <FaSync style={{ fontSize: "0.8rem" }} /> Refresh
          </button>
          <button onClick={() => { setEditing(null); setShowForm(true); }} style={headerBtn("#0f172a", "white")}>
            <FaPlus style={{ fontSize: "0.8rem" }} /> Add Camera
          </button>
        </div>
      </div>

      {/* Empty state */}
      {cameras.length === 0 && (
        <div style={{
          textAlign: "center", padding: "4rem 2rem", background: "white",
          borderRadius: 16, border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.07)",
        }}>
          <FaCamera style={{ fontSize: "3rem", color: "#cbd5e1", marginBottom: "1rem" }} />
          <h2 style={{ color: "#1e293b", fontWeight: 700, marginBottom: 8 }}>No cameras yet</h2>
          <p style={{ color: "#94a3b8", marginBottom: "1.5rem", maxWidth: 360, margin: "0 auto 1.5rem" }}>
            Add your first camera to start monitoring live feeds and recording history.
          </p>
          <button onClick={() => { setEditing(null); setShowForm(true); }} style={{
            padding: "0.75rem 1.5rem", background: "#0f172a", color: "white",
            border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: "0.95rem",
          }}>
            Add Camera
          </button>
        </div>
      )}

      {/* Camera grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1.25rem" }}>
        {cameras.map(cam => (
          <div key={cam.cameraId} style={{ position: "relative" }}>
            <CameraCard
              camera={cam}
              onSelect={setSelected}
              onSettings={(c) => { setEditing(c); setShowForm(true); }}
              onToggleRecord={handleToggleRecord}
            />
            <button
              onClick={() => handleDelete(cam)}
              disabled={deleting === cam.cameraId}
              title="Delete camera"
              style={{
                position: "absolute", top: 10, right: 10,
                ...iconBtn("rgba(15,23,42,0.7)", "#f87171"),
                backdropFilter: "blur(4px)",
              }}>
              <FaTrash style={{ fontSize: "0.75rem" }} />
            </button>
          </div>
        ))}
      </div>

      {/* Setup guide */}
      {cameras.length > 0 && (
        <div style={{
          marginTop: "2rem", padding: "1.25rem 1.5rem", background: "white",
          borderRadius: 12, border: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        }}>
          <h3 style={{ margin: "0 0 0.75rem", fontWeight: 700, color: "#1e293b", fontSize: "0.95rem", display: "flex", alignItems: "center", gap: 8 }}>
            <FaHdd style={{ color: "#94a3b8" }} /> Recording Setup
          </h3>
          <p style={{ margin: 0, color: "#64748b", fontSize: "0.85rem", lineHeight: 1.7 }}>
            Recordings are saved on the Raspberry Pi via <strong>ffmpeg</strong> in 10-minute segments.
            Install ffmpeg with <code style={{ background: "#f1f5f9", padding: "1px 6px", borderRadius: 4 }}>sudo apt install ffmpeg</code>.
            Set a <strong>Recording Path</strong> on each camera (e.g. <code style={{ background: "#f1f5f9", padding: "1px 6px", borderRadius: 4 }}>/mnt/drive/cameras/front-door</code>).
            When a drive fills to the <strong>Max Storage</strong> limit, the oldest segments are automatically deleted.
          </p>
        </div>
      )}

      {/* Modals */}
      {selected && <LiveModal camera={selected} onClose={() => setSelected(null)} />}
      {showForm  && <CameraFormModal existing={editing} onClose={() => setShowForm(false)} onSave={fetchCameras} />}
    </div>
  );
}

// ── Style helpers ─────────────────────────────────────────────────────────────
function iconBtn(bg, color) {
  return {
    width: 32, height: 32, background: bg, border: "none", borderRadius: 8,
    display: "flex", alignItems: "center", justifyContent: "center",
    color, cursor: "pointer", transition: "opacity 0.15s", flexShrink: 0,
  };
}

function headerBtn(bg, color) {
  return {
    display: "flex", alignItems: "center", gap: 6, padding: "0.5rem 1rem",
    background: bg, border: "none", borderRadius: 8, cursor: "pointer",
    color, fontWeight: 600, fontSize: "0.85rem",
  };
}

const formInput = {
  width: "100%", padding: "0.65rem 0.9rem", background: "#f8fafc",
  border: "1px solid #e2e8f0", borderRadius: 8, fontSize: "0.9rem",
  outline: "none", boxSizing: "border-box",
};
