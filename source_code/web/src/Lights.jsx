import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import "bootstrap/dist/css/bootstrap.min.css";

export default function Lights({ BASE_URL }) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);

  // Fetch the list of devices from /list-devices endpoint
  const fetchDevices = useCallback(async () => {
    try {
      const { data } = await axios.get(`${BASE_URL}/list-devices`);
      setDevices(data);
      setLoading(false);
    } catch (error) {
      console.error("Error fetching devices:", error);
      setLoading(false);
    }
  }, [BASE_URL]);

  useEffect(() => {
    fetchDevices();
  }, [fetchDevices]);

  // Function to update the device state (turn on/off or adjust brightness)
  const updateDeviceState = async (deviceId, on, level) => {
    try {
      const payload = {
        devices: [deviceId],
        on: on, // "on" or "off"
        password: localStorage.getItem('token'), // Replace with actual password or token
        level: level, // Brightness level (0-100)
      };
      await axios.post(`${BASE_URL}/lights`, payload);

      // Refresh UI
      fetchDevices()
    } catch (error) {
      console.error("Error updating device state:", error);
    }
  };

  // Function to handle the toggle of device on/off
  const handleToggleDevice = (deviceId, currentState) => {
    const newState = currentState === "on" ? "off" : "on"; // Toggle between "on" and "off"
    const newBrightness = newState === "on" ? 100 : 0; // Set brightness to 100 when on, 0 when off
    updateDeviceState(deviceId, newState, newBrightness);
  };

  // Function to handle the brightness change when slider is released
  const handleBrightnessChange = (deviceId, level) => {
    updateDeviceState(deviceId, "on", Number(level)); // Keep device on while adjusting brightness
  };

  // Function to handle real-time slider change
  const handleSliderChange = (deviceId, level) => {
    setDevices(devices.map((device) =>
      device.deviceId === deviceId ? {
        ...device,
        status: {
          ...device.status,
          components: {
            ...device.status.components,
            main: {
              ...device.status.components.main,
              switchLevel: {
                level: { value: level }
              }
            }
          }
        }
      } : device
    ));
  };

  if (loading) {
    return <div>Loading devices...</div>;
  }

  return (
    <div className="container mt-5">

      <div className="row">
        {devices.map((device) => (
          <div key={device.deviceId} className="col-md-4 mb-4">
            <div className="card shadow-lg">
              <div className="card-body">
                <h5 className="card-title">{device.label}</h5>
                <p className="card-text">{device.manufacturerName}</p>
                
                {/* Toggle On/Off Button */}
                <button
                  className={`btn ${(device.status?.components.main.switch.switch.value === "on" || device.status?.components.main.switchLevel.level.value > 0) ? "btn-success" : "btn-danger"}`}
                  onClick={() =>
                    handleToggleDevice(
                      device.deviceId,
                      (device.status?.components.main.switchLevel?.level?.value > 0 ? "on" : "off") || device.status?.components.main.switch.switch.value
                    )
                  }
                >
                  {(device.status?.components.main.switch.switch.value === "on" || device.status?.components.main.switchLevel.level.value > 0) ? "Turn Off" : "Turn On"}
                </button>
                
                {/* Brightness Control */}
                <div className="mt-3">
                  <label htmlFor={`brightness-${device.deviceId}`} className="form-label">Brightness</label>
                  <input
                    type="range"
                    className="form-range"
                    min="0"
                    max="100"
                    id={`brightness-${device.deviceId}`}
                    value={device.status?.components.main.switchLevel.level.value || 0}
                    onChange={(e) => handleSliderChange(device.deviceId, e.target.value)} // Update brightness in state while sliding
                    onMouseUp={(e) => handleBrightnessChange(device.deviceId, e.target.value)} // Trigger on release
                    onTouchEnd={(e) => handleBrightnessChange(device.deviceId, e.target.value)} // Handle touch for mobile
                  />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
