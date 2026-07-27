import { useState, useEffect, useCallback, useRef } from "react";
import { getBoiler, setBoilerZone, setBoilerZoneSchedule } from "../api";

const POLL_MS = 15000;
const PAUSE_MS = 2000;

// The separate 3-zone gas boiler system — Great Room / Downstairs /
// Upstairs, a distinct zone layout from the air handler's 4 zones (see
// thermostat.js's getActiveSystem()). Deliberately simpler than
// useThermostat.js: no offline localStorage fallback, since this is
// secondary system state the Thermostat page only renders while it's
// actually the active system.
export function useBoiler() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const pauseUntil = useRef(0);

  const fetchState = useCallback(async () => {
    try {
      const { data } = await getBoiler();
      if (data && Array.isArray(data.zones)) setState(data);
    } catch (e) {
      console.warn("useBoiler:", e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();
    const id = setInterval(() => {
      if (Date.now() >= pauseUntil.current) fetchState();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [fetchState]);

  const runMutation = useCallback(async (optimisticUpdater, apiCall) => {
    pauseUntil.current = Date.now() + PAUSE_MS;
    setState(prev => prev && optimisticUpdater(prev));
    try {
      const { data } = await apiCall();
      if (data?.ok && data.state) setState(data.state);
    } catch (e) {
      console.warn("boiler mutation failed:", e.message);
    }
  }, []);

  const setTarget = useCallback((zoneId, target) => runMutation(
    prev => ({ ...prev, zones: prev.zones.map(z => z.id === zoneId ? { ...z, target, overridden: true } : z) }),
    () => setBoilerZone(zoneId, { target })
  ), [runMutation]);

  const toggleZone = useCallback((zoneId, on) => runMutation(
    prev => ({ ...prev, zones: prev.zones.map(z => z.id === zoneId ? { ...z, on } : z) }),
    () => setBoilerZone(zoneId, { on })
  ), [runMutation]);

  const saveSchedule = useCallback((zoneId, schedule) => runMutation(
    prev => ({ ...prev, zones: prev.zones.map(z => z.id === zoneId ? { ...z, schedule } : z) }),
    () => setBoilerZoneSchedule(zoneId, schedule)
  ), [runMutation]);

  return { state, loading, setTarget, toggleZone, saveSchedule, refetch: fetchState };
}
