import { useState, useEffect, useCallback } from "react";
import { BrowserRouter, useLocation } from "react-router-dom";
import { getUser } from "./api";
import Login    from "./Login";
import MyRouter from "./MyRouter";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

export default function Main() {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);

  const login = useCallback((token, store) => {
    if (store) localStorage.setItem("token", token);
    getUser(token)
      .then(({ data }) => setUser({ id: data.user._id, email: data.user.email }))
      .catch(() => setLoading(false))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) login(token, false);
    else setLoading(false);
  }, [login]);

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "#94a3b8", fontWeight: 500 }}>Loading...</p>
    </div>
  );

  if (!user) return <Login login={login} />;

  return (
    <BrowserRouter>
      <ScrollToTop />
      <MyRouter />
    </BrowserRouter>
  );
}
