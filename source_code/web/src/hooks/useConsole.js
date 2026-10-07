import { useState, useEffect, useCallback } from "react";
import { useThermostat } from "./useThermostat";
import { useDevices } from "./useDevices";
import { getConsoleNodes, getMonitorZones, getCameras, getConsoleFaults, getSound } from "../api";

const POLL_MS = 15000;

// Combines the app's existing polling hooks/endpoints into one dashboard
// view for the Console page. Faults come from the server (GET
// /console/faults) rather than being re-derived here — that's the same
// list the physical fault LED blinks off, so there's one source of truth
// instead of two copies of the same logic drifting apart.
export function useConsole() {
  const thermostat = useThermostat();
  const { devices, loading: devicesLoading } = useDevices();
  const [nodes, setNodes] = useState({ configured: [], pending: [] });
  const [monitorZones, setMonitorZones] = useState([]);
  const [soundZones, setSoundZones] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [faults, setFaults] = useState([]);
  const [extrasLoading, setExtrasLoading] = useState(true);

  const fetchExtras = useCallback(async () => {
    try {
      const [nodesRes, zonesRes, camerasRes, faultsRes, soundRes] = await Promise.all([
        getConsoleNodes(), getMonitorZones(), getCameras(), getConsoleFaults(), getSound(),
      ]);
      setNodes(nodesRes.data);
      setMonitorZones(zonesRes.data);
      setCameras(camerasRes.data);
      setFaults(faultsRes.data.faults);
      setSoundZones((soundRes.data.zones || []).map(z => ({ id: z.id, label: z.label })));
    } catch (e) {
      console.error("useConsole:", e);
    } finally {
      setExtrasLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchExtras();
    const id = setInterval(fetchExtras, POLL_MS);
    return () => clearInterval(id);
  }, [fetchExtras]);

  const zones = thermostat.state?.zones ?? [];

  const lightDevices = devices.filter(d => d.name?.toLowerCase().startsWith("c2c") && !d.name.toLowerCase().includes("switch"));
  const lightsOn = lightDevices.filter(d => {
    const main = d.status?.components?.main || {};
    return main.switch?.switch?.value === "on" || (main.switchLevel?.level?.value ?? 0) > 0;
  }).length;

  return {
    loading: thermostat.loading || devicesLoading || extrasLoading,
    faults,
    zones,
    monitorZones,
    soundZones,
    lights: { on: lightsOn, total: lightDevices.length },
    nodes,
    cameras,
    refetch: fetchExtras,
  };
}
