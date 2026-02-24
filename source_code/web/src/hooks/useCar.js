import { useState, useCallback } from "react";
import { startCar, lockCar, unlockCar } from "../api";

function useCarAction(apiFn) {
  const [busy,    setBusy]    = useState(false);
  const [success, setSuccess] = useState(false);
  const [message, setMessage] = useState("");

  const execute = useCallback(async () => {
    setBusy(true);
    setSuccess(false);
    setMessage("");
    try {
      const { data } = await apiFn();
      setSuccess(!!data.ok);
      setMessage(data.message || (data.ok ? "Done!" : "Failed"));
      console.log(data);
    } catch {
      setMessage("Could not communicate with car");
    } finally {
      setBusy(false);
      setTimeout(() => { setSuccess(false); setMessage(""); }, 5000);
    }
  }, [apiFn]);

  return { busy, success, message, execute };
}

export function useCar() {
  const start  = useCarAction(startCar);
  const lock   = useCarAction(lockCar);
  const unlock = useCarAction(unlockCar);
  return { start, lock, unlock };
}
