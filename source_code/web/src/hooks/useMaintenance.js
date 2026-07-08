import { useState, useEffect, useCallback, useRef } from "react";
import {
  getMaintenance, addMaintenanceTask, updateMaintenanceTask,
  deleteMaintenanceTask, completeMaintenanceTask,
} from "../api";

const POLL_MS = 30000;
const PAUSE_MS = 2000;

function isValidState(data) {
  return !!data && Array.isArray(data.tasks);
}

export function useMaintenance() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const pauseUntil = useRef(0);

  const fetchState = useCallback(async () => {
    try {
      const { data } = await getMaintenance();
      if (!isValidState(data)) throw new Error("Unexpected response from maintenance service");
      setState(data);
      setError(null);
    } catch (e) {
      console.error("useMaintenance:", e);
      setError(e.message || "Unable to reach the maintenance service");
    } finally {
      setLoading(false);
    }
  }, []);

  const pausePolling = useCallback(() => { pauseUntil.current = Date.now() + PAUSE_MS; }, []);

  useEffect(() => {
    fetchState();
    const id = setInterval(() => {
      if (Date.now() >= pauseUntil.current) fetchState();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [fetchState]);

  // No optimistic update here — tasks get server-generated ids, so there's
  // nothing sensible to render locally before the response comes back for
  // an add; the round-trip is fast enough that it isn't worth faking.
  const runMutation = useCallback(async (apiCall) => {
    pausePolling();
    try {
      const { data } = await apiCall();
      if (data?.ok && isValidState(data.state)) {
        setState(data.state);
        setError(null);
      }
    } catch (e) {
      console.error("maintenance mutation failed:", e);
      setError(e.message || "Unable to reach the maintenance service");
    }
  }, [pausePolling]);

  const addTask      = useCallback((label, frequency) => runMutation(() => addMaintenanceTask(label, frequency)), [runMutation]);
  const editTask      = useCallback((id, body) => runMutation(() => updateMaintenanceTask(id, body)), [runMutation]);
  const removeTask    = useCallback((id) => runMutation(() => deleteMaintenanceTask(id)), [runMutation]);
  const completeTask  = useCallback((id) => runMutation(() => completeMaintenanceTask(id)), [runMutation]);

  return { state, loading, error, addTask, editTask, removeTask, completeTask, refetch: fetchState };
}
