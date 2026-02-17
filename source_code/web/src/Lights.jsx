import { useState, useEffect, useCallback, useRef } from "react";
import axios from "./axios";
import "bootstrap/dist/css/bootstrap.min.css";
import { FaCog, FaLightbulb, FaTv, FaPlug, FaChevronDown, FaChevronUp, FaPowerOff, FaMoon, FaSun, FaStarAndCrescent, FaCloudMoon, FaFan, FaCar, FaLock, FaLockOpen } from "react-icons/fa";

export default function Lights() {
  const [devices, setDevices] = useState([]);
  const [settings, setSettings] = useState({});
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [modalDevice, setModalDevice] = useState(null);
  const [modalLutronId, setModalLutronId] = useState("");
  const [modalOwnerId, setModalOwnerId] = useState("");
  const [modalRoom, setModalRoom] = useState("");
  const [initedSettings, setInitedSettings] = useState(false);

  const [showLights, setShowLights] = useState(true);
  const [showAppliances, setShowAppliances] = useState(true);
  const [showSmartPlugs, setShowSmartPlugs] = useState(false);
  const [showWeather, setShowWeather] = useState(true);
  const [expandedRooms, setExpandedRooms] = useState({});
  
  const [carStarting, setCarStarting] = useState(false);
  const [carStartSuccess, setCarStartSuccess] = useState(false);
  const [carStartMessage, setCarStartMessage] = useState("");

  const [carLocking, setCarLocking] = useState(false);
  const [carLockSuccess, setCarLockSuccess] = useState(false);
  const [carLockMessage, setCarLockMessage] = useState("");

  const [carUnlocking, setCarUnlocking] = useState(false);
  const [carUnlockSuccess, setCarUnlockSuccess] = useState(false);
  const [carUnlockMessage, setCarUnlockMessage] = useState("");

  const POLL_INTERVAL = 3000

  // Fetch devices
  const currentFetchController = useRef(null);
  const [pausePollingUntil, setPausePollingUntil] = useState(0);

  const fetchDevices = useCallback(async () => {
    if (Date.now() < pausePollingUntil) return;

    if (currentFetchController.current) {
      currentFetchController.current.abort();
    }

    const controller = new AbortController();
    currentFetchController.current = controller;

    try {
      const { data } = await axios.get(`/list-devices`, {
        signal: controller.signal
      });
      setDevices(data);
    } catch (e) {
      if (e.name !== "CanceledError" && e.name !== "AbortError") {
        console.error("Error fetching devices:", e);
      }
    } finally {
      setLoading(false);
      currentFetchController.current = null;
    }
  }, [pausePollingUntil]);

  function handleUserChange() {
    currentFetchController.current?.abort();
    pausePolling();
  }

  useEffect(() => {
    const interval = setInterval(() => {
      if (Date.now() >= pausePollingUntil) {
        fetchDevices();
      }
    }, POLL_INTERVAL);

    return () => {
      clearInterval(interval);
      currentFetchController.current?.abort();
    }
  }, [fetchDevices, pausePollingUntil]);

  function pausePolling() {
    setPausePollingUntil(Date.now() + 1000);
  }

  const fetchSettings = useCallback(async () => {
    try {
      const { data } = await axios.get(`/settings`);
      setSettings(data);
    } catch (e) {
      console.error("Error fetching settings:", e);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const { data } = await axios.get(`/users`);
      setUsers(data);
    } catch (e) {
      console.error("Error fetching users:", e);
    }
  }, []);

  const updateSetting = useCallback(
    async (key, value) => {
      try {
        await axios.post(`/settings`, { key, value });
        setSettings((prev) => ({ ...prev, [key]: value }));
      } catch (error) {
        console.error("Error updating setting:", error);
      }
    },
    []
  );

  const StargazingDisplay = () => {
    const moonriseTime = settings.stargazingStart || "N/A"
    const sunsetTime = settings.stargazingEnd || "N/A"
  
    return (
      <div style={styles.wrapper}>
        <div style={styles.headerWrapper}>
          <h3 style={styles.headerTitleText}>Darksky</h3>
        </div>
  
        <div style={styles.timesIconRow}>
          <div style={styles.timeIconSection}>
            <div style={{ ...styles.baseIconStyle, ...styles.moonIconBackground }}>
              <FaStarAndCrescent />
            </div>
            <div style={styles.timeTextStyle}>{moonriseTime}</div>
          </div>
  
          <div style={styles.timeIconSection}>
            <div style={{ ...styles.baseIconStyle, ...styles.sunIconBackground }}>
              <FaCloudMoon />
            </div>
            <div style={styles.timeTextStyle}>{sunsetTime}</div>
          </div>
        </div>
      </div>
    );
  };

  const SunsetDisplay = () => {
    return (
      <div style={styles.wrapper}>
        <div style={styles.headerWrapper}>
          <h3 style={styles.headerTitleText}>Sunrise</h3>
        </div>
  
        <div style={styles.timesIconRow}>
          <div style={styles.timeIconSection}>
            <div style={{ ...styles.baseIconStyle, ...styles.sunIconBackground }}>
              <FaSun />
            </div>
            <div style={styles.timeTextStyle}>{settings.sunrise}</div>
          </div>
  
          <div style={styles.timeIconSection}>
            <div style={{ ...styles.baseIconStyle, ...styles.moonIconBackground }}>
              <FaMoon />
            </div>
            <div style={styles.timeTextStyle}>{settings.sunset}</div>
          </div>
        </div>
      </div>
    );
  };

  useEffect(() => {
    fetchDevices();
    fetchSettings();
    fetchUsers();
  }, [fetchDevices, fetchSettings, fetchUsers]);

  // Start car
  const startCar = async () => {
    setCarStarting(true);
    setCarStartSuccess(false);
    setCarStartMessage("");

    try {
      const response = await axios.post(`/start-car`, { password: localStorage.getItem("token") });
      if (response.data.ok) {
        setCarStartSuccess(true);
        setCarStartMessage(response.data.message || "Car started successfully!");
        setTimeout(() => {
          setCarStartSuccess(false);
          setCarStartMessage("");
        }, 5000);
      } else {
        setCarStartMessage(response.data.message || "Failed to start car");
      }
    } catch (error) {
      console.error("Error starting car:", error);
      setCarStartMessage("Error: Could not communicate with car");
    } finally {
      setCarStarting(false);
    }
  };

  // Lock car
  const lockCar = async () => {
    setCarLocking(true);
    setCarLockSuccess(false);
    setCarLockMessage("");

    try {
      const response = await axios.post(`/lock-car`, { password: localStorage.getItem("token") });
      if (response.data.ok) {
        setCarLockSuccess(true);
        setCarLockMessage(response.data.message || "Car locked!");
        setTimeout(() => {
          setCarLockSuccess(false);
          setCarLockMessage("");
        }, 5000);
      } else {
        setCarLockMessage(response.data.message || "Failed to lock car");
      }
    } catch (error) {
      console.error("Error locking car:", error);
      setCarLockMessage("Error: Could not communicate with car");
    } finally {
      setCarLocking(false);
    }
  };

  // Unlock car
  const unlockCar = async () => {
    setCarUnlocking(true);
    setCarUnlockSuccess(false);
    setCarUnlockMessage("");

    try {
      const response = await axios.post(`/unlock-car`, { password: localStorage.getItem("token") });
      if (response.data.ok) {
        setCarUnlockSuccess(true);
        setCarUnlockMessage(response.data.message || "Car unlocked!");
        setTimeout(() => {
          setCarUnlockSuccess(false);
          setCarUnlockMessage("");
        }, 5000);
      } else {
        setCarUnlockMessage(response.data.message || "Failed to unlock car");
      }
    } catch (error) {
      console.error("Error unlocking car:", error);
      setCarUnlockMessage("Error: Could not communicate with car");
    } finally {
      setCarUnlocking(false);
    }
  };

  // Initialize settings.lights once after devices & settings are loaded
  useEffect(() => {
    if (!loading && settings && devices.length && !initedSettings) {
      const existing = settings.lights || {};
      const merged = { ...existing };
      devices
        .filter(
          (d) =>
            d.name?.toLowerCase().startsWith("c2c") &&
            !d.name.toLowerCase().includes("switch")
        )
        .forEach((d) => {
          if (!merged[d.deviceId]) {
            merged[d.deviceId] = {
              deviceId: d.deviceId,
              label: d.label,
              lutronId: existing[d.deviceId]?.lutronId || "",
              owner: existing[d.deviceId]?.owner || "",
              room: existing[d.deviceId]?.room || "Uncategorized"
            };
          }
        });
      updateSetting("lights", merged);
      setInitedSettings(true);
    }
  }, [loading, settings, devices, initedSettings, updateSetting]);

  const updateDeviceState = async (deviceId, on, level = null) => {
    handleUserChange();

    setDevices((devices) =>
      devices.map((device) => {
        if (device.deviceId === deviceId) {
          const isFan = device.name.toLowerCase().includes("fan");
          const isPlug = device.name.toLowerCase().includes("c2c-switch");
          const main = device.status?.components?.main || {};
    
          return {
            ...device,
            status: {
              ...device.status,
              components: {
                ...device.status.components,
                main: {
                  ...main,
                  switch: { switch: { value: on === "on" ? "on" : "off" } },
                  ...(!isPlug
                    ? isFan
                      ? { fanSpeed: { fanSpeed: { value: on === "on" ? level : 0 } } }
                      : { switchLevel: { level: { value: on === "on" ? level : 0 } } }
                    : {}
                  ),
                },
              },
            },
          };
        }
  
        return device;
      })
    );

    try {
      const payload = {
        devices: [deviceId],
        on: on === "on",
        password: localStorage.getItem("token"),
        level: level,
      };
      await axios.post(`/lights`, payload);
    } catch (error) {
      console.error("Error updating device state:", error);
    }
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
                    switch: { switch: { value: Number(level) > 0 ? "on" : "off" } },
                    ...(device.name.toLowerCase().includes("fan")
                    ? { fanSpeed: { fanSpeed: { value: Number(level) } } }
                    : { switchLevel: { level: { value: Number(level) } } }
                  ),
                  },
                },
              },
            }
          : device
      )
    );
  };

  const handleBrightnessChange = (deviceId, level) => {
    updateDeviceState(deviceId, "on", Number(level));
  };

  const openSettings = (deviceId) => {
    const light = settings.lights?.[deviceId] || {};
    setModalDevice(deviceId);
    setModalLutronId(light.lutronId ?? "");
    setModalOwnerId(light.owner ?? "");
    setModalRoom(light.room ?? "Uncategorized");
    setShowModal(true);
  };
  
  const saveSettings = () => {
    const updated = {
      ...settings.lights,
      [modalDevice]: {
        ...settings.lights[modalDevice],
        lutronId: modalLutronId,
        owner: modalOwnerId,
        room: modalRoom,
      },
    };
    updateSetting("lights", updated);
    setShowModal(false);
  };

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingContent}>
          <div style={styles.spinner}></div>
          <p style={styles.loadingText}>Loading your smart home...</p>
        </div>
      </div>
    );
  }

  const lightsDevices = devices.filter(
    (d) =>
      d.name?.toLowerCase().startsWith("c2c") &&
      !d.name.toLowerCase().includes("switch")
  );
  
  const lightsByRoom = lightsDevices.reduce((acc, device) => {
    const room = settings.lights?.[device.deviceId]?.room || "Uncategorized";
    if (!acc[room]) {
      acc[room] = [];
    }
    acc[room].push(device);
    return acc;
  }, {});

  const appliancesDevices = devices.filter(
    (d) =>
      d.deviceTypeName && d.deviceTypeName.toLowerCase().includes("samsung")
  );
  const smartPlugsDevices = devices.filter(
    (d) =>
      !(d.deviceTypeName && d.deviceTypeName.toLowerCase().includes("samsung")) &&
      d.name &&
      d.name.toLowerCase().includes("switch")
  );

  const SectionHeader = ({ title, isExpanded, onClick, icon: Icon, count }) => (
    <div className="section-header" style={styles.sectionHeader} onClick={onClick}>
      <div style={styles.sectionHeaderLeft}>
        <div style={styles.iconContainer}>
          <Icon style={styles.icon} />
        </div>
        <div>
          <h2 style={styles.sectionTitle}>{title}</h2>
          {count > 0 && (
            <p style={styles.deviceCount}>{count} devices</p>
          )}
        </div>
      </div>
      <div style={styles.sectionHeaderRight}>
        {isExpanded ? <FaChevronUp style={styles.chevron} /> : <FaChevronDown style={styles.chevron} />}
      </div>
    </div>
  );

  const RoomHeader = ({ room, count, isExpanded, onClick }) => (
    <div className="room-header" style={styles.roomHeader} onClick={onClick}>
      <div style={styles.roomHeaderLeft}>
        <h3 style={styles.roomTitle}>{room}</h3>
        <span style={styles.roomCount}>{count} {count === 1 ? 'light' : 'lights'}</span>
      </div>
      <div style={styles.roomHeaderRight}>
        {isExpanded ? <FaChevronUp style={styles.chevronSmall} /> : <FaChevronDown style={styles.chevronSmall} />}
      </div>
    </div>
  );

  const LightCard = ({ device }) => {
    const mainStatus = device.status?.components?.main || {};
    const isOn = mainStatus.switch?.switch?.value === "on" || (mainStatus.switchLevel?.level?.value > 0);
    const isOffline = mainStatus.healthCheck?.["DeviceWatch-DeviceStatus"]?.value === "offline";
    const brightness = mainStatus.switchLevel?.level?.value || 0;

    const speedLabels = ['Off', 'Low', 'Medium', 'High', 'Max'];
    const speedValue = mainStatus.fanSpeed?.fanSpeed?.value || 0;
    const speed = speedLabels[speedValue] ?? 'Unknown';
    const isFan = device.name.toLowerCase().includes("fan");

    return (
      <div key={device.deviceId} style={styles.deviceCardWrapper}>
        <div style={{
          ...styles.deviceCard,
          ...(isOn ? styles.deviceCardActive : {}),
          ...(isOffline ? styles.deviceCardOffline : {})
        }}>
          
          <button
            className="settings-button"
            style={styles.settingsButton}
            onClick={() => openSettings(device.deviceId)}
          >
            <FaCog />
          </button>

          <div style={styles.cardContent}>
            <div style={styles.deviceHeader}>
              <div style={styles.deviceInfo}>
                <div style={{
                  ...styles.deviceIcon,
                  ...(isOn ? styles.deviceIconActive : {})
                }}
                onClick={() => updateDeviceState(device.deviceId, isOn ? "off" : "on", (isFan ? speedValue : brightness || 100))}>
                  {isFan && <FaFan />}
                  {!isFan && <FaLightbulb />}
                </div>
                <div>
                  <h3 style={styles.deviceName}>{device.label}</h3>
                  <p style={styles.deviceStatus}>
                    {isOffline ? 'Offline' : isOn ? (isFan ? `${speed} speed` : `${brightness}% brightness`) : 'Off'}
                  </p>
                </div>
              </div>
            </div>

            {(mainStatus.switchLevel || mainStatus.fanSpeed) && (
              <div style={styles.sliderContainer}>
                <div style={styles.sliderHeader}>
                  <span style={styles.sliderLabel}>{isFan ? "Speed" : "Brightness"}</span>
                  <span style={styles.sliderValue}>{isFan ? `${speed}` : `${brightness}%`}</span>
                </div>
                <input
                  type="range"
                  style={{
                    ...styles.slider,
                    background: `linear-gradient(to right, #fbbf24 0%, #fbbf24 ${isFan ? speedValue*25 : brightness}%, #e5e7eb ${isFan ? speedValue*25 : brightness}%, #e5e7eb 100%)`
                  }}
                  min="0"
                  max={isFan ? "4" : "100"}
                  value={isFan ? speedValue : brightness}
                  onChange={(e) => handleSliderChange(device.deviceId, e.target.value)}
                  onMouseUp={(e) => handleBrightnessChange(device.deviceId, e.target.value)}
                  onTouchEnd={(e) => handleBrightnessChange(device.deviceId, e.target.value)}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'}}>
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.02); }
        }
        
        @keyframes takeoff {
          0% {
            transform: translateX(0) translateY(0) rotate(0deg) scale(1);
            opacity: 1;
          }
          30% {
            transform: translateX(20px) translateY(-10px) rotate(-15deg) scale(1.1);
          }
          100% {
            transform: translateX(200px) translateY(-100px) rotate(-25deg) scale(0.5);
            opacity: 0;
          }
        }
        
        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        .car-start-button:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 15px 40px rgba(239, 68, 68, 0.5);
        }
        
        .car-start-button:active:not(:disabled) {
          transform: translateY(0);
        }

        .car-lock-button:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 15px 40px rgba(59, 130, 246, 0.5);
        }

        .car-lock-button:active:not(:disabled) {
          transform: translateY(0);
        }

        .car-unlock-button:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 15px 40px rgba(245, 158, 11, 0.5);
        }

        .car-unlock-button:active:not(:disabled) {
          transform: translateY(0);
        }
        
        .device-card-wrapper:hover .settings-button {
          opacity: 1;
        }
        
        .settings-button:hover {
          background: #e2e8f0;
          color: #1e293b;
        }
        
        .modal-close-button:hover {
          background: rgba(255, 255, 255, 0.3);
        }
        
        input:focus, select:focus {
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
        
        .cancel-button:hover {
          background: #cbd5e1;
        }
        
        .save-button:hover {
          background: #2563eb;
        }
        
        .plug-toggle:hover:not(:disabled) {
          transform: scale(1.05);
        }
        
        .section-header:hover {
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
        
        .room-header:hover {
          background: #f8fafc;
        }
      `}</style>
      
      <div style={styles.content}>
        <div style={styles.header}>
        </div>

        {/* Lights Section with Car Buttons */}
        <div style={{display: "flex", gap: 10, marginBottom: "1.5rem"}}>
          <div style={{flex: 1}}>
            <SectionHeader 
              title="Lights" 
              isExpanded={showLights} 
              onClick={() => setShowLights(!showLights)}
              icon={FaLightbulb}
              count={lightsDevices.length}
            />
          </div>
          
          {/* Car Buttons Group */}
          <div style={styles.carButtonsGroup}>
            {/* Start Car Button */}
            <div style={styles.carButtonContainer}>
              <button
                className="car-start-button"
                style={{
                  ...styles.carActionButton,
                  ...styles.carStartButton,
                  ...(carStarting ? styles.carStartButtonLoading : {}),
                  ...(carStartSuccess ? styles.carStartButtonSuccess : {})
                }}
                onClick={startCar}
                disabled={carStarting}
                title="Start Car"
              >
                <div style={{
                  ...styles.carIconWrapper,
                  ...(carStartSuccess ? styles.carIconTakeoff : {})
                }}>
                  <FaCar style={styles.carIcon} />
                </div>
              </button>
              {carStartMessage && (
                <div style={{
                  ...styles.carMessage,
                  ...(carStartSuccess ? styles.carMessageSuccess : styles.carMessageError)
                }}>
                  {carStartMessage}
                </div>
              )}
            </div>

            {/* Lock Car Button */}
            <div style={styles.carButtonContainer}>
              <button
                className="car-lock-button"
                style={{
                  ...styles.carActionButton,
                  ...styles.carLockButton,
                  ...(carLocking ? styles.carLockButtonLoading : {}),
                  ...(carLockSuccess ? styles.carLockButtonSuccess : {})
                }}
                onClick={lockCar}
                disabled={carLocking}
                title="Lock Car"
              >
                <div style={styles.carIconWrapper}>
                  <FaLock style={styles.carIcon} />
                </div>
              </button>
              {carLockMessage && (
                <div style={{
                  ...styles.carMessage,
                  ...(carLockSuccess ? styles.carMessageSuccess : styles.carMessageError)
                }}>
                  {carLockMessage}
                </div>
              )}
            </div>

            {/* Unlock Car Button */}
            <div style={styles.carButtonContainer}>
              <button
                className="car-unlock-button"
                style={{
                  ...styles.carActionButton,
                  ...styles.carUnlockButton,
                  ...(carUnlocking ? styles.carUnlockButtonLoading : {}),
                  ...(carUnlockSuccess ? styles.carUnlockButtonSuccess : {})
                }}
                onClick={unlockCar}
                disabled={carUnlocking}
                title="Unlock Car"
              >
                <div style={styles.carIconWrapper}>
                  <FaLockOpen style={styles.carIcon} />
                </div>
              </button>
              {carUnlockMessage && (
                <div style={{
                  ...styles.carMessage,
                  ...(carUnlockSuccess ? styles.carMessageSuccess : styles.carMessageError)
                }}>
                  {carUnlockMessage}
                </div>
              )}
            </div>
          </div>
        </div>
        
        {showLights && (
          <div style={{marginBottom: '3rem'}}>
            {Object.entries(lightsByRoom).sort(([a], [b]) => a.localeCompare(b)).map(([room, roomDevices]) => (
              <div key={room} style={styles.roomSection}>
                <RoomHeader 
                  room={room}
                  count={roomDevices.length}
                  isExpanded={expandedRooms[room] !== false}
                  onClick={() => setExpandedRooms(prev => ({ ...prev, [room]: prev[room] === false }))}
                />
                {expandedRooms[room] !== false && (
                  <div style={styles.deviceGrid}>
                    {roomDevices.map(device => (
                      <LightCard key={device.deviceId} device={device} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Appliances Section */}
        <SectionHeader 
          title="Appliances" 
          isExpanded={showAppliances} 
          onClick={() => setShowAppliances(!showAppliances)}
          icon={FaTv}
          count={appliancesDevices.length}
        />
        
        {showAppliances && (
          <div style={styles.deviceGrid}>
            {appliancesDevices.map((device) => {
              const mainStatus = device.status?.components?.main || {};
              const isOffline = mainStatus.healthCheck?.["DeviceWatch-DeviceStatus"]?.value === "offline";

              return (
                <div className="device-card-wrapper" key={device.deviceId} style={styles.deviceCardWrapper}>
                  <div style={{
                    ...styles.deviceCard,
                    ...(isOffline ? styles.deviceCardOffline : {})
                  }}>
                    <div style={styles.cardContent}>
                      <div style={styles.deviceHeader}>
                        <div style={styles.deviceInfo}>
                          <div style={{...styles.deviceIcon, ...styles.applianceIcon}}>
                            <FaTv />
                          </div>
                          <div>
                            <h3 style={styles.deviceName}>{device.label}</h3>
                            <p style={styles.deviceStatus}>
                              {isOffline ? 'Offline' : 'Connected'}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div style={styles.statusContainer}>
                        {mainStatus["samsungce.dryerOperatingState"] &&
                          formatOperatingState(mainStatus["samsungce.dryerOperatingState"]) && (
                            <div style={styles.statusRow}>
                              <span style={styles.statusLabel}>Status</span>
                              <span style={styles.statusValue}>
                                {formatOperatingState(mainStatus["samsungce.dryerOperatingState"])}
                              </span>
                            </div>
                          )}
                        
                        {mainStatus["samsungce.washerOperatingState"] &&
                          formatOperatingState(mainStatus["samsungce.washerOperatingState"]) && (
                            <div style={styles.statusRow}>
                              <span style={styles.statusLabel}>Status</span>
                              <span style={styles.statusValue}>
                                {formatOperatingState(mainStatus["samsungce.washerOperatingState"])}
                              </span>
                            </div>
                          )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <SectionHeader 
          title="Weather" 
          isExpanded={showWeather} 
          onClick={() => setShowWeather(!showWeather)}
          icon={FaSun}
        />

        {showWeather && (
          <div style={{...styles.deviceGrid, gridTemplateColumns: 'repeat(auto-fit, minmin(100px, 1fr))'}}>
            <SunsetDisplay />
            <StargazingDisplay />
          </div>
        )}

        {/* Smart Plugs Section */}
        <SectionHeader 
          title="Smart Plugs" 
          isExpanded={showSmartPlugs} 
          onClick={() => setShowSmartPlugs(!showSmartPlugs)}
          icon={FaPlug}
          count={smartPlugsDevices.length}
        />
        
        {showSmartPlugs && (
          <div style={styles.deviceGrid}>
            {smartPlugsDevices.map((device) => {
              const mainStatus = device.status?.components?.main || {};
              const isOn = mainStatus.switch?.switch?.value === "on" || (mainStatus.switchLevel?.level?.value > 0);
              const isOffline = mainStatus.healthCheck?.["DeviceWatch-DeviceStatus"]?.value === "offline";

              return (
                <div key={device.deviceId} style={styles.deviceCardWrapper}>
                  <div style={{
                    ...styles.deviceCard,
                    ...(isOn ? styles.plugCardActive : {}),
                    ...(isOffline ? styles.deviceCardOffline : {})
                  }}>
                    <div style={styles.cardContent}>
                      <div style={styles.plugHeader}>
                        <div style={styles.deviceInfo}>
                          <div style={{
                            ...styles.deviceIcon,
                            ...(isOn ? styles.plugIconActive : {})
                          }}>
                            <FaPlug />
                          </div>
                          <div>
                            <h3 style={styles.deviceName}>{device.label}</h3>
                            <p style={styles.deviceStatus}>
                              {isOffline ? 'Offline' : isOn ? 'Active' : 'Inactive'}
                            </p>
                          </div>
                        </div>
                        
                        <button
                          className="plug-toggle"
                          style={{
                            ...styles.plugToggle,
                            ...(!isOn ? styles.plugToggleOff : styles.plugToggleOn),
                            ...(isOffline ? styles.powerButtonDisabled : {})
                          }}
                          onClick={() => {
                            updateDeviceState(device.deviceId, isOn ? "off" : "on", null);
                          }}
                          disabled={isOffline}
                        >
                          <FaPowerOff />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Settings Modal */}
        {showModal && (
          <div style={styles.modalOverlay}>
            <div style={styles.modal}>
              <div style={styles.modalHeader}>
                <div style={styles.modalHeaderContent}>
                  <h2 style={styles.modalTitle}>Light Settings</h2>
                  <button
                    className="modal-close-button"
                    style={styles.modalCloseButton}
                    onClick={() => setShowModal(false)}
                  >
                    ×
                  </button>
                </div>
              </div>
              
              <div style={styles.modalBody}>
                <div style={styles.inputGroup}>
                  <label style={styles.label}>Room</label>
                  <input
                    type="text"
                    style={styles.input}
                    value={modalRoom}
                    onChange={(e) => setModalRoom(e.target.value)}
                    placeholder="e.g., Living Room, Bedroom"
                  />
                </div>
                
                <div style={styles.inputGroup}>
                  <label style={styles.label}>Lutron ID</label>
                  <input
                    type="number"
                    style={styles.input}
                    value={modalLutronId}
                    onChange={(e) => setModalLutronId(e.target.value)}
                    placeholder="Enter Lutron ID"
                  />
                </div>
                
                <div style={styles.inputGroup}>
                  <label style={styles.label}>Owner</label>
                  <select
                    style={styles.select}
                    value={modalOwnerId}
                    onChange={(e) => setModalOwnerId(e.target.value)}
                  >
                    <option value="">— Select Owner —</option>
                    {users.map((u) => (
                      <option key={u.name} value={u.name}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div style={styles.modalFooter}>
                <button
                  className="cancel-button"
                  style={styles.cancelButton}
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>
                <button
                  className="save-button"
                  style={styles.saveButton}
                  onClick={saveSettings}
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  content: {
    maxWidth: '1400px',
    margin: '0 auto',
    padding: '2rem'
  },
  carButtonsGroup: {
    display: 'flex',
    gap: '10px',
  },
  carButtonContainer: {
    position: 'relative',
    width: '100px'
  },
  // Base style shared by all car action buttons
  carActionButton: {
    width: '100%',
    height: '100px',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    transition: 'all 0.3s ease',
    position: 'relative',
    overflow: 'hidden'
  },
  carStartButton: {
    background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
    boxShadow: '0 10px 30px rgba(239, 68, 68, 0.4)',
  },
  carStartButtonLoading: {
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    boxShadow: '0 10px 30px rgba(245, 158, 11, 0.4)',
    animation: 'pulse 1.5s ease-in-out infinite'
  },
  carStartButtonSuccess: {
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    boxShadow: '0 10px 30px rgba(16, 185, 129, 0.4)'
  },
  carLockButton: {
    background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
    boxShadow: '0 10px 30px rgba(59, 130, 246, 0.4)',
  },
  carLockButtonLoading: {
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    boxShadow: '0 10px 30px rgba(245, 158, 11, 0.4)',
    animation: 'pulse 1.5s ease-in-out infinite'
  },
  carLockButtonSuccess: {
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    boxShadow: '0 10px 30px rgba(16, 185, 129, 0.4)'
  },
  carUnlockButton: {
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    boxShadow: '0 10px 30px rgba(245, 158, 11, 0.4)',
  },
  carUnlockButtonLoading: {
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    boxShadow: '0 10px 30px rgba(245, 158, 11, 0.4)',
    animation: 'pulse 1.5s ease-in-out infinite'
  },
  carUnlockButtonSuccess: {
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    boxShadow: '0 10px 30px rgba(16, 185, 129, 0.4)'
  },
  carIconWrapper: {
    fontSize: '2rem',
    color: 'white',
    transition: 'all 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
    transform: 'translateX(0) rotate(0deg)'
  },
  carIconTakeoff: {
    animation: 'takeoff 2.0s ease-out forwards'
  },
  carIcon: {
    filter: 'drop-shadow(0 4px 8px rgba(0, 0, 0, 0.2))'
  },
  carMessage: {
    position: 'absolute',
    top: '110px',
    left: '0',
    right: '0',
    textAlign: 'center',
    fontSize: '0.75rem',
    fontWeight: '500',
    padding: '0.25rem 0.5rem',
    borderRadius: '8px',
    animation: 'slideDown 0.3s ease-out',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  carMessageSuccess: {
    color: '#059669',
    background: '#d1fae5'
  },
  carMessageError: {
    color: '#dc2626',
    background: '#fee2e2'
  },
  loadingContainer: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  loadingContent: {
    textAlign: 'center'
  },
  spinner: {
    width: '64px',
    height: '64px',
    border: '4px solid #3b82f6',
    borderTop: '4px solid transparent',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    margin: '0 auto 1rem'
  },
  loadingText: {
    color: '#64748b',
    fontSize: '1.125rem',
    fontWeight: '500',
    margin: 0
  },
  header: {
    textAlign: 'center',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '1.5rem',
    background: 'white',
    borderRadius: '12px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    border: '1px solid #e2e8f0',
    cursor: 'pointer',
    marginBottom: '1.5rem',
    transition: 'all 0.2s ease',
    height: '100px'
  },
  sectionHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem'
  },
  iconContainer: {
    width: '48px',
    height: '48px',
    background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white'
  },
  icon: {
    fontSize: '1.25rem'
  },
  sectionTitle: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#1e293b',
    margin: 0
  },
  deviceCount: {
    color: '#64748b',
    fontSize: '0.875rem',
    margin: 0
  },
  sectionHeaderRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem'
  },
  chevron: {
    color: '#9ca3af'
  },
  roomSection: {
    marginBottom: '2rem'
  },
  roomHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '1rem 1.5rem',
    background: 'white',
    borderRadius: '8px',
    border: '1px solid #e2e8f0',
    cursor: 'pointer',
    marginBottom: '1rem',
    transition: 'all 0.2s ease'
  },
  roomHeaderLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem'
  },
  roomTitle: {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#1e293b',
    margin: 0
  },
  roomCount: {
    fontSize: '0.875rem',
    color: '#64748b',
    fontWeight: '500'
  },
  roomHeaderRight: {
    display: 'flex',
    alignItems: 'center'
  },
  chevronSmall: {
    color: '#9ca3af',
    fontSize: '0.875rem'
  },
  deviceGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '1.5rem',
    marginBottom: '1.5rem'
  },
  deviceCardWrapper: {
    position: 'relative'
  },
  deviceCard: {
    background: 'white',
    borderRadius: '16px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    border: '1px solid #e2e8f0',
    transition: 'all 0.3s ease',
    position: 'relative'
  },
  deviceCardActive: {
    borderColor: '#fde68a',
    background: 'linear-gradient(135deg, #fffbeb 0%, white 100%)'
  },
  plugCardActive: {
    borderColor: '#bfdbfe',
    background: 'linear-gradient(135deg, #eff6ff 0%, white 100%)'
  },
  deviceCardOffline: {
    opacity: '0.6'
  },
  settingsButton: {
    position: 'absolute',
    top: '1rem',
    right: '1rem',
    width: '40px',
    height: '40px',
    background: '#f1f5f9',
    border: 'none',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    color: '#64748b',
    opacity: '0'
  },
  cardContent: {
    padding: '1.5rem'
  },
  deviceHeader: {
    marginBottom: '1.5rem'
  },
  deviceInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem'
  },
  deviceIcon: {
    cursor: "pointer",
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f1f5f9',
    color: '#9ca3af',
    transition: 'all 0.3s ease',
    fontSize: '1.25rem'
  },
  deviceIconActive: {
    background: '#fbbf24',
    color: 'white',
    boxShadow: '0 10px 25px rgba(251, 191, 36, 0.3)'
  },
  applianceIcon: {
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    color: 'white'
  },
  plugIconActive: {
    background: '#3b82f6',
    color: 'white',
    boxShadow: '0 10px 25px rgba(59, 130, 246, 0.3)'
  },
  deviceName: {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#1e293b',
    margin: 0
  },
  deviceStatus: {
    color: '#64748b',
    fontSize: '0.875rem',
    margin: 0
  },
  powerButtonDisabled: {
    cursor: 'not-allowed',
    opacity: '0.5'
  },
  sliderContainer: {
    marginTop: '1rem'
  },
  sliderHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.5rem'
  },
  sliderLabel: {
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#64748b'
  },
  sliderValue: {
    fontSize: '0.875rem',
    color: '#64748b'
  },
  slider: {
    width: '100%',
    height: '8px',
    borderRadius: '4px',
    border: 'none',
    outline: 'none',
    cursor: 'pointer',
    appearance: 'none'
  },
  statusContainer: {
    background: '#f8fafc',
    borderRadius: '12px',
    padding: '1rem'
  },
  statusRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusLabel: {
    fontWeight: '500',
    color: '#64748b'
  },
  statusValue: {
    color: '#1e293b',
    fontWeight: '600'
  },
  plugHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  plugToggle: {
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.3s ease',
    color: 'white',
    fontSize: '1.125rem'
  },
  plugToggleOn: {
    background: '#10b981',
    boxShadow: '0 10px 25px rgba(16, 185, 129, 0.3)'
  },
  plugToggleOff: {
    background: '#ef4444',
    boxShadow: '0 10px 25px rgba(239, 68, 68, 0.3)'
  },
  modalOverlay: {
    position: 'fixed',
    inset: '0',
    background: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: '1000',
    padding: '1rem'
  },
  modal: {
    background: 'white',
    borderRadius: '16px',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    maxWidth: '28rem',
    width: '100%',
    overflow: 'hidden'
  },
  modalHeader: {
    background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
    color: 'white',
    padding: '1.5rem'
  },
  modalHeaderContent: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  modalTitle: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    margin: 0
  },
  modalCloseButton: {
    width: '32px',
    height: '32px',
    background: 'rgba(255, 255, 255, 0.2)',
    border: 'none',
    borderRadius: '50%',
    color: 'white',
    cursor: 'pointer',
    fontSize: '1.25rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease'
  },
  modalBody: {
    padding: '1.5rem'
  },
  inputGroup: {
    marginBottom: '1.5rem'
  },
  label: {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#1e293b',
    marginBottom: '0.5rem'
  },
  input: {
    width: '100%',
    padding: '0.75rem 1rem',
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    fontSize: '1rem',
    outline: 'none',
    transition: 'all 0.2s ease',
    boxSizing: 'border-box'
  },
  select: {
    width: '100%',
    padding: '0.75rem 1rem',
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '12px',
    fontSize: '1rem',
    outline: 'none',
    transition: 'all 0.2s ease',
    boxSizing: 'border-box'
  },
  modalFooter: {
    display: 'flex',
    gap: '0.75rem',
    padding: '1.5rem',
    background: '#f8fafc'
  },
  cancelButton: {
    flex: '1',
    padding: '0.75rem 1rem',
    background: '#e2e8f0',
    color: '#1e293b',
    border: 'none',
    borderRadius: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  },
  saveButton: {
    flex: '1',
    padding: '0.75rem 1rem',
    background: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    boxShadow: '0 10px 25px rgba(59, 130, 246, 0.3)'
  },
  wrapper: {
    padding: '1.5rem',
    background: 'white',
    borderRadius: '12px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
    border: '1px solid #e2e8f0',
    marginBottom: '1.5rem',
    transition: 'all 0.2s ease',
  },
  headerWrapper: {
    textAlign: 'center',
  },
  headerTitleText: {
    fontSize: '1.5rem',
    fontWeight: 300,
    color: '#64748b',
  },
  timesIconRow: {
    display: 'flex',
    justifyContent: 'space-around',
  },
  timeIconSection: {
    textAlign: 'center',
  },
  baseIconStyle: {
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#64748b',
    fontSize: '1.5rem',
  },
  moonIconBackground: {
    background: '#f3f0ff',
  },
  sunIconBackground: {
    background: '#fef3c7',
  },
  timeTextStyle: {
    color: '#64748b',
    fontSize: '0.875rem',
    fontWeight: 500,
  },
};

function formatOperatingState(operatingStateObj) {
  if (!operatingStateObj?.operatingState) return null;
  const { value, timestamp } = operatingStateObj.operatingState;
  const stateLower = value.toLowerCase();

  if (stateLower === "finished" || stateLower === "ready") {
    if (timestamp) {
      const eventTime = new Date(timestamp.value || timestamp);
      const now = new Date();
      const isToday = eventTime.toDateString() === now.toDateString();
      const timeString = eventTime.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      return `Finished ${
        isToday ? "" : eventTime.toLocaleDateString().substring(0, eventTime.toLocaleDateString().indexOf("/", 3))
      } @ ${timeString}`;
    }
    return "Finished";
  } else if (stateLower === "running") {
    if (operatingStateObj.remainingTimeStr?.value) {
      return `${
        operatingStateObj.washerJobState?.value ||
        operatingStateObj.dryerJobState?.value ||
        "Running"
      } – ${operatingStateObj.remainingTimeStr.value} remaining`;
    }
    return "Running";
  } else {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }
}
