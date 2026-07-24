import axios from "axios";

// const primary = axios.create({ baseURL: `https://server.153home.online` });
const primary = axios.create({ baseURL: `http://localhost:3001` });

const backup  = axios.create({ baseURL: `https://smarthome153.onrender.com` });

primary.interceptors.response.use(
  response => response,
  async error => {
    
      console.warn("Primary unreachable, trying backup…");
      return backup.request(error.config);
    
  }
);

export default primary;
