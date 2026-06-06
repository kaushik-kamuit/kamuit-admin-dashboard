import { useState } from "react";
import { api } from "../api/client";

type Format = "csv" | "json";
type Status = { type: "success" | "error"; message: string } | null;

export default function DataExport() {
  const [tripStart, setTripStart] = useState("");
  const [tripEnd, setTripEnd] = useState("");
  const [tripFmt, setTripFmt] = useState<Format>("csv");

  const [payStart, setPayStart] = useState("");
  const [payEnd, setPayEnd] = useState("");
  const [payFmt, setPayFmt] = useState<Format>("csv");

  const [driverFmt, setDriverFmt] = useState<Format>("csv");

  const [loading, setLoading] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);

  const handleDownload = async (
    key: string,
    endpoint: string,
    params: Record<string, string>,
    filename: string,
  ) => {
    setLoading(key);
    setStatus(null);
    try {
      const resp = await api.get(endpoint, { params, responseType: "blob" });
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      setStatus({ type: "success", message: `Exported successfully` });
    } catch (err: any) {
      setStatus({
        type: "error",
        message: err.response?.data?.detail || "Export failed",
      });
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-kamuit-500">
          REGULATORY COMPLIANCE
        </div>
        <h1 className="text-2xl font-semibold text-slate-900">Data Export</h1>
        <p className="text-sm text-slate-500">
          Export ride, payment, and driver data for TNC regulatory compliance
          reporting.
        </p>
      </div>

      {status && (
        <div
          className={`px-4 py-3 rounded-lg text-sm font-medium ${
            status.type === "success"
              ? "bg-green-50 text-green-700 border border-green-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}
        >
          {status.message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Trip Data Export */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🚗</span>
            <h2 className="text-lg font-semibold text-slate-900">
              Trip Data Export
            </h2>
          </div>
          <p className="text-sm text-slate-500">
            Complete ride data including pickup/drop coordinates, rider/driver
            IDs, assignment details
          </p>

          <div className="space-y-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">
                Start Date
              </label>
              <input
                type="date"
                value={tripStart}
                onChange={(e) => setTripStart(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">
                End Date
              </label>
              <input
                type="date"
                value={tripEnd}
                onChange={(e) => setTripEnd(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
          </div>

          <FormatSelector value={tripFmt} onChange={setTripFmt} />

          <button
            disabled={loading === "trips" || !tripStart || !tripEnd}
            onClick={() =>
              handleDownload(
                "trips",
                "/api/exports/trips",
                { start_date: tripStart, end_date: tripEnd, fmt: tripFmt },
                `trips_${tripStart}_${tripEnd}.${tripFmt}`,
              )
            }
            className="w-full bg-kamuit-500 hover:bg-kamuit-600 text-white px-4 py-2.5 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading === "trips" ? "Exporting…" : "Export Trips"}
          </button>
        </div>

        {/* Payment Data Export */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl">💳</span>
            <h2 className="text-lg font-semibold text-slate-900">
              Payment Data Export
            </h2>
          </div>
          <p className="text-sm text-slate-500">
            Payment intents with amounts, statuses, Stripe IDs
          </p>

          <div className="space-y-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">
                Start Date
              </label>
              <input
                type="date"
                value={payStart}
                onChange={(e) => setPayStart(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-600">
                End Date
              </label>
              <input
                type="date"
                value={payEnd}
                onChange={(e) => setPayEnd(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>
          </div>

          <FormatSelector value={payFmt} onChange={setPayFmt} />

          <button
            disabled={loading === "payments" || !payStart || !payEnd}
            onClick={() =>
              handleDownload(
                "payments",
                "/api/exports/payments",
                { start_date: payStart, end_date: payEnd, fmt: payFmt },
                `payments_${payStart}_${payEnd}.${payFmt}`,
              )
            }
            className="w-full bg-kamuit-500 hover:bg-kamuit-600 text-white px-4 py-2.5 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading === "payments" ? "Exporting…" : "Export Payments"}
          </button>
        </div>

        {/* Driver Roster Export */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl">👤</span>
            <h2 className="text-lg font-semibold text-slate-900">
              Driver Roster Export
            </h2>
          </div>
          <p className="text-sm text-slate-500">
            Aggregated driver statistics: total runs, completions, distances
          </p>

          <FormatSelector value={driverFmt} onChange={setDriverFmt} />

          <button
            disabled={loading === "drivers"}
            onClick={() =>
              handleDownload(
                "drivers",
                "/api/exports/drivers",
                { fmt: driverFmt },
                `driver_roster.${driverFmt}`,
              )
            }
            className="w-full bg-kamuit-500 hover:bg-kamuit-600 text-white px-4 py-2.5 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading === "drivers" ? "Exporting…" : "Export Driver Roster"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FormatSelector({
  value,
  onChange,
}: {
  value: Format;
  onChange: (f: Format) => void;
}) {
  return (
    <div className="flex gap-2">
      <button
        onClick={() => onChange("csv")}
        className={`flex-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
          value === "csv"
            ? "bg-kamuit-500 text-white"
            : "bg-white text-slate-600 border border-slate-300 hover:bg-slate-50"
        }`}
      >
        CSV
      </button>
      <button
        onClick={() => onChange("json")}
        className={`flex-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
          value === "json"
            ? "bg-kamuit-500 text-white"
            : "bg-white text-slate-600 border border-slate-300 hover:bg-slate-50"
        }`}
      >
        JSON
      </button>
    </div>
  );
}
