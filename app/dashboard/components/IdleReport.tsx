"use client";

import { useState } from "react";
import { getAuthToken } from "@/lib/auth";

type IdleRow = {
  reportDate: string;
  devicename: string;
  deviceid: string;
  startTime: string;
  endTime: string;
  idleMin: string;
  location: string;
};

export default function IdleReport() {
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [fromTime, setFromTime] = useState("00:00");
  const [toTime, setToTime] = useState("23:59");
  const [matches, setMatches] = useState<IdleRow[]>([]);
  const [filesSearched, setFilesSearched] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestBody = (asCsv: boolean) => {
    const text = query.trim();
    return {
      token: getAuthToken(),
      ...(text ? { query: text } : {}),
      ...(from.trim() ? { from: from.trim() } : {}),
      ...(to.trim() ? { to: to.trim() } : {}),
      startTime: fromTime,
      endTime: toTime,
      ...(asCsv ? { export: true } : {}),
    };
  };

  const applyFilters = async () => {
    const text = query.trim();
    if (text && text.length < 2) {
      setError("Enter at least 2 characters of an IMEI or device name.");
      return;
    }
    const narrowed = fromTime !== "00:00" || toTime !== "23:59";
    if (narrowed && !from.trim() && !to.trim()) {
      setError("Choose a from or to date for the time.");
      return;
    }
    const token = getAuthToken();
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/idle-report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(requestBody(false)),
      });
      const data = await res.json();
      if (!res.ok || data.status !== 0) throw new Error(data.cause || "Failed to load idle report");
      setMatches(data.matches || []);
      setFilesSearched(data.filesSearched || 0);
      setTruncated(Boolean(data.truncated));
      setLoaded(true);
    } catch (e) {
      setMatches([]);
      setLoaded(true);
      setError(e instanceof Error ? e.message : "Failed to load idle report");
    } finally {
      setLoading(false);
    }
  };

  const exportCsv = async () => {
    const text = query.trim();
    if (text && text.length < 2) {
      setError("Enter at least 2 characters of an IMEI or device name.");
      return;
    }
    if (!from.trim() && !to.trim()) {
      setError("Choose a from and to period before exporting.");
      return;
    }
    const token = getAuthToken();
    if (!token) return;
    setExporting(true);
    setError(null);
    try {
      const res = await fetch("/api/idle-report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(requestBody(true)),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.cause || `Export failed (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = match?.[1] || "idle_report.csv";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900">Idle Report</h2>
          <p className="text-sm text-gray-600 mt-1">
            Stops where the engine was on and the vehicle was not moving. Taken from saved parking files.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mb-2">
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">Search IMEI or device name</label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilters();
              }}
              placeholder="IMEI or device name"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-[#FFC107] focus:border-[#FFC107]"
            />
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-[#FFC107] focus:border-[#FFC107]"
              />
              <input
                type="time"
                value={fromTime}
                onChange={(e) => setFromTime(e.target.value)}
                className="w-28 px-3 py-2 rounded-lg border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-[#FFC107] focus:border-[#FFC107]"
              />
            </div>
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-[#FFC107] focus:border-[#FFC107]"
              />
              <input
                type="time"
                value={toTime}
                onChange={(e) => setToTime(e.target.value)}
                className="w-28 px-3 py-2 rounded-lg border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-[#FFC107] focus:border-[#FFC107]"
              />
            </div>
          </div>
          <div className="md:col-span-3 flex items-end gap-2">
            <button
              type="button"
              onClick={applyFilters}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-[#FFC107] text-gray-900 font-medium text-sm hover:bg-yellow-400 disabled:opacity-50"
            >
              {loading ? "Loading..." : "Apply filters"}
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={exporting}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-900 font-medium text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              {exporting ? "Exporting..." : "Export CSV"}
            </button>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setFrom("");
                setTo("");
                setFromTime("00:00");
                setToTime("23:59");
                setMatches([]);
                setLoaded(false);
                setTruncated(false);
                setError(null);
              }}
              className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm hover:bg-gray-50"
            >
              Clear
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Leave the search empty for every vehicle. Type an IMEI or device name to show only that vehicle. From and To include the time. Use the same dates in both for one day.
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm border border-red-200">{error}</div>
        )}

        {loaded && (
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">
              Idle stops
              <span className="ml-2 font-normal text-gray-500">
                {matches.length} stop{matches.length === 1 ? "" : "s"} in {filesSearched} file{filesSearched === 1 ? "" : "s"}
                {truncated ? " (showing the first 400)" : ""}
              </span>
            </h3>
            <div className="rounded-lg border border-gray-200 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">File date</th>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">IMEI</th>
                    <th className="px-4 py-3 font-medium">Start date/time</th>
                    <th className="px-4 py-3 font-medium">End date/time</th>
                    <th className="px-4 py-3 font-medium">Idle (min)</th>
                    <th className="px-4 py-3 font-medium">Start location</th>
                    <th className="px-4 py-3 font-medium">End location</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {matches.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                        {query.trim() || fromTime !== "00:00" || toTime !== "23:59"
                          ? "No rows matched that vehicle or time."
                          : "No idle stops in the saved parking files."}
                      </td>
                    </tr>
                  ) : (
                    matches.map((row, index) => (
                      <tr key={`${row.reportDate}-${row.deviceid}-${row.startTime}-${index}`} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-900 font-medium whitespace-nowrap">{row.reportDate}</td>
                        <td className="px-4 py-3 text-gray-800">{row.devicename || "—"}</td>
                        <td className="px-4 py-3 text-gray-700 font-mono text-xs">{row.deviceid || "—"}</td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.startTime || "—"}</td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{row.endTime || "—"}</td>
                        <td className="px-4 py-3 text-gray-900">{row.idleMin}</td>
                        <td className="px-4 py-3 text-gray-700">{row.location || "—"}</td>
                        <td className="px-4 py-3 text-gray-700">{row.location || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
