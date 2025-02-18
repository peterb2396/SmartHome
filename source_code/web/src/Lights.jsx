import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import "bootstrap/dist/css/bootstrap.min.css";

export default function Lights({ BASE_URL }) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);

  // Section visibility state
  const [showLights, setShowLights] = useState(true);
  const [showAppliances, setShowAppliances] = useState(true);
  const [showSmartPlugs, setShowSmartPlugs] = useState(true);

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

    const handleVisibilityChange = () => {
      if (!document.hidden) fetchDevices();
    };

    const handleFocus = () => fetchDevices();

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [fetchDevices]);

  const updateDeviceState = async (deviceId, on, level) => {
    try {
      const payload = {
        devices: [deviceId],
        on: on === "on",
        password: localStorage.getItem("token"),
        level: level,
      };
      await axios.post(`${BASE_URL}/lights`, payload);
      fetchDevices();
    } catch (error) {
      console.error("Error updating device state:", error);
    }
  };

  const handleToggleDevice = (deviceId, currentState) => {
    const newState = currentState === "on" ? "off" : "on";
    updateDeviceState(deviceId, newState);
  };

  const handleBrightnessChange = (deviceId, level) => {
    updateDeviceState(deviceId, "on", Number(level));
  };

  const handleSliderChange = (deviceId, level) => {
    setDevices((devices) =>
      devices.map((device) =>
        device.deviceId === deviceId
          ? {
              ...device,
              status: {
                ...device.status,
                components: {
                  ...device.status.components,
                  main: {
                    ...device.status.components.main,
                    switchLevel: {
                      level: { value: level },
                    },
                  },
                },
              },
            }
          : device
      )
    );
  };

  // Format operating state using data from "samsungce.dryerOperatingState"
  const formatOperatingState = (operatingStateObj) => {
    if (!operatingStateObj?.operatingState) return null;
    const { value, completionTime } = operatingStateObj.operatingState;
    const stateLower = value.toLowerCase();

    if (stateLower === "finished" || stateLower === "ready") {
      if (completionTime) {
        const eventTime = new Date(completionTime.value || completionTime);
        const now = new Date();
        const isToday = eventTime.toDateString() === now.toDateString();
        const timeString = eventTime.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        return `Finished ${isToday ? "today" : "on " + eventTime.toLocaleDateString()} at ${timeString}`;
      }
      return "Finished";
    } else if (stateLower === "running") {
      // If running, use remainingTimeStr if available
      if (operatingStateObj.remainingTimeStr?.value) {
        return `${operatingStateObj.washerJobState? operatingStateObj.washerJobState.value : operatingStateObj.dryerJobState? operatingStateObj.dryerJobState.value: "Running"} – ${operatingStateObj.remainingTimeStr.value} remaining`;
      }
      return "Running";
    } else {
      return value.charAt(0).toUpperCase() + value.slice(1);
    }
  };

  // Filter devices into categories
  const lightsDevices = devices.filter(
    (device) => device.name && device.name.toLowerCase().startsWith("c2c") &&
    device.name && !device.name.toLowerCase().includes("switch")
  );
  const appliancesDevices = devices.filter(
    (device) =>
      device.deviceTypeName &&
      device.deviceTypeName.toLowerCase().includes("samsung")
  );
  const smartPlugsDevices = devices.filter(
    (device) =>
      !(device.deviceTypeName && device.deviceTypeName.toLowerCase().includes("samsung")) &&
      device.name && device.name.toLowerCase().includes("switch")

  );

  if (loading) {
    return <div>Loading devices...</div>;
  }

  return (
    <div className="container mt-5">
      {/* Lights Section */}
      <h2
        className="mb-3"
        style={{ cursor: "pointer", borderBottom: "2px solid #ccc" }}
        onClick={() => setShowLights(!showLights)}
      >
        Lights {showLights ? "−" : "+"}
      </h2>
      {showLights && (
        <div className="row mb-5">
          {lightsDevices.map((device) => {
            const mainStatus = device.status?.components?.main || {};
            const isOn =
              mainStatus.switch?.switch?.value === "on" ||
              mainStatus.switchLevel?.level?.value > 0;
              
            return (
              <div key={device.deviceId} className="col-md-4 mb-4">
                <div className="card shadow-lg">
                  <div className="card-body">
                    {/* <h5 className="card-title">{device.label} {mainStatus.healthCheck["DeviceWatch-DeviceStatus"].value === "offline"? "(Offline)": ""}</h5> */}
                    <button
                      className={`btn ${isOn ? "btn-success" : "btn-danger"}`}
                      onClick={() =>
                        handleToggleDevice(device.deviceId, isOn ? "on" : "off")
                      }
                      disabled = {mainStatus.healthCheck["DeviceWatch-DeviceStatus"].value === "offline"}
                    >
                      {/* {isOn ? "Turn Off" : "Turn On"} */}
                      {device.label} {mainStatus.healthCheck["DeviceWatch-DeviceStatus"].value === "offline"? "(Offline)": ""}

                    </button>
                    {mainStatus.switchLevel && (
                      <div className="mt-3">
                        <label
                          htmlFor={`brightness-${device.deviceId}`}
                          className="form-label"
                        >
                          Brightness
                        </label>
                        <input
                          type="range"
                          className="form-range"
                          min="0"
                          max="100"
                          id={`brightness-${device.deviceId}`}
                          value={mainStatus.switchLevel.level?.value || 0}
                          onChange={(e) =>
                            handleSliderChange(device.deviceId, e.target.value)
                          }
                          onMouseUp={(e) =>
                            handleBrightnessChange(device.deviceId, e.target.value)
                          }
                          onTouchEnd={(e) =>
                            handleBrightnessChange(device.deviceId, e.target.value)
                          }
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Appliances Section */}
      <h2
        className="mb-3"
        style={{ cursor: "pointer", borderBottom: "2px solid #ccc" }}
        onClick={() => setShowAppliances(!showAppliances)}
      >
        Appliances {showAppliances ? "−" : "+"}
      </h2>
      {showAppliances && (
        <div className="row mb-5">
          {appliancesDevices.map((device) => {
            const mainStatus = device.status?.components?.main || {};
            const isOn =
              mainStatus.switch?.switch?.value === "on" ||
              mainStatus.switchLevel?.level?.value > 0;
            return (
              <div key={device.deviceId} className="col-md-4 mb-4">
                <div className="card shadow-lg">
                  <div className="card-body">
                    <div style = {{display: "flex", flexDirecton: "row", gap: 10, alignContent: "center", alignItems: "center"}}>
                        {/* <h5 className="card-title">{device.label}</h5> */}
                        {/* For appliances, show a disabled on/off button */}
                        <button
                        className={`btn ${isOn ? "btn-success" : "btn-danger"}`}
                        disabled
                        >
                        {/* {isOn ? "On" : "Off"} */}
                            {device.label}
                        </button>
                    </div>
                    <div className="mt-3">
                      {/* Operating State */}
                      {mainStatus["samsungce.dryerOperatingState"] &&
                        formatOperatingState(
                          mainStatus["samsungce.dryerOperatingState"]
                        ) && (
                          <p>
                            <strong>Status:</strong>{" "}
                            {formatOperatingState(
                              mainStatus["samsungce.dryerOperatingState"]
                            )}
                          </p>
                        )}

                {mainStatus["samsungce.washerOperatingState"] &&
                        formatOperatingState(
                          mainStatus["samsungce.washerOperatingState"]
                        ) && (
                          <p>
                            <strong>Status:</strong>{" "}
                            {formatOperatingState(
                              mainStatus["samsungce.washerOperatingState"]
                            )}

                          </p>
                        )}


                      {/* Detergent info only if deviceTypeName includes "wash" */}

                      {/* {device.deviceTypeName &&
                        device.deviceTypeName.toLowerCase().includes("wash") &&
                        mainStatus["samsungce.detergentState"] &&
                        mainStatus["samsungce.detergentState"].detergentType?.value !=
                          null && (
                          <p>
                            <strong>Detergent:</strong>{" "}
                            {
                              mainStatus["samsungce.detergentState"]
                                .detergentType.value
                            }
                          </p>
                        )} */}

                      {device.deviceTypeName &&
                        device.deviceTypeName.toLowerCase().includes("wash") &&
                        mainStatus["samsungce.detergentState"] &&
                        mainStatus["samsungce.detergentState"].remainingAmount
                          ?.value != null && (
                          <p>
                            <strong>Detergent Remaining:</strong>{" "}
                            {
                              mainStatus["samsungce.detergentState"]
                                .remainingAmount.value
                            }{" "}
                            {mainStatus["samsungce.detergentState"].remainingAmount
                              .unit || ""}
                          </p>
                        )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Smart Plugs Section */}
      <h2
        className="mb-3"
        style={{ cursor: "pointer", borderBottom: "2px solid #ccc" }}
        onClick={() => setShowSmartPlugs(!showSmartPlugs)}
      >
        Smart Plugs {showSmartPlugs ? "−" : "+"}
      </h2>
      {showSmartPlugs && (
        <div className="row mb-5">
          {smartPlugsDevices.map((device) => {
            const mainStatus = device.status?.components?.main || {};
            const isOn =
              mainStatus.switch?.switch?.value === "on" ||
              mainStatus.switchLevel?.level?.value > 0;
            return (
              <div key={device.deviceId} className="col-md-4 mb-4">
                <div className="card shadow-lg">
                  <div className="card-body">
                    {/* <h5 className="card-title">{device.label} {mainStatus.healthCheck["DeviceWatch-DeviceStatus"].value === "offline"? "(Offline)": ""}</h5> */}
                    <button
                      className={`btn ${isOn ? "btn-success" : "btn-danger"}`}
                      onClick={() =>
                        handleToggleDevice(device.deviceId, isOn ? "on" : "off")
                      }
                      disabled = {mainStatus.healthCheck["DeviceWatch-DeviceStatus"].value === "offline"}
                    >
                      {/* {isOn ? "Turn Off" : "Turn On"} */}
                      {device.label} {mainStatus.healthCheck["DeviceWatch-DeviceStatus"].value === "offline"? "(Offline)": ""}

                    </button>
                    {mainStatus.switchLevel && (
                      <div className="mt-3">
                        <label
                          htmlFor={`brightness-${device.deviceId}`}
                          className="form-label"
                        >
                          Brightness
                        </label>
                        <input
                          type="range"
                          className="form-range"
                          min="0"
                          max="100"
                          id={`brightness-${device.deviceId}`}
                          value={mainStatus.switchLevel.level?.value || 0}
                          onChange={(e) =>
                            handleSliderChange(device.deviceId, e.target.value)
                          }
                          onMouseUp={(e) =>
                            handleBrightnessChange(device.deviceId, e.target.value)
                          }
                          onTouchEnd={(e) =>
                            handleBrightnessChange(device.deviceId, e.target.value)
                          }
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
