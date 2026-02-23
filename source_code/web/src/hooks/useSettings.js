import { useState, useEffect, useCallback } from "react";
import { getSettings, putSetting, getUsers } from "../api";

export function useSettings() {
  const [settings, setSettings] = useState({});
  const [users, setUsers] = useState([]);

  const fetchSettings = useCallback(async () => {
    try {
      const { data } = await getSettings();
      setSettings(data);
    } catch (e) {
      console.error("useSettings:", e);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const { data } = await getUsers();
      setUsers(data);
    } catch (e) {
      console.error("useUsers:", e);
    }
  }, []);

  const updateSetting = useCallback(async (key, value) => {
    try {
      await putSetting(key, value);
      setSettings(prev => ({ ...prev, [key]: value }));
    } catch (e) {
      console.error("updateSetting:", e);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    fetchUsers();
  }, [fetchSettings, fetchUsers]);

  return { settings, users, fetchSettings, updateSetting };
}
