import { useState, useEffect, useCallback } from "react";
import { getAllSensors, getCarStatus } from "../api";

const SENSOR_POLL_MS = 15000;

export function useSensors() {
  const [sensors,   setSensors]   = useState({});
  const [carStatus, setCarStatus] = useState(null);  // { value: "on"|"off"|"unknown", updatedAt }
  const [loading,   setLoading]   = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [sensorsRes, carRes] = await Promise.all([
        getAllSensors(),
        getCarStatus(),
      ]);
      setSensors(sensorsRes.data);
      setCarStatus(carRes.data);
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

  return { sensors, carStatus, loading, refetch: fetchAll };
}
