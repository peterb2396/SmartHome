import { useState, useEffect, useCallback } from "react";
import { getMonitorZones } from "../api";

const POLL_MS = 15000;

// Read-only basement/attic temp+humidity — same data Console's monitor-zone
// tiles show, polled independently here so the Thermostat page doesn't have
// to pull in useConsole's heavier bundle (nodes/cameras/faults) just for
// this.
export function useMonitorZones() {
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchZones = useCallback(async () => {
    try {
      const { data } = await getMonitorZones();
      if (Array.isArray(data)) setZones(data);
    } catch (e) {
      console.warn("useMonitorZones:", e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchZones();
    const id = setInterval(fetchZones, POLL_MS);
    return () => clearInterval(id);
  }, [fetchZones]);

  return { zones, loading };
}
