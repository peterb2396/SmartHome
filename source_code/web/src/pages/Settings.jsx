import { useState, useEffect, useCallback } from "react";
import { getSettings, putSetting, arrive, leave } from "../api";

const LABEL_MAP = {
  temp_lights:      "Temporary Lights",
  temp_mins:        "Temporary Minutes",
  usersHome:        "Who's Home",
  users_whitelist:  "Users",
  whenAway:         "House Empty Lights",
};

export default function Settings() {
  const [settings, setSettings] = useState({});
  const [newKey,   setNewKey]   = useState("");
  const [newValue, setNewValue] = useState("");
  const [name,     setName]     = useState("pete.buo");

  const fetchSettings = useCallback(async () => {
    const { data } = await getSettings();
    setSettings(data);
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const updateSetting = async (key, value) => {
    await putSetting(key, value);
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const addSetting = async () => {
    if (!newKey.trim()) return;
    await updateSetting(newKey, newValue);
    setNewKey(""); setNewValue("");
  };

  const handleTransit = async (action) => {
    if (action === "arrive") await arrive(name);
    else await leave(name);
    fetchSettings();
  };

  const filteredKeys = Object.keys(settings).filter(k =>
    k !== "_id" && k !== "sunset" && k !== "sunrise" &&
    k !== "stargazingStart" && k !== "stargazingEnd" &&
    k !== "lightsOn" && k !== "lights" &&
    (typeof settings[k] !== "object" || Array.isArray(settings[k]))
  );

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "1.5rem" }}>
      <h1 style={{ fontSize: "1.6rem", fontWeight: 800, color: "#1e293b", marginBottom: "1.5rem" }}>Settings</h1>

      {/* Settings list */}
      <div style={card}>
        <h2 style={cardTitle}>Manage Settings</h2>
        <div>
          {filteredKeys.map(key => (
            <div key={key} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "0.75rem 0", borderBottom: "1px solid #f1f5f9",
            }}>
              <label style={{ fontWeight: 600, color: "#1e293b", fontSize: "0.9rem" }}>
                {LABEL_MAP[key] || key}
              </label>
              <input
                type="text"
                value={Array.isArray(settings[key]) ? settings[key].join(", ") : settings[key]}
                onChange={e => setSettings(p => ({ ...p, [key]: e.target.value }))}
                onBlur={e => updateSetting(key, e.target.value)}
                disabled={Array.isArray(settings[key])}
                style={inputStyle}
              />
            </div>
          ))}
        </div>

        <div style={{ marginTop: "1.5rem", paddingTop: "1.5rem", borderTop: "1px solid #f1f5f9" }}>
          <h3 style={{ fontWeight: 600, color: "#1e293b", marginBottom: "0.75rem", fontSize: "0.95rem" }}>Add Setting</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <input placeholder="Key" value={newKey} onChange={e => setNewKey(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
            <input placeholder="Value" value={newValue} onChange={e => setNewValue(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
            <button onClick={addSetting} style={btnPrimary}>Add</button>
          </div>
        </div>
      </div>

      {/* Presence simulation */}
      <div style={{ ...card, marginTop: "1.25rem" }}>
        <h2 style={cardTitle}>Simulate Transit</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            value={name} onChange={e => setName(e.target.value)}
            placeholder="Name" style={{ ...inputStyle, flex: 1 }}
          />
          <button onClick={() => handleTransit("arrive")} style={{ ...btnPrimary, background: "#10b981" }}>Arrive</button>
          <button onClick={() => handleTransit("leave")}  style={{ ...btnPrimary, background: "#ef4444" }}>Leave</button>
        </div>
      </div>
    </div>
  );
}

const card = {
  background: "white", borderRadius: 14, border: "1px solid #e2e8f0",
  boxShadow: "0 1px 3px rgba(0,0,0,0.07)", padding: "1.5rem",
};
const cardTitle = { fontSize: "1rem", fontWeight: 700, color: "#1e293b", marginBottom: "1rem" };
const inputStyle = {
  padding: "0.6rem 0.9rem", background: "#f8fafc", border: "1px solid #e2e8f0",
  borderRadius: 8, fontSize: "0.9rem", outline: "none", boxSizing: "border-box",
};
const btnPrimary = {
  padding: "0.6rem 1rem", background: "#3b82f6", color: "white",
  border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
};
