import api from "./axios";

const token = () => localStorage.getItem("token");

// ── Auth ─────────────────────────────────────────────────────────────────────
export const logOrReg   = (email, password, device) => api.post("/log-or-reg", { email, password, device });
export const confirmDevice = (email, code) => api.post("/confirmDevice", { email, code });
export const resetPassword = (email) => api.post("/resetPassword", { email });
export const setNewPassword = (resetCode, pass, email) => api.post("/setNewPassword", { resetCode, pass, email });
export const getUser    = (user_id) => api.post("/user", { user_id });

// ── Settings ─────────────────────────────────────────────────────────────────
export const getSettings    = () => api.get("/settings");
export const putSetting     = (key, value) => api.post("/settings", { key, value });
export const getUsers       = () => api.get("/users");

// ── Devices / Lights (SmartThings — smart plugs / appliances only now) ───────
export const listDevices    = () => api.get("/list-devices");
export const controlLights  = (devices, on, level) =>
  api.post("/lights", { devices, on, level, password: token() });

// ── Lutron Caseta (local, no SmartThings — actual light/fan switches) ───────
export const getLutronDevices   = () => api.get("/lutron/devices");
export const upsertLutronDevice = (device) => api.post("/lutron/devices", device);
export const deleteLutronDevice = (integrationId) => api.delete(`/lutron/devices/${integrationId}`);
export const controlLutronDevice = (integrationId, on, level) =>
  api.post(`/lutron/devices/${integrationId}/control`, { on, level });

// ── Presence ─────────────────────────────────────────────────────────────────
export const arrive = (who) => api.post("/arrive", { who, password: token() });
export const leave  = (who) => api.post("/leave",  { who, password: token() });

// ── Car ──────────────────────────────────────────────────────────────────────
export const startCar    = () => api.post("/car/start",  { password: token() });
export const lockCar     = () => api.post("/car/lock",   { password: token() });
export const unlockCar   = () => api.post("/car/unlock", { password: token() });
export const getCarStatus = () => api.get("/car/status");

// ── Sensors ──────────────────────────────────────────────────────────────────
export const getAllSensors = () => api.get("/sensors");
export const getSensor    = (name) => api.get(`/sensors/${name}`);

// ── Thermostat (4-zone air handler) ─────────────────────────────────────────
export const getThermostat     = () => api.get("/thermostat");
export const setThermostatZone = (id, body) => api.post(`/thermostat/zone/${id}`, body);
export const setZoneSchedule   = (id, schedule) => api.post(`/thermostat/zone/${id}/schedule`, { schedule });
// Restricted server-side to pete.buo@gmail.com — needs the logged-in
// user's token so the backend can tell who's asking, see thermostat.js.
export const setZoneBalance    = (id, balancePercent) => api.post(`/thermostat/zone/${id}/balance`, { balancePercent, password: token() });
export const setThermostatMode = (mode) => api.post("/thermostat/mode", { mode });
export const setThermostatRates = (rates) => api.post("/thermostat/rates", rates);
export const setThermostatAvailability = (source, available) => api.post("/thermostat/availability", { source, available });
export const setGasSeasonThreshold = (gasSeasonThresholdF) => api.post("/thermostat/gas-season-threshold", { gasSeasonThresholdF });

// ── Gas boiler (separate 3-zone hydronic system) ────────────────────────────
export const getBoiler         = () => api.get("/thermostat/boiler");
export const setBoilerZone     = (id, body) => api.post(`/thermostat/boiler/zone/${id}`, body);
export const setBoilerZoneSchedule = (id, schedule) => api.post(`/thermostat/boiler/zone/${id}/schedule`, { schedule });

// ── Maintenance ──────────────────────────────────────────────────────────────
export const getMaintenance        = () => api.get("/maintenance");
export const addMaintenanceTask    = (label, frequency) => api.post("/maintenance/task", { label, frequency });
export const updateMaintenanceTask = (id, body) => api.patch(`/maintenance/task/${id}`, body);
export const deleteMaintenanceTask = (id) => api.delete(`/maintenance/task/${id}`);
export const completeMaintenanceTask = (id) => api.post(`/maintenance/task/${id}/complete`);

// ── Console ──────────────────────────────────────────────────────────────────
export const getConsoleNodes    = () => api.get("/console/nodes");
export const configureConsoleNode = (uniqueId, body) => api.post(`/console/nodes/${uniqueId}/configure`, body);
export const deleteConsoleNode  = (uniqueId) => api.delete(`/console/nodes/${uniqueId}`);
export const getMonitorZones    = () => api.get("/console/monitor-zones");
export const getRecentLogs      = () => api.get("/console/logs/recent", { headers: { Authorization: `Bearer ${token()}` } });
export const logsStreamUrl      = () => `${api.defaults.baseURL}/console/logs/stream?token=${encodeURIComponent(token() || "")}`;
export const getGpioMap         = () => api.get("/console/gpio-map");
export const upsertGpioPin      = (pin) => api.post("/console/gpio-map", pin);
export const deleteGpioPin      = (pin) => api.delete(`/console/gpio-map/${pin}`);
export const getRelayMap        = () => api.get("/console/relay-map");
export const upsertRelay        = (relay) => api.post("/console/relay-map", relay);
export const deleteRelay        = (address, channel) => api.delete(`/console/relay-map/${address}/${channel}`);
export const getConsoleFaults   = () => api.get("/console/faults");

// ── Sound (software scaffold — see server/services/sound.js) ───────────────
export const getSound         = () => api.get("/sound");
export const setSoundZone     = (id, body) => api.post(`/sound/zone/${id}`, body);
export const toggleSoundPreset = (locationId) => api.post(`/sound/preset/${locationId}`);

// ── Finance ──────────────────────────────────────────────────────────────────
export const getMonthlyStats  = () => api.get("/monthly-stats");
export const getTransactions  = (params) => api.get("/transactions", { params });
export const getTransactionsByCategory = (cat) => api.get(`/transactions/${cat}`);

// ── Cameras ──────────────────────────────────────────────────────────────────
export const getCameras         = ()        => api.get("/cameras");
export const addCamera          = (data)    => api.post("/cameras", data, { headers: { Authorization: `Bearer ${token()}` } });
export const updateCamera       = (id, data)=> api.put(`/cameras/${id}`, data, { headers: { Authorization: `Bearer ${token()}` } });
export const deleteCamera       = (id)      => api.delete(`/cameras/${id}`, { headers: { Authorization: `Bearer ${token()}` } });
export const getCameraSnapshot  = (id)      => api.get(`/cameras/${id}/snapshot`);
export const startCameraRecord  = (id)      => api.post(`/cameras/${id}/record/start`, {}, { headers: { Authorization: `Bearer ${token()}` } });
export const stopCameraRecord   = (id)      => api.post(`/cameras/${id}/record/stop`,  {}, { headers: { Authorization: `Bearer ${token()}` } });
export const getCameraRecordings= (id, params) => api.get(`/cameras/${id}/recordings`, { params });
export const streamRecordingUrl = (recId)   => `${api.defaults.baseURL}/cameras/recordings/${recId}/stream`;
export const deleteRecording    = (recId)   => api.delete(`/cameras/recordings/${recId}`, { headers: { Authorization: `Bearer ${token()}` } });
export const getCameraStorage   = (id)      => api.get(`/cameras/${id}/storage`);
