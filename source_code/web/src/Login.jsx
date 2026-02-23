import React, { useState } from "react";
import { logOrReg, confirmDevice, resetPassword, setNewPassword } from "./api";
import CodeEntry from "./components/CodeEntry";
import "bootstrap/dist/css/bootstrap.min.css";

export default function Login({ login }) {
  const [email,      setEmail]      = useState("");
  const [password,   setPassword]   = useState("");
  const [showCode,   setShowCode]   = useState(false);
  const [inProgress, setInProgress] = useState(false);
  const [forgotPass, setForgotPass] = useState(false);
  const [canReset,   setCanReset]   = useState(false);
  const [resetCode,  setResetCode]  = useState("");
  const [pass1,      setPass1]      = useState("");
  const [pass2,      setPass2]      = useState("");
  const [status,     setStatus]     = useState("");
  const deviceId = "webid";

  const isValidEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  const onSubmit = async (e) => {
    e.preventDefault();
    setInProgress(true);
    setStatus("Checking credentials...");
    try {
      const res = await logOrReg(email, password, deviceId);
      setStatus("Logging in...");
      login(res.data.token, true);
    } catch (err) {
      setInProgress(false);
      const s = err.response?.status;
      if (s === 400)      setStatus("Incorrect password!");
      else if (s === 422) { setStatus("Enter the code sent to your email."); setShowCode(true); }
      else if (s === 404) setStatus("User not found!");
      else if (s === 401) setStatus("Not whitelisted!");
      else                setStatus("Error, please try again.");
    }
  };

  const onConfirmCode = async (code) => {
    try {
      const res = await confirmDevice(email, code);
      if (forgotPass) {
        setResetCode(code);
        setCanReset(true);
        setShowCode(false);
        setForgotPass(false);
        setStatus("Choose a new password");
      } else {
        login(res.data.token, true);
      }
    } catch (err) {
      const s = err.response?.status;
      if (s === 401)      setStatus("Invalid code. Please try again.");
      else if (s === 404) setStatus("User not found.");
      else if (s === 429) setStatus("Too many incorrect attempts.");
      else                setStatus("Invalid code.");
      setShowCode(false);
    }
  };

  const onSendReset = async (e) => {
    e.preventDefault();
    setStatus("Sending code...");
    try {
      await resetPassword(email);
      setStatus("Code sent to your email.");
      setShowCode(true);
    } catch {
      setStatus("Error sending reset code.");
    }
  };

  const onResetPass = async (e) => {
    e.preventDefault();
    if (pass1 !== pass2) { setStatus("Passwords must match."); return; }
    try {
      const res = await setNewPassword(resetCode, pass1, email);
      login(res.data.token, true);
    } catch {
      setStatus("Error updating password.");
    }
  };

  const BackButton = ({ onClick }) => (
    <img src="back.png" alt="Back" onClick={() => { setStatus(""); onClick(); }}
      style={{ position: "absolute", top: 10, left: 10, width: 50, height: 50, cursor: "pointer", zIndex: 1000 }} />
  );

  const wrap = (children) => (
    <div className="login-wrapper">
      <div className="login-inner" style={{ position: "relative" }}>
        {children}
      </div>
    </div>
  );

  if (showCode) return wrap(
    <>
      <BackButton onClick={() => setShowCode(false)} />
      <CodeEntry fulfilled={onConfirmCode} status={status} />
    </>
  );

  if (canReset) return wrap(
    <form onSubmit={onResetPass} style={{ display: "flex", flexDirection: "column" }}>
      <BackButton onClick={() => setCanReset(false)} />
      <h2 className="title">Reset Password</h2>
      {[["New Password", pass1, setPass1], ["Confirm Password", pass2, setPass2]].map(([lbl, val, set]) => (
        <div key={lbl} className="form-floating mb-3">
          <input type="password" className="form-control" placeholder={lbl}
            value={val} onChange={e => set(e.target.value)} required />
          <label>{lbl}</label>
        </div>
      ))}
      <button className="btn btn-primary btn-block" type="submit">Change Password</button>
      <p className="text-danger mt-3">{status}</p>
    </form>
  );

  if (forgotPass) return wrap(
    <form onSubmit={onSendReset} style={{ display: "flex", flexDirection: "column" }}>
      <BackButton onClick={() => setForgotPass(false)} />
      <h2 className="title">Forgot Password</h2>
      <div className="form-floating mb-3">
        <input type="email" className="form-control" placeholder="Email"
          value={email} onChange={e => setEmail(e.target.value)} required />
        <label>Email address</label>
      </div>
      <button className="btn btn-primary btn-block" type="submit">Send Code</button>
      <p className="text-danger mt-3">{status}</p>
    </form>
  );

  return wrap(
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column" }}>
      <h2 className="title">Login</h2>
      <div className="form-floating mb-3">
        <input type="email" className="form-control" placeholder="Email"
          value={email} onChange={e => setEmail(e.target.value)} required />
        <label>Email address</label>
      </div>
      <div className="form-floating mb-3">
        <input type="password" className="form-control" placeholder="Password"
          value={password} onChange={e => setPassword(e.target.value)} required />
        <label>Password</label>
      </div>
      <button className="btn btn-primary btn-block" type="submit"
        disabled={!isValidEmail(email) || !password || inProgress}>
        {inProgress ? "Loading..." : "Login / Register"}
      </button>
      <p className="text-danger mt-3">{status}</p>
      <button className="btn btn-link" type="button" onClick={() => setForgotPass(true)}>
        Forgot Password?
      </button>
    </form>
  );
}
