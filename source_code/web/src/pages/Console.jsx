import { useState, useEffect, useRef, useMemo } from "react";
import {
  FaExclamationTriangle, FaLightbulb,
  FaThermometerHalf, FaMicrochip, FaTerminal, FaThumbtack, FaTrash, FaCog,
} from "react-icons/fa";
import { useConsole } from "../hooks/useConsole";
import { useConsoleLogs } from "../hooks/useConsoleLogs";
import { useSettings } from "../hooks/useSettings";
import { configureConsoleNode, deleteConsoleNode, getFirmwareList } from "../api";
import PageHeader from "../components/PageHeader";
import CameraTile from "../components/CameraTile";
import NodeSetupModal from "../components/NodeSetupModal";
import NodeFlashControl from "../components/NodeFlashControl";
import FirmwarePanel from "../components/FirmwarePanel";
import GpioMapEditor from "../components/GpioMapEditor";
import RelayMapEditor from "../components/RelayMapEditor";
import Spinner from "../components/Spinner";
import { colors, card, CONTAINER_WIDE, GRID_COMPACT, GRID_WIDE, pageContainerStyle } from "../styles/tokens";

const cardStyle = { ...card, padding: "1.25rem" };
const HIDDEN_LOG_SOURCES_KEY = "console.hiddenLogSources";

function StatTile({ icon: Icon, label, value, accent = colors.accent }) {
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 8, background: `${accent}1a`, color: accent,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.9rem",
        }}>
          <Icon />
        </div>
        <span style={{ color: colors.textMuted, fontSize: "0.8rem", fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ fontSize: "1.3rem", fontWeight: 800, color: colors.textPrimary }}>{value}</div>
    </div>
  );
}

