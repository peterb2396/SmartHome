import React, { useState, useEffect } from "react";
import axios from "axios";
import CodeEntry from "./CodeEntry";
import "bootstrap/dist/css/bootstrap.min.css";

export default function LoginScreen(props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [loginInProgress, setLoginInProgress] = useState(false);
  const [forgotPassword, setForgotPassword] = useState(false);
  const [canResetPass, setCanResetPass] = useState(false);
  const [resetCode, setResetCode] = useState("");
  const [pass1, setPass1] = useState("");
  const [pass2, setPass2] = useState("");
  const [status, setStatus] = useState("");
  const [deviceId, setDeviceId] = useState("");


  useEffect(() => {
    setDeviceId("webid");
  }, []);

  const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const toggleForgotPassword = () => {
    setForgotPassword(!forgotPassword);
  };

  const onLogRegPress = (e) => {
    e.preventDefault();
    setLoginInProgress(true);
    setStatus("Checking credentials...");
    axios
      .post(`${props.api}/log-or-reg`, {
        email: email,
        password: password,
        device: deviceId,
      })
      .then((res) => {
        setStatus("Logging in...");
        props.login(res.data.token, true, res.data.new_account, res.data.new_user);
      })
      .catch((e) => {
        setLoginInProgress(false);
        handleLoginError(e);
      });
  };

  const handleLoginError = (e) => {
    console.log(e);
    if (e.response) {
      const { status } = e.response;
      if (status === 400) {
        setStatus("Incorrect password!");
      } else if (status === 422) {
        setStatus("Please enter the code sent to your email.");
        setShowCode(true);
      } else if (status === 404) {
        setStatus("User not found!");
      } else if (status === 401) {
        setStatus("Not whitelisted!");
      }
       else {
        setStatus("Error, please try again");
      }
    } else {
      setStatus("Network error, please try again later.");
    }
  };

  const sendResetPassCode = (e) => {
    e.preventDefault();
    setStatus("Sending code to email...");
    axios
      .post(`${props.api}/resetPassword`, { email: email })
      .then(() => {
        setStatus("Code sent to your email. Enter it below.");
        setShowCode(true);
      })
      .catch(() => {
        setStatus("Error sending reset code. Please try again.");
      });
  };

  const resetPassword = (e) => {
    e.preventDefault();
    if (pass1 !== pass2) {
      setStatus("Passwords must match.");
      return;
    }
    axios
      .post(`${props.api}/setNewPassword`, {
        resetCode: resetCode,
        pass: pass1,
        email: email,
      })
      .then((res) => {
        props.login(res.data.token, true, false, false);
      })
      .catch(() => {
        setStatus("Error updating password");
      });
  };

  const BackButton = ({ onClick }) => (
    <img
      src={`back.png`}
      alt="Toggle Form"
      style={{
        position: "absolute",
        top: "10px",
        left: "10px",
        zIndex: 1000,
        width: "50px",
        height: "50px",
        cursor: "pointer",
      }}
      onClick={() => {
        setStatus("");
        onClick();
      }}
    />
  );

  if (showCode) {
    return (
      <div>
        <BackButton onClick={() => setShowCode(false)} />
        <CodeEntry
          fulfilled={async (code) => {
            axios.post(`${props.api}/confirmDevice`, { email: email, code: code })
            .then(async (res) => {
              if (forgotPassword) {
                setStatus("Choose a new password");
                setResetCode(code);
                setCanResetPass(true);
                setShowCode(false);
                setForgotPassword(false);
              } else {
                setStatus("Logging in...");
                props.login(res.data.token, true, res.data.new_user, res.data.new_account);
                if (res.data.new_user) {
                  alert("Welcome to the app!");
                }
              }
            })
            .catch((e) => {
              console.log(e);
              if (e.response)
              {
                
                const { status } = e.response;
                if (status === 422)
                {
                    // code recieved
                    return
                }
                if (status === 401) {
                  setStatus("Invalid code. Please try again.");
                }
                else if (status === 404) {
                  setStatus("User not found.");
                }
                else if (status === 429) {
                    setStatus("Too many incorrect attempts.");
                  }
              }
              else {
              setStatus("Invalid code. Please try again.");

              }
              setShowCode(false);

            });
          }}
          status={status}
        />
      </div>
    );
  }

  if (canResetPass) {
    return (
      <form onSubmit={resetPassword} style={{ display: "flex", flexDirection: "column" }}>
        <BackButton onClick={() => setCanResetPass(false)} />
        <h2 className="title">Reset Password</h2>
        <div className="form-floating mb-3">
          <input
            id="floatingInput"
            type="password"
            className="form-control"
            placeholder="New password"
            value={pass1}
            onChange={(e) => setPass1(e.target.value)}
            required={true}
          />
          <label htmlFor="floatingInput">New Password</label>
        </div>
        <div className="form-floating mb-3">
          <input
            id="floatingInput"
            type="password"
            className="form-control"
            placeholder="Confirm password"
            value={pass2}
            onChange={(e) => setPass2(e.target.value)}
            required={true}
          />
          <label htmlFor="floatingInput">Confirm Password</label>
        </div>
        <button className="btn btn-primary btn-block" type="submit">
          Change Password
        </button>
        <p className="text-danger mt-3">{status}</p>
      </form>
    );
  }

  if (forgotPassword) {
    return (
    <form onSubmit={sendResetPassCode} style={{ display: "flex", flexDirection: "column" }}>
        <BackButton onClick={() => setForgotPassword(false)} />
        <h2 class="title">Forgot Password</h2>
     
        <div class="form-floating mb-3">
            <input 
                id="floatingInput"
                type="email"
                class="form-control"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required={true}
            />
            <label for="floatingInput">Email address</label>
        </div>

        <button className="btn btn-primary btn-block" onClick={sendResetPassCode}>
          Send Code
        </button>
        <p className="text-danger mt-3">{status}</p>
      </form>
    );
  }

  return (
    <form onSubmit={onLogRegPress} style={{ display: "flex", flexDirection: "column" }}>
      <h2 className="title">Login</h2>
      <div className="form-floating mb-3">
        <input
          id="floatingInput"
          type="email"
          className="form-control"
          placeholder="Enter your email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required={true}
        />
        <label htmlFor="floatingInput">Email address</label>
      </div>
      <div className="form-floating mb-3">
        <input
          id="floatingInput"
          type="password"
          className="form-control"
          placeholder="Enter your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required={true}
        />
        <label htmlFor="floatingInput">Password</label>
      </div>
      <button
        className="btn btn-primary btn-block"
        type="submit"
        disabled={!isValidEmail(email) || !password || loginInProgress}
      >
        {loginInProgress ? "Loading..." : "Login/Register"}
      </button>
      <p className="text-danger mt-3">{status}</p>
      <button className="btn btn-link" type="button" onClick={toggleForgotPassword}>
        Forgot Password?
      </button>
    </form>
  );
}
