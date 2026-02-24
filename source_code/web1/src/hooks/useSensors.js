import { useState, useEffect, useCallback } from "react";
import { getAllSensors, getGarageStatus, triggerGarage } from "../api";

const SENSOR_POLL_MS = 15000; // sensors change slowly, poll every 15s

export function useSensors() {
  const [sensors, setSensors]     = useState({});
  const [garage,  setGarage]      = useState(null);
  const [loading, setLoading]     = useState(true);
  const [triggerBusy, setTriggerBusy] = useState(false);
  const [triggerMsg,  setTriggerMsg]  = useState("");

  const fetchAll = useCallback(async () => {
    try {
      const [sensorsRes, garageRes] = await Promise.all([
        getAllSensors(),
        getGarageStatus(),
      ]);
      setSensors(sensorsRes.data);
      setGarage(garageRes.data);
    } catch (e) {
      console.error("useSensors:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(fetchAll, SENSOR_POLL_MS);
    return () => clearInterval(id);
  }, [fetchAll]);

  const triggerGarageDoor = useCallback(async () => {
    setTriggerBusy(true);
    setTriggerMsg("");
    try {
      const { data } = await triggerGarage();
      if (data.ok) {
        setTriggerMsg("Signal sent!");
        // Re-fetch garage status after a brief delay
        setTimeout(fetchAll, 1500);
      } else {
        setTriggerMsg(data.reason || "Failed");
      }
    } catch (e) {
      setTriggerMsg("Error communicating with server");
    } finally {
      setTriggerBusy(false);
      setTimeout(() => setTriggerMsg(""), 4000);
    }
  }, [fetchAll]);

  return { sensors, garage, loading, triggerGarageDoor, triggerBusy, triggerMsg, refetch: fetchAll };
}
