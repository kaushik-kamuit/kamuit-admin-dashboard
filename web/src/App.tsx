import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Protected from "./components/Protected";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Users from "./pages/Users";
import UserDetail from "./pages/UserDetail";
import Drivers from "./pages/Drivers";
import DriverDetail from "./pages/DriverDetail";
import Rides from "./pages/Rides";
import RideDetail from "./pages/RideDetail";
import Matching from "./pages/Matching";
import Payments from "./pages/Payments";
import DriverRuns from "./pages/DriverRuns";
import DriverRunDetail from "./pages/DriverRunDetail";
import Heatmap from "./pages/Heatmap";
import Sessions from "./pages/Sessions";
import Funnel from "./pages/Funnel";
import Reconciliation from "./pages/Reconciliation";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Overview />} />
        <Route path="users" element={<Users />} />
        <Route path="users/:id" element={<UserDetail />} />
        <Route path="drivers" element={<Drivers />} />
        <Route path="drivers/:id" element={<DriverDetail />} />
        <Route path="rides" element={<Rides />} />
        <Route path="rides/:id" element={<RideDetail />} />
        <Route path="matching" element={<Matching />} />
        <Route path="payments" element={<Payments />} />
        <Route path="driver-runs" element={<DriverRuns />} />
        <Route path="driver-runs/:id" element={<DriverRunDetail />} />
        <Route path="heatmap" element={<Heatmap />} />
        <Route path="sessions" element={<Sessions />} />
        <Route path="funnel" element={<Funnel />} />
        <Route path="recon" element={<Reconciliation />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
