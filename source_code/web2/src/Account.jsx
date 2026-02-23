import React, { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

const Account = (props) => {
  const host = props.host;
  const [company, setCompany] = useState(props.company || "");
  const [password, setPassword] = useState("");
  const [newpass1, setNewpass1] = useState("");
  const [newpass2, setNewpass2] = useState("");

  const [done, setDone] = useState(false);
  const [fail, setFail] = useState(false);
  const [errmsg, setErrmsg] = useState("");

  const navigate = useNavigate();

  // Update DB and user token on session storage
  const updateAccount = (e) => {
    e.preventDefault();

    const data = {
      newpass: newpass1,
      newcompanyname: company,
      password: password,
      uid: localStorage.getItem("token"),
    };

    axios
      .post(`${host}/update-account`, data)
      .then(() => {
        setDone(true);
        setFail(false);
      })
      .catch((res) => {
        setErrmsg(res.response?.data.message || "An error occurred.");
        setFail(true);
        setDone(true);
      });
  };

  // Logout of this account
  const logout = () => {
    localStorage.clear();
    navigate("/");
    window.location.reload();
  };

  const validateData = () => {
    if (!password || !company) return false;
    if (newpass1 !== newpass2) return false;
    return true;
  };

  // Response display
  if (done) {
    if (fail) {
      return (
        <div
          style={{
            display: "flex",
            padding: "20%",
            alignItems: "center",
            flexDirection: "column",
          }}
        >
          <h1 style={{ color: "rgb(92, 119, 226)" }}>Oh no!</h1>
          <p style={{ color: "gray" }}>{errmsg}</p>
        </div>
      );
    } else {
      // Success
      return (
        <div
          style={{
            display: "flex",
            padding: "20%",
            alignItems: "center",
            flexDirection: "column",
          }}
        >
          <h1 style={{ color: "rgb(92, 119, 226)" }}>Success!</h1>
          <p style={{ color: "gray" }}>
            Your account details have been updated.
          </p>
        </div>
      );
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexDirection: "column",
        paddingTop: "20px",
      }}
    >
      <h2 className="title">MODIFY ACCOUNT</h2>
      <form onSubmit={updateAccount}>
        <div className="form-group">
          <label style={{ marginLeft: "5px", color: "gray" }}>Password</label>
          <input
            style={{ margin: "5px" }}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="form-control"
            id="passwordInput"
            placeholder="Enter password"
          />
        </div>

        <div className="form-group">
          <label style={{ marginLeft: "5px", color: "gray" }}>New Password</label>
          <input
            style={{ margin: "5px" }}
            type="password"
            value={newpass1}
            onChange={(e) => setNewpass1(e.target.value)}
            className="form-control"
            id="newpass1Input"
            placeholder="Enter new password"
          />
        </div>

        <div className="form-group">
          <label style={{ marginLeft: "5px", color: "gray" }}>
            Confirm New Password
          </label>
          <input
            style={{ margin: "5px" }}
            type="password"
            value={newpass2}
            onChange={(e) => setNewpass2(e.target.value)}
            className="form-control"
            id="newpass2Input"
            placeholder="Confirm new password"
          />
        </div>

        <p id="errorMsg">{errmsg}</p>

        <div
          style={{
            margin: "5px",
            display: "flex",
            justifyContent: "space-between",
            paddingTop: "20px",
          }}
        >
          <button
            type="button"
            className="btn btn-outline-secondary"
            id="logout"
            onClick={logout}
          >
            Logout
          </button>
          <button
            style={{ marginRight: "-10px" }}
            type="submit"
            className="btn btn-outline-primary"
            id="login-btn"
            disabled={!validateData()}
          >
            Update
          </button>
        </div>
      </form>
    </div>
  );
};

export default Account;