function LogLine({ entry }) {
  const color = entry.level === "error" ? "#f87171" : entry.level === "warn" ? "var(--warning)" : "var(--text-muted)";
  return (
    <div style={{ display: "flex", gap: 8, fontSize: "0.78rem", fontFamily: "monospace", lineHeight: 1.6 }}>
      <span style={{ color: "#475569", flexShrink: 0 }}>
        {new Date(entry.timestamp).toLocaleTimeString()}
      </span>
      <span style={{ color, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{entry.message}</span>
    </div>
  );
}

export default function Console() {
  const {
    loading, faults, zones, monitorZones, soundZones, lights,
    nodes, cameras, refetch,
  } = useConsole();
  const { lines: logLines, connected: logsConnected } = useConsoleLogs();
  const { settings, updateSetting } = useSettings();
  const [setupNode, setSetupNode] = useState(null);
  const [firmwareFiles, setFirmwareFiles] = useState([]);
  const terminalRef = useRef(null);

  // Fetched here (not inside NodeFlashControl) so every node row shares
  // one list instead of each firing its own request — see FirmwarePanel
  // for where these images get uploaded.
  useEffect(() => {
    getFirmwareList().then(({ data }) => setFirmwareFiles(data)).catch(e => console.error("Console firmware list:", e));
  }, []);
  // Which log sources (the "[ServiceName]" prefix every service already
  // logs with — see server/services/logStream.js) to hide from the
  // terminal. Stores the hidden set, not the visible one, so a source that
  // starts logging for the first time shows up by default instead of
  // silently staying invisible until someone notices and opts in.
  const [hiddenLogSources, setHiddenLogSources] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_LOG_SOURCES_KEY) || "[]")); }
    catch { return new Set(); }
  });
  const logSources = useMemo(
    () => Array.from(new Set(logLines.map(l => l.source || "other"))).sort(),
    [logLines]
  );
  const visibleLogLines = useMemo(
    () => logLines.filter(l => !hiddenLogSources.has(l.source || "other")),
    [logLines, hiddenLogSources]
  );
  function toggleLogSource(source) {
    setHiddenLogSources(prev => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source); else next.add(source);
      localStorage.setItem(HIDDEN_LOG_SOURCES_KEY, JSON.stringify(Array.from(next)));
      return next;
    });
  }

  useEffect(() => {
    const el = terminalRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visibleLogLines]);

  if (loading) return <Spinner message="Loading console..." />;

  const pinnedIds = settings.console?.pinnedCameraIds ?? [];
  const pinnedCameras = cameras.filter(c => pinnedIds.includes(c.cameraId));
  const unpin = (camera) => {
    updateSetting("console", {
      ...settings.console,
      pinnedCameraIds: pinnedIds.filter(id => id !== camera.cameraId),
    });
  };

  const zoneOptions = [
    ...zones.map(z => ({ id: z.id, label: z.label })),
    ...monitorZones.map(z => ({ id: z.id, label: z.label })),
  ];

  async function handleConfigureNode(uniqueId, body) {
    await configureConsoleNode(uniqueId, body);
    refetch();
  }

  async function handleRemoveNode(uniqueId) {
    if (!window.confirm("Remove this node from the registry?")) return;
    await deleteConsoleNode(uniqueId);
    refetch();
  }

  return (
    <div style={pageContainerStyle(CONTAINER_WIDE)}>
      <PageHeader title="Console" subtitle="Live status, faults, and system monitoring" />

      {/* ── Terminal ── */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ margin: "0 0 0.85rem", fontSize: "1rem", fontWeight: 700, color: colors.textPrimary, display: "flex", alignItems: "center", gap: 8 }}>
          <FaTerminal color={colors.textMuted} /> Terminal
          <span style={{
            fontSize: "0.7rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999,
            background: logsConnected ? "#d1fae5" : "var(--bg-surface-alt)",
            color: logsConnected ? "#065f46" : "var(--text-secondary)",
          }}>
            {logsConnected ? "LIVE" : "connecting…"}
          </span>
        </h2>
        {logSources.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem 0.9rem", marginBottom: "0.65rem" }}>
            {logSources.map(source => (
              <label key={source} style={{
                display: "flex", alignItems: "center", gap: 5, fontSize: "0.75rem",
                color: hiddenLogSources.has(source) ? colors.textMuted : colors.textSecondary,
                fontWeight: 600, cursor: "pointer", userSelect: "none",
              }}>
                <input
                  type="checkbox"
                  checked={!hiddenLogSources.has(source)}
                  onChange={() => toggleLogSource(source)}
                  style={{ accentColor: colors.accent }}
                />
                {source}
              </label>
            ))}
          </div>
        )}
        <div ref={terminalRef} style={{
          background: "#0f172a", borderRadius: 14, padding: "1rem 1.25rem",
          maxHeight: 340, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2,
        }}>
          {visibleLogLines.length === 0
            ? <span style={{ color: "#475569", fontSize: "0.8rem", fontFamily: "monospace" }}>
                {logLines.length === 0 ? "No log output yet." : "No log lines match the selected sources."}
              </span>
            : visibleLogLines.map((entry, i) => <LogLine key={i} entry={entry} />)
          }
        </div>
      </div>

      {/* ── Faults ── */}
      {faults.length > 0 && (
        <div style={{
          ...cardStyle, marginBottom: "1.25rem", background: "#fef2f2", border: "1px solid #fecaca",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, color: "#b91c1c", fontWeight: 700 }}>
            <FaExclamationTriangle /> {faults.length} active {faults.length === 1 ? "fault" : "faults"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {faults.map(f => (
              <div key={f.id} style={{ fontSize: "0.85rem", color: "#991b1b" }}>{f.message}</div>
            ))}
          </div>
        </div>
      )}

      {/* ── Pinned cameras ── */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ margin: "0 0 0.85rem", fontSize: "1rem", fontWeight: 700, color: colors.textPrimary, display: "flex", alignItems: "center", gap: 8 }}>
          <FaThumbtack color={colors.textMuted} /> Pinned Cameras
        </h2>
        {pinnedCameras.length === 0 ? (
          <div style={{ ...cardStyle, color: colors.textMuted, fontSize: "0.85rem" }}>
            No cameras pinned — pin one from the Cameras page to see it here.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${GRID_WIDE}px, 1fr))`, gap: "1rem" }}>
            {pinnedCameras.map(cam => (
              <CameraTile key={cam.cameraId} camera={cam} pinned onTogglePin={unpin} showStorage={false} />
            ))}
          </div>
        )}
      </div>

      {/* ── Status overview ── */}
      <div style={{
        display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${GRID_COMPACT}px, 1fr))`,
        gap: "1rem", marginBottom: "1.5rem",
      }}>
        <StatTile icon={FaLightbulb} label="Lights" value={`${lights.on} / ${lights.total} on`} accent="var(--warning)" />
        <StatTile icon={FaMicrochip} label="RS485 Nodes" value={`${nodes.configured.length} configured`} accent="#8b5cf6" />
      </div>

      {/* ── Zones ── */}
      <div style={{ ...cardStyle, marginBottom: "1.5rem" }}>
        <h2 style={{ margin: "0 0 0.85rem", fontSize: "1rem", fontWeight: 700, color: colors.textPrimary, display: "flex", alignItems: "center", gap: 8 }}>
          <FaThermometerHalf color={colors.textMuted} /> Zones
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${GRID_COMPACT}px, 1fr))`, gap: "0.75rem" }}>
          {zones.map(z => (
            <div key={z.id} style={{ background: colors.surface, borderRadius: 10, padding: "0.75rem 1rem" }}>
              <div style={{ fontWeight: 700, color: colors.textPrimary, fontSize: "0.9rem" }}>{z.label}</div>
              <div style={{ fontSize: "0.8rem", color: colors.textMuted }}>
                {z.currentTemp != null ? `${z.currentTemp.toFixed(1)}°` : "no reading"} → {z.target}°
                {z.calling ? " · heating" : z.coolCalling ? " · cooling" : ""}
              </div>
            </div>
          ))}
          {monitorZones.map(z => (
            <div key={z.id} style={{ background: colors.surface, borderRadius: 10, padding: "0.75rem 1rem" }}>
              <div style={{ fontWeight: 700, color: colors.textPrimary, fontSize: "0.9rem" }}>{z.label}</div>
              <div style={{ fontSize: "0.8rem", color: colors.textMuted }}>
                {z.temperature.value != null ? `${z.temperature.value.toFixed(1)}°` : "no reading"}
                {z.environment.humidity.value != null ? ` · ${z.environment.humidity.value.toFixed(0)}% RH` : ""}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── New Nodes / node setup ── */}
      <div style={{ ...cardStyle, marginBottom: "1.5rem" }}>
        <h2 style={{ margin: "0 0 0.85rem", fontSize: "1rem", fontWeight: 700, color: colors.textPrimary, display: "flex", alignItems: "center", gap: 8 }}>
          <FaMicrochip color={colors.textMuted} /> RS485 Nodes
        </h2>

        {nodes.pending.length === 0 && nodes.configured.length === 0 ? (
          <p style={{ margin: 0, color: colors.textMuted, fontSize: "0.85rem" }}>
            No nodes yet — connect an RS485 node to the bus and it'll show up here for setup.
          </p>
        ) : (
          <>
            {nodes.pending.length > 0 && (
              <div style={{ marginBottom: "1rem" }}>
                <p style={{ margin: "0 0 0.5rem", fontSize: "0.78rem", fontWeight: 700, color: "#b45309", textTransform: "uppercase" }}>
                  New — needs setup
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {nodes.pending.map(n => (
                    <div key={n.uniqueId} style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "0.6rem 0.85rem",
                    }}>
                      <span style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "#92400e" }}>{n.uniqueId}</span>
                      <button onClick={() => setSetupNode(n)} style={{
                        padding: "0.35rem 0.8rem", background: "var(--accent)", color: "white", border: "none",
                        borderRadius: 8, fontWeight: 600, fontSize: "0.8rem", cursor: "pointer",
                      }}>Set up</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {nodes.configured.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {nodes.configured.map(n => (
                  <div key={n.uniqueId} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    background: colors.surface, borderRadius: 10, padding: "0.6rem 0.85rem",
                    flexWrap: "wrap", gap: "0.5rem",
                  }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "0.85rem", color: colors.textPrimary }}>{n.name}</div>
                      <div style={{ fontSize: "0.75rem", color: colors.textMuted }}>{n.kind}{n.zoneId ? ` · ${n.zoneId}` : ""}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <NodeFlashControl uniqueId={n.uniqueId} firmwareFiles={firmwareFiles} />
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => setSetupNode(n)} title="Edit" style={{
                          width: 30, height: 30, background: "var(--bg-surface-alt)", border: "none", borderRadius: 8,
                          color: colors.textSecondary, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                        }}><FaCog size={12} /></button>
                        <button onClick={() => handleRemoveNode(n.uniqueId)} title="Remove" style={{
                          width: 30, height: 30, background: "var(--bg-surface-alt)", border: "none", borderRadius: 8,
                          color: colors.danger, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                        }}><FaTrash size={12} /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <FirmwarePanel />
      <GpioMapEditor />
      <RelayMapEditor />

      {setupNode && (
        <NodeSetupModal
          node={setupNode}
          zones={zoneOptions}
          soundZones={soundZones}
          onClose={() => setSetupNode(null)}
          onSave={handleConfigureNode}
        />
      )}
    </div>
  );
}
