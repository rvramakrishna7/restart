import axios from "axios";


const instance = axios.create({
  baseURL: process.env.REACT_APP_API_URL || "http://localhost:5000",
});

// Attach the JWT (if present) to every request.
instance.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = token;
  }
  return config;
});

export default instance;
