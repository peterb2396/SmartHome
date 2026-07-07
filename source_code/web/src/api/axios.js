import axios from "axios";

const primary = axios.create({ baseURL: `https://server.153home.online` });
const backup  = axios.create({ baseURL: `https://smarthome153.onrender.com` });

primary.interceptors.response.use(
  response => response,
  async error => {
    
      console.warn("Primary unreachable, trying backup…");
      return backup.request(error.config);
    
  }
);

export default primary;
