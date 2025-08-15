import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import "bootstrap/dist/css/bootstrap.min.css";

export default function SettingsPage({ BASE_URL }) {
  const [settings, setSettings] = useState({});
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [name, setName] = useState("pete.buo"); // For the name input

  const fetchSettings = useCallback(async () => {
    try {
      const { data } = await axios.get(`${BASE_URL}/settings`);
      setSettings(data);
    } catch (error) {
      console.error("Error fetching settings:", error);
    }
  }, [BASE_URL]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSetting = async (key, value) => {
    try {
      await axios.post(`${BASE_URL}/settings`, { key, value });
      setSettings((prev) => ({ ...prev, [key]: value }));
    } catch (error) {
      console.error("Error updating setting:", error);
    }
  };

  const addSetting = async () => {
    if (!newKey.trim()) return;
    await updateSetting(newKey, newValue);
    setNewKey("");
    setNewValue("");
  };

  const handleBlur = (key, value) => {
    updateSetting(key, value);
  };

  const handleTransitAction = async (action) => {
    await axios.post(`${BASE_URL}/${action}`, {"who": name, "password": localStorage.getItem('token')});

    // setName("")
    fetchSettings()
  };

  return (
    <div className="container mt-5">
      <div className="row">
        <div className="col-md-8 mx-auto">
          {/* Main Settings Card */}
          <div className="card shadow-lg p-4">
            <div className="card-body">
              <h5 className="card-title mb-3">Manage Settings</h5>
              <div className="list-group">
              {Object.keys(settings)
  .filter((key) =>
    key !== "_id" &&
    key !== "sunset" &&
    key !== "sunrise" &&
    key !== "stargazingStart" &&
    key !== "stargazingEnd" &&
    key !== "lightsOn" &&
    key !== "lights" && (
    typeof settings[key] !== "object" // exclude objects
    || Array.isArray(settings[key])   // but allow arrays
    )
  )
  .map((key) => (
    <div
      key={key}
      className="list-group-item d-flex justify-content-between align-items-center border rounded mb-2"
    >
      <strong>{key
        .replace("temp_lights", "Temporary Lights")
        .replace("temp_mins", "Temporary Minutes")
        .replace("usersHome", "Who's Home")
        .replace("users_whitelist", "Users")
        .replace("whenAway", "House Empty")
      }</strong>
      <input
        type="text"
        value={Array.isArray(settings[key])
          ? settings[key].join(", ")
          : settings[key]}
        onChange={(e) =>
          setSettings((prev) => ({
            ...prev,
            [key]: e.target.value,
          }))
        }
        onBlur={(e) => handleBlur(key, e.target.value)}
        disabled={Array.isArray(settings[key])}
        className="form-control w-50"
      />
    </div>
  ))}

              </div>

              <hr className="my-4" />
              <h5 className="mb-3">Add New Setting</h5>
              <div className="d-flex gap-2">
                <input
                  type="text"
                  placeholder="Key"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  className="form-control"
                />
                <input
                  type="text"
                  placeholder="Value"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  className="form-control"
                />
                <button className="btn btn-primary" onClick={addSetting}>
                  Add
                </button>
              </div>
            </div>
          </div>

          {/* Simulate Transit Card */}
          <div className="card shadow-lg p-4 mt-4">
            <div className="card-body">
              <h5 className="card-title mb-3">Simulate Transit</h5>
              <div className="d-flex gap-2">
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter Name"
                  className="form-control w-50"
                />
                <button
                  className="btn btn-success"
                  onClick={() => handleTransitAction("arrive")}
                >
                  Arrive
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => handleTransitAction("leave")}
                >
                  Leave
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
