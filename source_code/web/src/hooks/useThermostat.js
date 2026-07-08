import { useState, useEffect, useCallback, useRef } from "react";
import {
  getThermostat, setThermostatZone, setZoneSchedule as apiSetZoneSchedule,
  setThermostatMode, setThermostatRates, setThermostatAvailability,
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

// Same "electric is a manual backup, not a cost competitor" priority the
// backend uses when it doesn't have cost data yet to pick a replacement from.
const FALLBACK_PRIORITY = ["gas", "air", "electric"];

function defaultState() {
  return {
    mode: "auto", activeSource: "gas", lastDecision: null,
    rates: { gasPricePerTherm: 1.5, elecPricePerKwh: 0.15, gasAfue: 0.85 },
    available: { gas: true, electric: true, air: true },
    safetyRange: { min: 60, max: 75 },
    crossover: null,
    costComparison: null,
    zones: ZONE_DEFAULTS.map(({ id, label }) => ({
      id, label, on: true, target: 68, schedule: [], overridden: false,
      currentTemp: null, updatedAt: null, sensorOk: false,
      calling: false, coolCalling: false, safety: "normal", windowOpen: false,
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

// A 200 with an unexpected shape (wrong route, proxy oddity, etc.) is just
// as dangerous as a network error — callers should treat it the same way.
function isValidState(data) {
  return !!data && Array.isArray(data.zones);
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

  const fetchState = useCallback(async () => {
    try {
      const { data } = await getThermostat();
      if (!isValidState(data)) throw new Error("Unexpected response from thermostat service");
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

  // Runs a mutation: applies an optimistic update immediately, then either
  // adopts the server's confirmed state (on success) or just leaves the
  // optimistic state in place (on failure/offline) — it does NOT re-fetch
  // afterward. That extra round-trip used to race the optimistic update:
  // occasionally the GET would land with slightly stale data and the UI
  // would visibly flicker back to the old value before "catching up" a
  // moment later. The mutation response already carries the fresh state,
  // so there's nothing left to reconcile.
  const runMutation = useCallback(async (optimisticUpdater, apiCall) => {
    pausePolling();
    applyState(optimisticUpdater);
    try {
      const { data } = await apiCall();
      if (data?.ok && isValidState(data.state)) {
        applyState(data.state);
        setOffline(false);
        setError(null);
      }
    } catch (e) {
      console.warn("thermostat mutation: backend unreachable, kept local change:", e.message);
      setError(e.message || "Unable to reach the thermostat service");
      setOffline(true);
    }
  }, [applyState, pausePolling]);

  const setTarget = useCallback((zoneId, target) => runMutation(
    prev => prev && { ...prev, zones: prev.zones.map(z => z.id === zoneId ? { ...z, target, overridden: true } : z) },
    () => setThermostatZone(zoneId, { target })
  ), [runMutation]);

  const toggleZone = useCallback((zoneId, on) => runMutation(
    prev => prev && { ...prev, zones: prev.zones.map(z => z.id === zoneId ? { ...z, on } : z) },
    () => setThermostatZone(zoneId, { on })
  ), [runMutation]);

  const saveSchedule = useCallback((zoneId, schedule) => runMutation(
    prev => prev && { ...prev, zones: prev.zones.map(z => z.id === zoneId ? { ...z, schedule } : z) },
    () => apiSetZoneSchedule(zoneId, schedule)
  ), [runMutation]);

  const setMode = useCallback((mode) => runMutation(
    prev => {
      if (!prev) return prev;
      if (mode !== "auto" && prev.available?.[mode] === false) {
        console.warn(`setMode: ${mode} is marked as being serviced, ignoring`);
        return prev;
      }
      return { ...prev, mode, activeSource: mode === "auto" ? prev.activeSource : mode };
    },
    () => setThermostatMode(mode)
  ), [runMutation]);

  const setRates = useCallback((rates) => runMutation(
    prev => prev && { ...prev, rates: { ...prev.rates, ...rates } },
    () => setThermostatRates(rates)
  ), [runMutation]);

  // Mark a heat source as being serviced / back in service. Mirrors the
  // backend's immediate-failover behavior so local-only mode (backend
  // unreachable) behaves the same as talking to the real server.
  const setAvailability = useCallback((source, available) => runMutation(
    prev => {
      if (!prev) return prev;
      const nextAvailable = { ...prev.available, [source]: available };
      let next = { ...prev, available: nextAvailable };
      if (!available && (prev.mode === source || prev.activeSource === source)) {
        const costs = prev.lastDecision?.costs;
        const eligible = Object.keys(nextAvailable).filter(s => nextAvailable[s] !== false);
        const replacement = costs
          ? eligible.sort((a, b) => costs[a] - costs[b])[0]
          : FALLBACK_PRIORITY.find(s => eligible.includes(s));
        next = { ...next, mode: "auto", activeSource: replacement ?? prev.activeSource };
      }
      return next;
    },
    () => setThermostatAvailability(source, available)
  ), [runMutation]);

  return {
    state, loading, error, offline,
    setTarget, toggleZone, saveSchedule, setMode, setRates, setAvailability,
    refetch: fetchState,
  };
}
