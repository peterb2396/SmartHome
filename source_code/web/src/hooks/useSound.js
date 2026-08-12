import { useState, useEffect, useCallback, useRef } from "react";
import { getSound, setSoundZone } from "../api";

const POLL_MS = 15000;
const PAUSE_MS = 2000;

// Same optimistic-update/pause-after-mutation pattern as useBoiler.js, so
// a slider drag doesn't visibly snap back before the next poll catches up.
// activeSource is hardware-reported (see server/services/sound.js) — this
// hook never sets it, only reads whatever the last poll reported.
export function useSound() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const pauseUntil = useRef(0);

  const fetchState = useCallback(async () => {
    try {
      const { data } = await getSound();
      if (data && Array.isArray(data.zones)) setState(data);
    } catch (e) {
      console.warn("useSound:", e.message);
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

  const runMutation = useCallback(async (optimisticUpdater, body) => {
    pauseUntil.current = Date.now() + PAUSE_MS;
    setState(prev => prev && optimisticUpdater(prev));
    try {
      const { data } = await setSoundZone(body.zoneId, body);
      if (data?.ok && data.state) setState(data.state);
    } catch (e) {
      console.warn("sound mutation failed:", e.message);
    }
  }, []);

  const setVolume = useCallback((zoneId, volumePercent) => runMutation(
    prev => ({ ...prev, zones: prev.zones.map(z => z.id === zoneId ? { ...z, volumePercent } : z) }),
    { zoneId, volumePercent }
  ), [runMutation]);

  const setEnabled = useCallback((zoneId, spotifyEnabled) => runMutation(
    prev => ({ ...prev, zones: prev.zones.map(z => z.id === zoneId ? { ...z, spotifyEnabled } : z) }),
    { zoneId, spotifyEnabled }
  ), [runMutation]);

  return { state, loading, setVolume, setEnabled, refetch: fetchState };
}
