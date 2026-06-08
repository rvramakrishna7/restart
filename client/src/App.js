import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import React from "react";

import LandingPage from "./pages/LandingPage";
import Dashboard from "./pages/Dashboard";
import Signup from "./pages/Signup";
import StrategySelection from "./pages/StrategySelection";
import Analytics from "./pages/Analytics";
import BrokerAccess from "./pages/BrokerAccess";
import Product from "./pages/Product";
import Contact from "./pages/Contact";
import Admin from "./pages/Admin";

const PrivateRoute = ({ children }) => {
  const token = localStorage.getItem("token");

  if (!token) return <Navigate to="/login" />;

  return children;
};

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("Unhandled UI error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "2rem", textAlign: "center" }}>
          <h2>Something went wrong.</h2>
          <p>Please refresh the page. If the problem persists, contact support.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <Routes>

        <Route path="/" element={<Product />} />
        <Route path="/start" element={<LandingPage />} />
        <Route path="/login" element={<Navigate to="/start" />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/signup" element={<Navigate to="/start" />}  />
        <Route path="/product" element={<Navigate to="/" />} />
        <Route
          path="/admin"
          element={
            <PrivateRoute>
              <Admin />
            </PrivateRoute>
          }
        />

        <Route
          path="/strategies"
          element={
            <PrivateRoute>
              <StrategySelection />
            </PrivateRoute>
          }
        />

        <Route
          path="/dashboard"
          element={
            <PrivateRoute>
              <Dashboard />
            </PrivateRoute>
          }
        />

        <Route
          path="/analytics"
          element={
            <PrivateRoute>
              <Analytics />
            </PrivateRoute>
          }
        />

        <Route
          path="/broker-access"
          element={
            <PrivateRoute>
              <BrokerAccess />
            </PrivateRoute>
          }
        />

      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;