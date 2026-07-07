import { useState, useEffect, useCallback, useRef } from "react";
import {
  getThermostat, setThermostatZone, setZoneSchedule as apiSetZoneSchedule,
  setThermostatMode, setThermostatRates,
} from "../api";

const POLL_MS = 15000;
const PAUSE_MS = 2000;

// Used only while the /thermostat backend route is unreachable (e.g. not
// deployed yet) — lets zones/schedules/mode be configured locally so none
// of that setup work is lost, and it's picked back up once the real
// backend responds.
const LOCAL_KEY = "thermostat-local-state-v1";
const ZONE_DEFAULTS = [
  { id: "primary-suite", label: "Primary Suite" },
  { id: "upstairs",      label: "Upstairs" },
  { id: "office",        label: "Office" },
  { id: "downstairs",    label: "Downstairs" },
];

function defaultState() {
  return {
    mode: "auto", activeSource: "gas", lastDecision: null,
    rates: { gasPricePerTherm: 1.5, elecPricePerKwh: 0.15, gasAfue: 0.85 },
    zones: ZONE_DEFAULTS.map(({ id, label }) => ({
      id, label, on: false, target: 68, schedule: [],
      currentTemp: null, updatedAt: null, sensorOk: false, calling: false, windowOpen: false,
    })),
  };
}

function loadLocalState() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn("useThermostat: couldn't read local cache", e);
  }
  return defaultState();
}

function saveLocalState(state) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(state)); } catch {}
}

export function useThermostat() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [offline, setOffline] = useState(false);
  const pauseUntil = useRef(0);

  // Sets state AND keeps the local cache in sync, so edits made while the
  // backend is unreachable survive a refresh instead of vanishing. Accepts
  // either a value or an updater fn (prev => next), same as setState.
  const applyState = useCallback((updater) => {
    setState(prev => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (next) saveLocalState(next);
      return next;
    });
  }, []);

  // Unguarded — always hits the server. Used for the initial load and for
  // reconciling right after a mutation (we WANT fresh data at that point).
  const fetchState = useCallback(async () => {
    try {
      const { data } = await getThermostat();
      applyState(data);
      setOffline(false);
      setError(null);
    } catch (e) {
      console.error("useThermostat:", e);
      setError(e.message || "Unable to reach the thermostat service");
      setOffline(true);
      // Never leave the page with nothing to show — fall back to whatever
      // was last saved locally (or sane defaults) so zones/schedules/mode
      // are still fully visible and editable.
      setState(prev => {
        if (prev) return prev;
        const local = loadLocalState();
        saveLocalState(local);
        return local;
      });
    } finally {
      setLoading(false);
    }
  }, [applyState]);

  const pausePolling = useCallback(() => {
    pauseUntil.current = Date.now() + PAUSE_MS;
  }, []);

  // Guarded — the periodic poll skips while an optimistic update is settling,
  // so it doesn't stomp the just-applied local state before the mutation lands.
  useEffect(() => {
    fetchState();
    const id = setInterval(() => {
      if (Date.now() >= pauseUntil.current) fetchState();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [fetchState]);

  const toggleZone = useCallback(async (zoneId, on) => {
    pausePolling();
    applyState(prev => prev && { ...prev, zones: prev.zones.map(z => z.id === zoneId ? { ...z, on } : z) });
    try {
      await setThermostatZone(zoneId, { on });
    } catch (e) {
      console.warn("toggleZone: backend unreachable, kept local change:", e.message);
    } finally {
      fetchState();
    }
  }, [applyState, pausePolling, fetchState]);

  const setTarget = useCallback(async (zoneId, target) => {
    pausePolling();
    applyState(prev => prev && { ...prev, zones: prev.zones.map(z => z.id === zoneId ? { ...z, target } : z) });
    try {
      await setThermostatZone(zoneId, { target });
    } catch (e) {
      console.warn("setTarget: backend unreachable, kept local change:", e.message);
    } finally {
      fetchState();
    }
  }, [applyState, pausePolling, fetchState]);

  const saveSchedule = useCallback(async (zoneId, schedule) => {
    pausePolling();
    applyState(prev => prev && { ...prev, zones: prev.zones.map(z => z.id === zoneId ? { ...z, schedule } : z) });
    try {
      await apiSetZoneSchedule(zoneId, schedule);
    } catch (e) {
      console.warn("saveSchedule: backend unreachable, kept local change:", e.message);
    } finally {
      fetchState();
    }
  }, [applyState, pausePolling, fetchState]);

  const setMode = useCallback(async (mode) => {
    pausePolling();
    applyState(prev => prev && { ...prev, mode, activeSource: mode === "auto" ? prev.activeSource : mode });
    try {
      await setThermostatMode(mode);
    } catch (e) {
      console.warn("setMode: backend unreachable, kept local change:", e.message);
    } finally {
      fetchState();
    }
  }, [applyState, pausePolling, fetchState]);

  const setRates = useCallback(async (rates) => {
    applyState(prev => prev && { ...prev, rates: { ...prev.rates, ...rates } });
    try {
      await setThermostatRates(rates);
    } catch (e) {
      console.warn("setRates: backend unreachable, kept local change:", e.message);
    } finally {
      fetchState();
    }
  }, [applyState, fetchState]);

  return {
    state, loading, error, offline,
    toggleZone, setTarget, saveSchedule, setMode, setRates,
    refetch: fetchState,
  };
}
