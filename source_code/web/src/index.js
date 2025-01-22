import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

import Main from "./Main";

const rootElement = ReactDOM.createRoot(document.getElementById("root"));
rootElement.render(
  <React.StrictMode>
    <Main  />
  </React.StrictMode>,
);
