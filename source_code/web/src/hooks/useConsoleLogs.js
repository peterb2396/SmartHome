import { useState, useEffect, useRef } from "react";
import { getRecentLogs, logsStreamUrl } from "../api";

const MAX_LINES = 500;

export function useConsoleLogs() {
  const [lines, setLines] = useState([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data } = await getRecentLogs();
        if (!cancelled) setLines(data.lines || []);
      } catch (e) {
        console.error("useConsoleLogs: couldn't load recent logs", e);
      }
    })();

    const es = new EventSource(logsStreamUrl());
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (evt) => {
      try {
        const entry = JSON.parse(evt.data);
        setLines(prev => {
          const next = [...prev, entry];
          return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
        });
      } catch {}
    };

    return () => { cancelled = true; es.close(); };
  }, []);

  return { lines, connected };
}
