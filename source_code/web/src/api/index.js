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

// ── Devices / Lights ─────────────────────────────────────────────────────────
export const listDevices    = () => api.get("/list-devices");
export const controlLights  = (devices, on, level) =>
  api.post("/lights", { devices, on, level, password: token() });

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

// ── Thermostat ───────────────────────────────────────────────────────────────
export const getThermostat     = () => api.get("/thermostat");
export const setThermostatZone = (id, body) => api.post(`/thermostat/zone/${id}`, body);
export const setZoneSchedule   = (id, schedule) => api.post(`/thermostat/zone/${id}/schedule`, { schedule });
export const setThermostatMode = (mode) => api.post("/thermostat/mode", { mode });
export const setThermostatRates = (rates) => api.post("/thermostat/rates", rates);
export const setThermostatAvailability = (source, available) => api.post("/thermostat/availability", { source, available });

// ── Maintenance ──────────────────────────────────────────────────────────────
export const getMaintenance        = () => api.get("/maintenance");
export const addMaintenanceTask    = (label, frequency) => api.post("/maintenance/task", { label, frequency });
export const updateMaintenanceTask = (id, body) => api.patch(`/maintenance/task/${id}`, body);
export const deleteMaintenanceTask = (id) => api.delete(`/maintenance/task/${id}`);
export const completeMaintenanceTask = (id) => api.post(`/maintenance/task/${id}/complete`);

// ── Garage ───────────────────────────────────────────────────────────────────
export const getGarageStatus  = () => api.get("/garage/status");
export const triggerGarage    = (duration) =>
  api.post("/garage/trigger", { password: token(), duration });

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
