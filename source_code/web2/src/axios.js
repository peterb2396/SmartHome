import axios from "axios";

// const primary = axios.create({ baseURL: `http://localhost:3001` });

// const primary = axios.create({ baseURL: `https://server.153home.online` });
const backup  = axios.create({ baseURL: `https://smarthome153.onrender.com` });
const primary  = axios.create({ baseURL: `https://smarthome153.onrender.com` });


// Intercept network errors only (not HTTP errors like 500)
primary.interceptors.response.use(
  response => response,
  async error => {
    if (error.code === "ECONNABORTED" || error.message.includes("Network")) {
      console.warn("Primary unreachable, retrying backup…");
      return backup.request(error.config);
    }
    return Promise.reject(error); // propagate HTTP errors
  }
);

export default primary;
