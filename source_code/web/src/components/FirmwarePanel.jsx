import { useState, useEffect, useCallback } from "react";
import { FaUpload, FaTrash, FaFileCode } from "react-icons/fa";
import { getFirmwareList, uploadFirmware, deleteFirmwareFile } from "../api";
import { colors, card } from "../styles/tokens";

const cardStyle = { ...card, padding: "1.25rem" };

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// Reads a File as base64 (no "data:...;base64," prefix) — the shape
// server/api/console.js's POST /console/firmware expects, see that
// route's comment for why base64-in-JSON over a raw multipart upload.
function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// Upload/manage .bin images for the RP2040 nodes' remote-firmware-update
// path (see server/services/rs485.js's header for the wire protocol and
// firmwareUpdate.js for storage) — per-node "which image to flash" lives
// on the node row itself (see NodeFlashControl), this panel is just the
// library of uploaded images.
export default function FirmwarePanel() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pendingFile, setPendingFile] = useState(null);
  const [filename, setFilename] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const fetchFiles = useCallback(async () => {
    try {
      const { data } = await getFirmwareList();
      setFiles(data);
    } catch (e) {
      console.error("FirmwarePanel:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  function handlePickFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setPendingFile(file);
    setFilename(file.name.endsWith(".bin") ? file.name : `${file.name}.bin`);
    setError(null);
  }

  async function handleUpload() {
    if (!pendingFile || !filename.trim()) return;
    setUploading(true);
    setError(null);
    try {
      const dataBase64 = await readAsBase64(pendingFile);
      await uploadFirmware(filename.trim(), dataBase64);
      setPendingFile(null);
      setFilename("");
      fetchFiles();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(f) {
    if (!window.confirm(`Delete ${f.filename}? Any node still on it keeps running fine — this only removes it from the library.`)) return;
    await deleteFirmwareFile(f.filename);
    fetchFiles();
  }

  if (loading) return null;

  return (
    <div style={{ ...cardStyle, marginBottom: "1.5rem" }}>
      <h2 style={{ margin: "0 0 0.85rem", fontSize: "1rem", fontWeight: 700, color: colors.textPrimary, display: "flex", alignItems: "center", gap: 8 }}>
        <FaFileCode color={colors.textMuted} /> Node Firmware
      </h2>
      <p style={{ margin: "0 0 1rem", fontSize: "0.78rem", color: colors.textMuted }}>
        Upload a compiled .bin here, then pick it from a node's row below to push it over RS485 —
        a few hundred KB realistically takes low single digit minutes at 9600 baud, not seconds.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", alignItems: "center", marginBottom: "1rem" }}>
        <label style={{
          display: "flex", alignItems: "center", gap: 6, padding: "0.45rem 0.85rem",
          background: colors.surface, border: `1px solid var(--border)`, borderRadius: 8,
          fontSize: "0.8rem", fontWeight: 600, color: colors.textSecondary, cursor: "pointer",
        }}>
          <FaUpload size={11} /> {pendingFile ? pendingFile.name : "Choose .bin file"}
          <input type="file" accept=".bin" onChange={handlePickFile} style={{ display: "none" }} />
        </label>
        {pendingFile && (
          <>
            <input
              type="text" value={filename} onChange={e => setFilename(e.target.value)}
              placeholder="filename.bin"
              style={{
                padding: "0.45rem 0.7rem", background: colors.surface, border: "1px solid var(--border)",
                borderRadius: 8, fontSize: "0.8rem", width: 220,
              }}
            />
            <button onClick={handleUpload} disabled={uploading} style={{
              padding: "0.45rem 0.9rem", background: colors.accent, color: "white", border: "none",
              borderRadius: 8, fontWeight: 600, fontSize: "0.8rem", cursor: uploading ? "default" : "pointer",
              opacity: uploading ? 0.6 : 1,
            }}>
              {uploading ? "Uploading…" : "Upload"}
            </button>
          </>
        )}
      </div>
      {error && <p style={{ margin: "0 0 1rem", fontSize: "0.78rem", color: colors.danger }}>{error}</p>}

      {files.length === 0 ? (
        <p style={{ margin: 0, color: colors.textMuted, fontSize: "0.85rem" }}>No firmware images uploaded yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {files.map(f => (
            <div key={f.filename} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              background: colors.surface, borderRadius: 10, padding: "0.55rem 0.85rem",
            }}>
              <div>
                <div style={{ fontSize: "0.85rem", fontWeight: 600, color: colors.textPrimary, fontFamily: "monospace" }}>{f.filename}</div>
                <div style={{ fontSize: "0.72rem", color: colors.textMuted }}>
                  {formatSize(f.size)} · uploaded {new Date(f.uploadedAt).toLocaleString()}
                </div>
              </div>
              <button onClick={() => handleDelete(f)} title="Delete" style={{
                width: 28, height: 28, background: "none", border: "none", color: colors.danger,
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}><FaTrash size={11} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
