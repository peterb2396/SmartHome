import { useState, useEffect, useCallback, useRef } from "react";
import { listDevices, controlLights } from "../api";

const POLL_INTERVAL = 3000;

export function useDevices() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pauseUntil, setPauseUntil] = useState(0);
  const controller = useRef(null);

  const fetchDevices = useCallback(async () => {
    if (Date.now() < pauseUntil) return;
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    try {
      const { data } = await listDevices({ signal: ctrl.signal });
      setDevices(data);
    } catch (e) {
      if (e.name !== "CanceledError" && e.name !== "AbortError") console.error(e);
    } finally {
      setLoading(false);
      controller.current = null;
    }
  }, [pauseUntil]);

  const pausePolling = useCallback(() => {
    controller.current?.abort();
    setPauseUntil(Date.now() + 2000);
  }, []);

  useEffect(() => {
    fetchDevices();
    const id = setInterval(() => {
      if (Date.now() >= pauseUntil) fetchDevices();
    }, POLL_INTERVAL);
    return () => { clearInterval(id); controller.current?.abort(); };
  }, [fetchDevices, pauseUntil]);

  // Optimistic state update + API call
  const setDeviceState = useCallback(async (deviceId, on, level = null) => {
    pausePolling();
    setDevices(prev => prev.map(d => {
      if (d.deviceId !== deviceId) return d;
      const isFan  = d.name?.toLowerCase().includes("fan");
      const isPlug = d.name?.toLowerCase().includes("c2c-switch");
      const main   = d.status?.components?.main || {};
      return {
        ...d,
        status: {
          ...d.status,
          components: {
            ...d.status?.components,
            main: {
              ...main,
              switch: { switch: { value: on ? "on" : "off" } },
              ...(!isPlug
                ? isFan
                  ? { fanSpeed: { fanSpeed: { value: on ? level : 0 } } }
                  : { switchLevel: { level: { value: on ? level : 0 } } }
                : {}),
            },
          },
        },
      };
    }));
    try {
      await controlLights([deviceId], on, level);
    } catch (e) {
      console.error("setDeviceState:", e);
    }
  }, [pausePolling]);

  // Slider drag — local only, no API call
  const previewLevel = useCallback((deviceId, level) => {
    setDevices(prev => prev.map(d => {
      if (d.deviceId !== deviceId) return d;
      const isFan = d.name?.toLowerCase().includes("fan");
      const main  = d.status?.components?.main || {};
      return {
        ...d,
        status: {
          ...d.status,
          components: {
            ...d.status?.components,
            main: {
              ...main,
              switch: { switch: { value: Number(level) > 0 ? "on" : "off" } },
              ...(isFan
                ? { fanSpeed: { fanSpeed: { value: Number(level) } } }
                : { switchLevel: { level: { value: Number(level) } } }),
            },
          },
        },
      };
    }));
  }, []);

  return { devices, loading, setDeviceState, previewLevel };
}
