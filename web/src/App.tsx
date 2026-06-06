import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Protected from "./components/Protected";
import Login from "./pages/Login";
import Operations from "./pages/Operations";
import Explorer from "./pages/Explorer";
import QueryStudio from "./pages/QueryStudio";
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

// New pages (lazy-loaded)
const LiveMap = lazy(() => import("./pages/LiveMap"));
const Alerts = lazy(() => import("./pages/Alerts"));
const Trends = lazy(() => import("./pages/Trends"));
const AuditLog = lazy(() => import("./pages/AuditLog"));
const AdminUsers = lazy(() => import("./pages/AdminUsers"));
const StripeEvents = lazy(() => import("./pages/StripeEvents"));
const VehicleReview = lazy(() => import("./pages/VehicleReview"));
const Cancellations = lazy(() => import("./pages/Cancellations"));
const FraudDetection = lazy(() => import("./pages/FraudDetection"));
const ChurnRisk = lazy(() => import("./pages/ChurnRisk"));
const DataExport = lazy(() => import("./pages/DataExport"));
const Notifications = lazy(() => import("./pages/Notifications"));
const ETAAccuracy = lazy(() => import("./pages/ETAAccuracy"));

function Loader() {
  return (
    <div className="flex items-center justify-center p-12">
      <div className="w-6 h-6 rounded-full border-2 border-kamuit-200 border-t-kamuit-500 animate-spin" />
    </div>
  );
}

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
        <Route index element={<Operations />} />
        <Route path="operations" element={<Operations />} />
        <Route path="explorer" element={<Explorer />} />
        <Route path="query" element={<QueryStudio />} />
        <Route path="legacy-overview" element={<Overview />} />
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

        {/* New pages */}
        <Route path="live-map" element={<Suspense fallback={<Loader />}><LiveMap /></Suspense>} />
        <Route path="alerts" element={<Suspense fallback={<Loader />}><Alerts /></Suspense>} />
        <Route path="trends" element={<Suspense fallback={<Loader />}><Trends /></Suspense>} />
        <Route path="audit-log" element={<Suspense fallback={<Loader />}><AuditLog /></Suspense>} />
        <Route path="admin-users" element={<Suspense fallback={<Loader />}><AdminUsers /></Suspense>} />
        <Route path="stripe-events" element={<Suspense fallback={<Loader />}><StripeEvents /></Suspense>} />
        <Route path="vehicle-review" element={<Suspense fallback={<Loader />}><VehicleReview /></Suspense>} />
        <Route path="cancellations" element={<Suspense fallback={<Loader />}><Cancellations /></Suspense>} />
        <Route path="fraud" element={<Suspense fallback={<Loader />}><FraudDetection /></Suspense>} />
        <Route path="churn" element={<Suspense fallback={<Loader />}><ChurnRisk /></Suspense>} />
        <Route path="data-export" element={<Suspense fallback={<Loader />}><DataExport /></Suspense>} />
        <Route path="notifications" element={<Suspense fallback={<Loader />}><Notifications /></Suspense>} />
        <Route path="eta-accuracy" element={<Suspense fallback={<Loader />}><ETAAccuracy /></Suspense>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
