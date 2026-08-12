import { useState, useEffect, useCallback, useRef } from "react";
import { getLutronDevices, upsertLutronDevice, deleteLutronDevice, controlLutronDevice } from "../api";

const POLL_MS = 5000; // faster than the SmartThings hooks — this is now the only live status source for lights
const PAUSE_MS = 2000;

// Local Lutron Caseta control, no SmartThings involved — see
// server/services/lutron.js. Same optimistic-update/pause-after-mutation
// pattern as useBoiler.js/useSound.js.
export function useLutron() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const pauseUntil = useRef(0);

  const fetchState = useCallback(async () => {
    try {
      const { data } = await getLutronDevices();
      if (data && Array.isArray(data.devices)) setState(data);
    } catch (e) {
      console.warn("useLutron:", e.message);
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

  const setDevice = useCallback(async (integrationId, on, level) => {
    pauseUntil.current = Date.now() + PAUSE_MS;
    setState(prev => prev && {
      ...prev,
      devices: prev.devices.map(d => d.integrationId === integrationId ? { ...d, on, level: on ? (level ?? d.level) : 0 } : d),
    });
    try {
      const { data } = await controlLutronDevice(integrationId, on, level);
      if (data?.ok && data.state) setState(data.state);
    } catch (e) {
      console.warn("Lutron control failed:", e.message);
    }
  }, []);

  // Slider drag — local only, no API call (matches useDevices.js's previewLevel)
  const previewLevel = useCallback((integrationId, level) => {
    setState(prev => prev && {
      ...prev,
      devices: prev.devices.map(d => d.integrationId === integrationId ? { ...d, on: Number(level) > 0, level: Number(level) } : d),
    });
  }, []);

  const saveDevice = useCallback(async (device) => {
    const { data } = await upsertLutronDevice(device);
    if (data?.ok && data.state) setState(data.state);
  }, []);

  const removeDevice = useCallback(async (integrationId) => {
    const { data } = await deleteLutronDevice(integrationId);
    if (data?.ok && data.state) setState(data.state);
  }, []);

  return { state, loading, setDevice, previewLevel, saveDevice, removeDevice, refetch: fetchState };
}
