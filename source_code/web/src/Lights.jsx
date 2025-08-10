import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import "bootstrap/dist/css/bootstrap.min.css";
import { FaCog, FaLightbulb, FaTv, FaPlug, FaChevronDown, FaChevronUp, FaPowerOff } from "react-icons/fa";

export default function Lights({ BASE_URL }) {
  const [devices, setDevices] = useState([]);
  const [settings, setSettings] = useState({});
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [modalDevice, setModalDevice] = useState(null);
  const [modalLutronId, setModalLutronId] = useState("");
  const [modalOwnerId, setModalOwnerId] = useState("");
  const [initedSettings, setInitedSettings] = useState(false);

  const [showLights, setShowLights] = useState(true);
  const [showAppliances, setShowAppliances] = useState(true);
  const [showSmartPlugs, setShowSmartPlugs] = useState(true);

  // Fetch devices
  const fetchDevices = useCallback(async () => {
    try {
      const { data } = await axios.get(`${BASE_URL}/list-devices`);
      setDevices(data);
    } catch (e) {
      console.error("Error fetching devices:", e);
    } finally {
      setLoading(false);
    }
  }, [BASE_URL]);

  // Fetch settings
  const fetchSettings = useCallback(async () => {
    try {
      const { data } = await axios.get(`${BASE_URL}/settings`);
      setSettings(data);
    } catch (e) {
      console.error("Error fetching settings:", e);
    }
  }, [BASE_URL]);

  // Fetch users
  const fetchUsers = useCallback(async () => {
    try {
      const { data } = await axios.get(`${BASE_URL}/users`);
      setUsers(data);
    } catch (e) {
      console.error("Error fetching users:", e);
    }
  }, [BASE_URL]);

  // Persist settings with stable callback
  const updateSetting = useCallback(
    async (key, value) => {
      try {
        await axios.post(`${BASE_URL}/settings`, { key, value });
        setSettings((prev) => ({ ...prev, [key]: value }));
      } catch (error) {
        console.error("Error updating setting:", error);
      }
    },
    [BASE_URL]
  );

  // Initial load
  useEffect(() => {
    fetchDevices();
    fetchSettings();
    fetchUsers();
  }, [fetchDevices, fetchSettings, fetchUsers]);

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
              owner: existing[d.deviceId]?.owner || ""
            };
          }
        });
      updateSetting("lights", merged);
      setInitedSettings(true);
    }
  }, [loading, settings, devices, initedSettings, updateSetting]);

  // Optimistic Device state update
  const updateDeviceState = async (deviceId, on, level = 100) => {
    // Immediately update UI state
    setDevices((devices) =>
      devices.map((device) => {
        if (device.deviceId === deviceId) {
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
                  switchLevel: { level: { value: on === "on" ? level : 0 } },
                },
              },
            },
          };
        }
        return device;
      })
    );

    // Fire the API call, no await to avoid UI blocking
    try {
      const payload = {
        devices: [deviceId],
        on: on === "on",
        password: localStorage.getItem("token"),
        level: level,
      };
      await axios.post(`${BASE_URL}/lights`, payload);
    } catch (error) {
      console.error("Error updating device state:", error);
    }
  };

  // Slider UI immediate update
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
                    switchLevel: { level: { value: Number(level) } },
                    switch: { switch: { value: Number(level) > 0 ? "on" : "off" } },
                  },
                },
              },
            }
          : device
      )
    );
  };

  // Fire brightness update in background without blocking UI
  const handleBrightnessChange = (deviceId, level) => {
    updateDeviceState(deviceId, "on", Number(level));
  };

  // Modal handlers
  const openSettings = (deviceId) => {
    const light = settings.lights?.[deviceId] || {};
    setModalDevice(deviceId);
    setModalLutronId(light.lutronId ?? "");
    setModalOwnerId(light.owner ?? "");
    setShowModal(true);
  };
  const saveSettings = () => {
    const updated = {
      ...settings.lights,
      [modalDevice]: {
        ...settings.lights[modalDevice],
        lutronId: modalLutronId,
        owner: modalOwnerId,
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

  // Categorize devices
  const lightsDevices = devices.filter(
    (d) =>
      d.name?.toLowerCase().startsWith("c2c") &&
      !d.name.toLowerCase().includes("switch")
  );
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
          <p style={styles.deviceCount}>{count} devices</p>
        </div>
      </div>
      <div style={styles.sectionHeaderRight}>
        <span style={styles.toggleText}>{isExpanded ? 'Hide' : 'Show'}</span>
        {isExpanded ? <FaChevronUp style={styles.chevron} /> : <FaChevronDown style={styles.chevron} />}
      </div>
    </div>
  );

  return (
    <div style={{fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'}}>
      <div style={styles.content}>
        <div style={styles.header}>
          {/* <h1 style={styles.mainTitle}>Smart Home</h1> */}
          {/* <p style={styles.subtitle}>Peter & Meghan</p> */}
        </div>

        {/* Lights Section */}
        <SectionHeader 
          title="Lights" 
          isExpanded={showLights} 
          onClick={() => setShowLights(!showLights)}
          icon={FaLightbulb}
          count={lightsDevices.length}
        />
        
        {showLights && (
          <div style={styles.deviceGrid}>
            {lightsDevices.map((device) => {
              const mainStatus = device.status?.components?.main || {};
              const isOn = mainStatus.switch?.switch?.value === "on" || (mainStatus.switchLevel?.level?.value > 0);
              const isOffline = mainStatus.healthCheck?.["DeviceWatch-DeviceStatus"]?.value === "offline";
              const brightness = mainStatus.switchLevel?.level?.value || 0;

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
                          onClick={() => updateDeviceState(device.deviceId, isOn ? "off" : "on", brightness || 100)}>
                            <FaLightbulb />
                          </div>
                          <div>
                            <h3 style={styles.deviceName}>{device.label}</h3>
                            <p style={styles.deviceStatus}>
                              {isOffline ? 'Offline' : isOn ? `${brightness}% brightness` : 'Off'}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* <button
                      className="power-button"
                        style={{
                          ...styles.powerButton,
                          ...(isOn ? styles.powerButtonOn : styles.powerButtonOff),
                          ...(isOffline ? styles.powerButtonDisabled : {})
                        }}
                        onClick={() => updateDeviceState(device.deviceId, isOn ? "off" : "on", brightness || 100)}
                        disabled={isOffline}
                      >
                        {isOn ? 'Turn Off' : 'Turn On'}
                      </button> */}

                      {mainStatus.switchLevel && (
                        <div style={styles.sliderContainer}>
                          <div style={styles.sliderHeader}>
                            <span style={styles.sliderLabel}>Brightness</span>
                            <span style={styles.sliderValue}>{brightness}%</span>
                          </div>
                          <input
                            type="range"
                            style={{
                              ...styles.slider,
                              background: `linear-gradient(to right, #fbbf24 0%, #fbbf24 ${brightness}%, #e5e7eb ${brightness}%, #e5e7eb 100%)`
                            }}
                            min="1"
                            max="100"
                            value={brightness}
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
            })}
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
                        
                        {/* {device.deviceTypeName &&
                          device.deviceTypeName.toLowerCase().includes("wash") &&
                          mainStatus["samsungce.detergentState"] &&
                          mainStatus["samsungce.detergentState"].remainingAmount?.value != null && (
                            <div style={styles.statusRow}>
                              <span style={styles.statusLabel}>Detergent</span>
                              <span style={styles.statusValue}>
                                {mainStatus["samsungce.detergentState"].remainingAmount.value}{" "}
                                {mainStatus["samsungce.detergentState"].remainingAmount.unit}
                              </span>
                            </div>
                          )
                          } */}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
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
                          onClick={() => updateDeviceState(device.deviceId, isOn ? "off" : "on", mainStatus.switchLevel?.level?.value || 100)}
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
                      <option key={u.id} value={u.id}>
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
    // marginBottom: '3rem'
  },
  mainTitle: {
    fontSize: '2.5rem',
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: '0.75rem',
    margin: 0
  },
  subtitle: {
    color: '#64748b',
    fontSize: '1.125rem',
    margin: 0
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
    transition: 'all 0.2s ease'
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
  toggleText: {
    color: '#9ca3af',
    fontWeight: '500'
  },
  chevron: {
    color: '#9ca3af'
  },
  deviceGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
    gap: '1.5rem',
    marginBottom: '3rem'
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
    opacity: '0',
    transition: 'all 0.2s ease',
    color: '#64748b'
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
  powerButton: {
    width: '100%',
    padding: '0.75rem 1rem',
    borderRadius: '12px',
    fontWeight: '500',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    fontSize: '1rem'
  },
  powerButtonOn: {
    background: '#fbbf24',
    color: 'white',
    boxShadow: '0 10px 25px rgba(251, 191, 36, 0.3)'
  },
  powerButtonOff: {
    background: '#f1f5f9',
    color: '#64748b'
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
 }
};

// Helper for appliances status formatting
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
       isToday ? "" :  eventTime.toLocaleDateString().substring(0, eventTime.toLocaleDateString().indexOf("/", 3))
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