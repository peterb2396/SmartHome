import { Routes, Route } from "react-router-dom";
import Nav      from "./Nav";
import Lights   from "./pages/Lights";
import Sensors  from "./pages/Sensors";
import Cameras  from "./pages/Cameras";
import Finance  from "./pages/Finance";
import Settings from "./pages/Settings";

export default function MyRouter() {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      width: "100%",
      minHeight: "100vh",
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      <Nav />
      <div style={{ flex: 1, width: "100%" }}>
        <Routes>
          <Route index           element={<Lights   />} />
          <Route path="sensors"  element={<Sensors  />} />
          <Route path="cameras"  element={<Cameras  />} />
          <Route path="finance"  element={<Finance  />} />
          <Route path="settings" element={<Settings />} />
        </Routes>
      </div>
    </div>
  );
}
