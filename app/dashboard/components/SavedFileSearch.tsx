"use client";

import { useState } from "react";
import { getAuthToken } from "@/lib/auth";

type ReportSource = "parking" | "offline" | "overspeed" | "trips";

type SearchHit = {
  filename: string;
  reportDate: string | null;
  deviceid: string;
  devicename: string;
  fields: Record<string, string>;
};

const COLUMNS: Record<ReportSource, { key: string; label: string }[]> = {
  parking: [
    { key: "startTime", label: "Start time" },
    { key: "endTime", label: "End time" },
    { key: "idle", label: "Idle (min)" },
    { key: "address", label: "Address" },
  ],
  offline: [
    { key: "lastUpdate", label: "Last update" },
    { key: "offlineDuration", label: "Offline duration" },
    { key: "lastLocation", label: "Last location" },
    { key: "status", label: "Status" },
  ],
  overspeed: [
    { key: "startTime", label: "Start time" },
    { key: "endTime", label: "End time" },
    { key: "maxSpeed", label: "Max speed" },
    { key: "overspeed", label: "Overspeed" },
  ],
  trips: [
    { key: "startTime", label: "Start time" },
    { key: "endTime", label: "End time" },
    { key: "distance", label: "Distance (km)" },
    { key: "tripTime", label: "Trip time (min)" },
  ],
};

export default function SavedFileSearch({
  source,
  date,
  from,
  to,
  downloading,
  onDownload,
}: {
  source: ReportSource;
  date: string;
  from: string;
  to: string;
  downloading: string | null;
  onDownload: (filename: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SearchHit[]>([]);
  const [filesSearched, setFilesSearched] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchRan, setSearchRan] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const columns = COLUMNS[source];

  const runSearch = async () => {
    const text = query.trim();
    if (text.length < 2) {
      setError("Enter at least 2 characters of an IMEI or device name.");
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const token = getAuthToken();
      if (!token) throw new Error("Not logged in.");
      const res = await fetch("/api/report-search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          token,
          source,
          query: text,
          ...(date.trim() ? { date: date.trim() } : {}),
          ...(from.trim() ? { from: from.trim() } : {}),
          ...(to.trim() ? { to: to.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.status !== 0) throw new Error(data.cause || "Search failed");
      setMatches(data.matches || []);
      setFilesSearched(data.filesSearched || 0);
      setTruncated(Boolean(data.truncated));
      setSearchRan(true);
    } catch (e) {
      setMatches([]);
      setSearchRan(true);
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="mb-4">
      <label className="block text-xs font-medium text-gray-600 mb-1">Search IMEI or device name</label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") runSearch();
          }}
          placeholder="IMEI or device name"
          className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-[#FFC107] focus:border-[#FFC107]"
        />
        <button
          type="button"
          onClick={runSearch}
          disabled={searching}
          className="px-4 py-2 rounded-lg bg-[#FFC107] text-gray-900 font-medium text-sm hover:bg-yellow-400 disabled:opacity-50"
        >
          {searching ? "Searching..." : "Search files"}
        </button>
      </div>
      <p className="text-xs text-gray-500 mt-1">
        Search files looks through the saved Excel files and marks each file date. The date filters below limit which files are searched.
      </p>
      {error && (
        <div className="mt-3 p-3 rounded-lg bg-red-50 text-red-800 text-sm border border-red-200">{error}</div>
      )}
      {searchRan && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">
            Search results
            <span className="ml-2 font-normal text-gray-500">
              {matches.length} match{matches.length === 1 ? "" : "es"} in {filesSearched} file{filesSearched === 1 ? "" : "s"}
              {truncated ? " (showing the first 400)" : ""}
            </span>
          </h3>
          <div className="rounded-lg border border-gray-200 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-medium">File date</th>
                  <th className="px-4 py-3 font-medium">Device name</th>
                  <th className="px-4 py-3 font-medium">IMEI</th>
                  {columns.map((column) => (
                    <th key={column.key} className="px-4 py-3 font-medium">{column.label}</th>
                  ))}
                  <th className="px-4 py-3 font-medium w-24"> </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {matches.length === 0 ? (
                  <tr>
                    <td colSpan={4 + columns.length} className="px-4 py-8 text-center text-gray-500">
                      No vehicle matched that IMEI or name in the saved files.
                    </td>
                  </tr>
                ) : (
                  matches.map((hit, index) => (
                    <tr key={`${hit.filename}-${hit.deviceid}-${index}`} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-900 font-medium whitespace-nowrap">{hit.reportDate || hit.filename}</td>
                      <td className="px-4 py-3 text-gray-800">{hit.devicename || "—"}</td>
                      <td className="px-4 py-3 text-gray-700 font-mono text-xs">{hit.deviceid || "—"}</td>
                      {columns.map((column) => (
                        <td key={column.key} className="px-4 py-3 text-gray-700">{hit.fields[column.key] || "—"}</td>
                      ))}
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => onDownload(hit.filename)}
                          disabled={downloading === hit.filename}
                          className="text-[#FFC107] hover:text-yellow-600 font-medium text-xs disabled:opacity-50"
                        >
                          {downloading === hit.filename ? "..." : "Download"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
