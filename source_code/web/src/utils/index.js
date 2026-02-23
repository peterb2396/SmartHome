export const formatCurrency = (value) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

export const formatDate = (dateString) =>
  new Date(dateString).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });

export const formatTime = (isoString) => {
  if (!isoString) return "—";
  return new Date(isoString).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

export const formatRelativeTime = (isoString) => {
  if (!isoString) return "never";
  const diff = Date.now() - new Date(isoString).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60)  return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
};

export function formatOperatingState(operatingStateObj) {
  if (!operatingStateObj?.operatingState) return null;
  const { value, timestamp } = operatingStateObj.operatingState;
  const lower = value.toLowerCase();

  if (lower === "finished" || lower === "ready") {
    if (timestamp) {
      const t = new Date(timestamp.value || timestamp);
      const isToday = t.toDateString() === new Date().toDateString();
      const timeStr = t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return `Finished ${isToday ? "" : t.toLocaleDateString().substring(0, t.toLocaleDateString().indexOf("/", 3))} @ ${timeStr}`;
    }
    return "Finished";
  }
  if (lower === "running") {
    if (operatingStateObj.remainingTimeStr?.value) {
      return `${operatingStateObj.washerJobState?.value || operatingStateObj.dryerJobState?.value || "Running"} – ${operatingStateObj.remainingTimeStr.value} remaining`;
    }
    return "Running";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// Classify a sensor name into a category
export function getSensorCategory(name) {
  if (name.startsWith("temp"))      return "temperature";
  if (name.startsWith("humidity"))  return "humidity";
  if (name.startsWith("window"))    return "windows";
  if (name.startsWith("garage"))    return "garage";
  return "other";
}

export const CATEGORY_COLORS = {
  Income:   "#10b981",
  Gas:      "#f59e0b",
  Electric: "#3b82f6",
  Internet: "#8b5cf6",
  Mortgage: "#ef4444",
  General:  "#ec4899",
  Food:     "#14b8a6",
};

export const ACCOUNT_NICKNAMES = {
  "Peter Buonaiuto\nJoint Savings PERFORMANCE SAVINGS ...8900": "Joint Savings",
  "Peter Buonaiuto\nJoint Checking CHECKING ...8012":           "Joint Checking",
  "Peter Buonaiuto\nWedding PERFORMANCE SAVINGS ...7737":       "Wedding Savings",
  "Card ...8839": "Quicksilver",
  "Card ...7138": "Savor",
};

export const getAccountName = (name) => ACCOUNT_NICKNAMES[name] || name;
