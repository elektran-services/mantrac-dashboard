"use client";

import { useEffect, useState } from "react";
import { getAuthToken, getUserData } from "@/lib/auth";

type ReportFile = {
  filename: string;
  size: number;
  modifiedAt: string;
  reportDate: string | null;
};

type MileageHit = {
  filename: string;
  reportDate: string | null;
  deviceid: string;
  devicename: string;
  odometerKm: string;
  sinceServiceKm: number;
  remainingKm: number;
  overdueKm: number;
  nextServiceKm: number;
  serviceStatus: string;
  hasReset: boolean;
};

type ServiceVehicle = {
  deviceid: string;
  devicename: string;
  odometerKm: number;
  reportDate: string | null;
  sinceServiceKm: number;
  remainingKm: number;
  overdueKm: number;
  nextServiceKm: number;
  status: string;
  hasReset: boolean;
  thresholdKm: number;
};

type MileageCategory = "daily" | "monthly";
type MileageTab = MileageCategory | "service";

async function fetchMileageReportsList(
  category: MileageCategory,
  filters: { date?: string; from?: string; to?: string }
) {
  const token = getAuthToken();
  if (!token) throw new Error("Not logged in.");
  const res = await fetch("/api/mileage-reports", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      token,
      category,
      ...(filters.date?.trim() ? { date: filters.date.trim() } : {}),
      ...(filters.from?.trim() ? { from: filters.from.trim() } : {}),
      ...(filters.to?.trim() ? { to: filters.to.trim() } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok || data.status !== 0) {
    throw new Error(data.cause || "Failed to load mileage reports");
  }
  return data as { files: ReportFile[]; retentionDays?: number };
}

export default function SavedMileageReports() {
  const [activeTab, setActiveTab] = useState<MileageTab>("daily");
  const [date, setDate] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [files, setFiles] = useState<ReportFile[]>([]);
  const [retentionDays, setRetentionDays] = useState(365);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [matches, setMatches] = useState<MileageHit[]>([]);
  const [filesSearched, setFilesSearched] = useState(0);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchRan, setSearchRan] = useState(false);
  const [serviceVehicles, setServiceVehicles] = useState<ServiceVehicle[]>([]);
  const [serviceLoading, setServiceLoading] = useState(true);
  const [resetting, setResetting] = useState<string | null>(null);
  const [activityExporting, setActivityExporting] = useState(false);
  const [pendingReset, setPendingReset] = useState<{
    deviceid: string;
    devicename: string;
    odometerKm: number;
    overdueKm: number;
    remainingKm: number;
    due: boolean;
  } | null>(null);

  const applyFilters = async () => {
    if (activeTab === "service") return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMileageReportsList(activeTab, { date, from, to });
      setFiles(data.files || []);
      if (typeof data.retentionDays === "number") setRetentionDays(data.retentionDays);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  const exportActivity = async () => {
    const token = getAuthToken();
    if (!token) return;
    setActivityExporting(true);
    setError(null);
    try {
      const res = await fetch("/api/mileage-service?report=activity", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.cause || `Export failed (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `user_activities_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setActivityExporting(false);
    }
  };

  const loadServiceVehicles = async () => {
    setServiceLoading(true);
    try {
      const token = getAuthToken();
      if (!token) throw new Error("Not logged in.");
      const res = await fetch("/api/mileage-service", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || data.status !== 0) throw new Error(data.cause || "Failed to load service counters");
      setServiceVehicles(data.vehicles || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load service counters");
    } finally {
      setServiceLoading(false);
    }
  };

  useEffect(() => {
    loadServiceVehicles();
  }, []);

  useEffect(() => {
    if (activeTab === "service") return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchMileageReportsList(activeTab, {});
        if (!cancelled) {
          setFiles(data.files || []);
          setMatches([]);
          setSearchRan(false);
          setSearchTruncated(false);
          if (typeof data.retentionDays === "number") setRetentionDays(data.retentionDays);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Request failed");
          setFiles([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  const runSearch = async () => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setError("Enter at least 2 characters of an IMEI or device name.");
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const token = getAuthToken();
      if (!token) throw new Error("Not logged in.");
      const res = await fetch("/api/mileage-reports/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          token,
          category: activeTab,
          query,
          ...(date.trim() ? { date: date.trim() } : {}),
          ...(from.trim() ? { from: from.trim() } : {}),
          ...(to.trim() ? { to: to.trim() } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok || data.status !== 0) {
        throw new Error(data.cause || "Search failed");
      }
      setMatches(data.matches || []);
      setFilesSearched(data.filesSearched || 0);
      setSearchTruncated(Boolean(data.truncated));
      setSearchRan(true);
    } catch (e) {
      setMatches([]);
      setSearchRan(true);
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const resetService = (vehicle: {
    deviceid: string;
    devicename: string;
    odometerKm: number | string;
    overdueKm?: number;
    remainingKm?: number;
    status?: string;
    serviceStatus?: string;
  }) => {
    const latest = serviceVehicles.find((item) => item.deviceid === vehicle.deviceid);
    const odometer = latest?.odometerKm ?? Number(vehicle.odometerKm);
    if (!Number.isFinite(odometer)) return;
    const overdueKm = latest?.overdueKm ?? vehicle.overdueKm ?? 0;
    const remainingKm = latest?.remainingKm ?? vehicle.remainingKm ?? 0;
    const status = latest?.status ?? vehicle.status ?? vehicle.serviceStatus ?? "ok";
    const due = status === "due" || status === "overdue" || overdueKm > 0;
    setPendingReset({
      deviceid: vehicle.deviceid,
      devicename: vehicle.devicename || vehicle.deviceid,
      odometerKm: odometer,
      overdueKm,
      remainingKm,
      due,
    });
  };

  const confirmReset = async () => {
    if (!pendingReset) return;
    const vehicle = pendingReset;
    setPendingReset(null);
    setResetting(vehicle.deviceid);
    setError(null);
    try {
      const token = getAuthToken();
      if (!token) throw new Error("Not logged in.");
      const res = await fetch("/api/mileage-service", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          token,
          deviceid: vehicle.deviceid,
          username: getUserData()?.username || getUserData()?.nickname || "Unknown",
          due: vehicle.due,
          remainingKm: vehicle.remainingKm,
          overdueKm: vehicle.overdueKm,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.status !== 0) throw new Error(data.cause || "Reset failed");
      await loadServiceVehicles();
      if (searchRan && activeTab !== "service") await runSearch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setResetting(null);
    }
  };

  const handleDownload = async (filename: string) => {
    const token = getAuthToken();
    if (!token) return;
    setDownloading(filename);
    setError(null);
    try {
      const url = `/api/mileage-reports/download?category=${activeTab}&file=${encodeURIComponent(filename)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.cause || `Download failed (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(null);
    }
  };

  const formatSize = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-6">
      {pendingReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
          <div className="bg-white rounded-lg shadow-2xl p-6 w-full max-w-md mx-4 flex flex-col items-center">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">
              {pendingReset.due ? "Service is due" : "Reset is not due"}
            </h2>
            <p className="text-sm text-gray-600 mb-4 text-center">
              {pendingReset.due
                ? `${pendingReset.devicename} is due${pendingReset.overdueKm > 0 ? ` by ${pendingReset.overdueKm.toFixed(0)} km` : ""}. Marking it serviced starts the counter again from ${pendingReset.odometerKm.toFixed(2)} km.`
                : `${pendingReset.devicename} is not due. ${pendingReset.remainingKm.toFixed(0)} km remain before the next service. Reset anyway overrides the counter and starts it again from ${pendingReset.odometerKm.toFixed(2)} km.`}
            </p>
            <div className="flex gap-3 w-full">
              <button
                type="button"
                onClick={confirmReset}
                className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
                  pendingReset.due
                    ? "bg-red-600 text-white hover:bg-red-700"
                    : "bg-amber-500 text-gray-900 hover:bg-amber-400"
                }`}
              >
                {pendingReset.due ? "Serviced" : "Reset anyway"}
              </button>
              <button
                type="button"
                onClick={() => setPendingReset(null)}
                className="flex-1 py-2 rounded-lg bg-gray-200 text-gray-700 font-medium hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Mileage Report</h2>
            <p className="text-sm text-gray-600 mt-1">
              Download saved mileage reports from local storage. Files are kept for{" "}
              <span className="font-medium text-gray-800">{retentionDays} days</span>.
            </p>
          </div>
          <button
            type="button"
            onClick={exportActivity}
            disabled={activityExporting}
            className="shrink-0 px-4 py-2 rounded-lg border border-gray-300 text-gray-900 text-sm font-medium hover:bg-gray-50 disabled:opacity-60"
          >
            {activityExporting ? "Exporting..." : "User activities"}
          </button>
        </div>

        <div className="border-b border-gray-200 mb-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("daily")}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg ${
                activeTab === "daily"
                  ? "bg-[#FFC107] text-gray-900"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              Daily Mileage Reports
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("monthly")}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg ${
                activeTab === "monthly"
                  ? "bg-[#FFC107] text-gray-900"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              Monthly Mileage Reports
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("service")}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg ${
                activeTab === "service"
                  ? "bg-[#FFC107] text-gray-900"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              Service counter
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm border border-red-200">{error}</div>
        )}

        {activeTab === "service" ? (
          <>
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-600 mb-1">Search IMEI or device name</label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="IMEI or device name"
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-[#FFC107] focus:border-[#FFC107]"
              />
              <p className="text-xs text-gray-500 mt-1">
                Search checks every vehicle in the list, including ones on the last page.
              </p>
            </div>
            <ServiceCounterTable
              query={searchQuery}
              vehicles={serviceVehicles.filter((vehicle) => {
                const query = searchQuery.trim().toLowerCase();
                if (!query) return true;
                return vehicle.devicename.toLowerCase().includes(query) || vehicle.deviceid.toLowerCase().includes(query);
              })}
              loading={serviceLoading}
              resetting={resetting}
              onReset={resetService}
            />
          </>
        ) : (
          <>
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-600 mb-1">Search IMEI or device name</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
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
            Search files looks through saved {activeTab === "daily" ? "daily" : "monthly"} Excel files and marks each file date.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Exact date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-[#FFC107] focus:border-[#FFC107]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-[#FFC107] focus:border-[#FFC107]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-[#FFC107] focus:border-[#FFC107]"
            />
          </div>
          <div className="flex items-end gap-2">
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
              onClick={() => {
                setDate("");
                setFrom("");
                setTo("");
                applyFilters();
              }}
              className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm hover:bg-gray-50"
            >
              Clear
            </button>
          </div>
        </div>

        {searchRan && (
          <div className="mb-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">
              Search results
              <span className="ml-2 font-normal text-gray-500">
                {matches.length} match{matches.length === 1 ? "" : "es"} in {filesSearched} file{filesSearched === 1 ? "" : "s"}
                {searchTruncated ? " (showing the first 400)" : ""}
              </span>
            </h3>
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">File date</th>
                    <th className="px-4 py-3 font-medium">Device name</th>
                    <th className="px-4 py-3 font-medium">IMEI</th>
                    <th className="px-4 py-3 font-medium">Odometer (km)</th>
                    <th className="px-4 py-3 font-medium">Since service</th>
                    <th className="px-4 py-3 font-medium">Remaining</th>
                    <th className="px-4 py-3 font-medium">Overdue</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium w-28"> </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {matches.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                        No vehicle matched that IMEI or name in the saved {activeTab} files.
                      </td>
                    </tr>
                  ) : (
                    matches.map((hit, index) => (
                      <tr key={`${hit.filename}-${hit.deviceid}-${index}`} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-900 font-medium whitespace-nowrap">
                          {activeTab === "monthly" && hit.reportDate
                            ? hit.reportDate.slice(0, 7)
                            : hit.reportDate || hit.filename}
                        </td>
                        <td className="px-4 py-3 text-gray-800">{hit.devicename || "—"}</td>
                        <td className="px-4 py-3 text-gray-700 font-mono text-xs">{hit.deviceid || "—"}</td>
                        <td className="px-4 py-3 text-gray-700">{hit.odometerKm || "—"}</td>
                        <td className="px-4 py-3 text-gray-700">{formatKm(hit.sinceServiceKm)}</td>
                        <td className="px-4 py-3 text-gray-700">{formatKm(hit.remainingKm)}</td>
                        <td className="px-4 py-3 text-gray-700">{formatKm(hit.overdueKm)}</td>
                        <td className="px-4 py-3"><StatusLabel status={hit.serviceStatus} /></td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => resetService(hit)}
                            disabled={resetting === hit.deviceid}
                            className={`px-3 py-1 rounded text-xs font-medium disabled:opacity-50 mr-3 ${serviceButtonClass(hit.serviceStatus, hit.hasReset)}`}
                          >
                            {resetting === hit.deviceid ? "..." : serviceButtonLabel(hit.serviceStatus, hit.hasReset)}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownload(hit.filename)}
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

        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-4 py-3 font-medium">File</th>
                <th className="px-4 py-3 font-medium">Report date</th>
                <th className="px-4 py-3 font-medium">Size</th>
                <th className="px-4 py-3 font-medium">Modified</th>
                <th className="px-4 py-3 font-medium w-32"> </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {files.length === 0 && !loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                    No mileage reports match your filters.
                  </td>
                </tr>
              ) : (
                files.map((f) => (
                  <tr key={f.filename} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-900 font-mono text-xs break-all">{f.filename}</td>
                    <td className="px-4 py-3 text-gray-700">{f.reportDate || "—"}</td>
                    <td className="px-4 py-3 text-gray-700">{formatSize(f.size)}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{new Date(f.modifiedAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleDownload(f.filename)}
                        disabled={downloading === f.filename}
                        className="text-[#FFC107] hover:text-yellow-600 font-medium text-xs disabled:opacity-50"
                      >
                        {downloading === f.filename ? "..." : "Download"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
          </>
        )}
      </div>
    </div>
  );
}

function serviceButtonClass(status: string, hasReset: boolean) {
  if (status === "overdue" || status === "due") return "bg-red-600 text-white hover:bg-red-700";
  if (status === "almost") return "bg-amber-500 text-gray-900 hover:bg-amber-400";
  if (hasReset) return "bg-green-600 text-white hover:bg-green-700";
  return "bg-gray-200 text-gray-800 hover:bg-gray-300";
}

function serviceButtonLabel(status: string, hasReset: boolean) {
  if (status === "overdue" || status === "due") return "Due";
  if (status === "almost") return "Almost";
  if (hasReset) return "Serviced";
  return "Reset";
}

function formatKm(value: number) {
  return Number.isFinite(value) ? value.toFixed(0) : "—";
}

function StatusLabel({ status }: { status: string }) {
  const label = status === "almost" ? "Almost due" : status === "due" ? "Due" : status === "overdue" ? "Overdue" : "OK";
  const tone =
    status === "overdue" || status === "due"
      ? "bg-red-100 text-red-800"
      : status === "almost"
        ? "bg-amber-100 text-amber-900"
        : "bg-green-100 text-green-800";
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${tone}`}>{label}</span>;
}

const SERVICE_PAGE_SIZES = [5, 10, 50, 200, 500];

function ServiceCounterTable({
  query,
  vehicles,
  loading,
  resetting,
  onReset,
}: {
  query: string;
  vehicles: ServiceVehicle[];
  loading: boolean;
  resetting: string | null;
  onReset: (vehicle: ServiceVehicle) => void;
}) {
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(vehicles.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const start = vehicles.length === 0 ? 0 : (safePage - 1) * pageSize;
  const rows = vehicles.slice(start, start + pageSize);

  useEffect(() => {
    setPage(1);
  }, [query, pageSize]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  return (
    <div className="mb-6">
      <h3 className="text-sm font-semibold text-gray-900">Service counter</h3>
      <p className="text-xs text-gray-500 mt-1 mb-2">
        Green: serviced. Amber: almost due. Red: due. Grey: not marked yet.
      </p>
      <div className="rounded-lg border border-gray-200 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-4 py-3 font-medium">Vehicle</th>
              <th className="px-4 py-3 font-medium">IMEI</th>
              <th className="px-4 py-3 font-medium">Odometer</th>
              <th className="px-4 py-3 font-medium">As of</th>
              <th className="px-4 py-3 font-medium">Since service</th>
              <th className="px-4 py-3 font-medium">Remaining</th>
              <th className="px-4 py-3 font-medium">Overdue</th>
              <th className="px-4 py-3 font-medium">Next service</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium w-24"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-gray-500">Loading service counters...</td>
              </tr>
            ) : vehicles.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-gray-500">No saved mileage rows match.</td>
              </tr>
            ) : (
              rows.map((vehicle) => (
                <tr key={vehicle.deviceid} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900">{vehicle.devicename}</td>
                  <td className="px-4 py-3 text-gray-700 font-mono text-xs">{vehicle.deviceid}</td>
                  <td className="px-4 py-3 text-gray-700">{vehicle.odometerKm.toFixed(2)}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{vehicle.reportDate || "—"}</td>
                  <td className="px-4 py-3 text-gray-700">{formatKm(vehicle.sinceServiceKm)}</td>
                  <td className="px-4 py-3 text-gray-700">{formatKm(vehicle.remainingKm)}</td>
                  <td className="px-4 py-3 text-gray-700">{formatKm(vehicle.overdueKm)}</td>
                  <td className="px-4 py-3 text-gray-700">{formatKm(vehicle.nextServiceKm)}</td>
                  <td className="px-4 py-3"><StatusLabel status={vehicle.status} /></td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => onReset(vehicle)}
                      disabled={resetting === vehicle.deviceid}
                      className={`px-3 py-1 rounded text-xs font-medium disabled:opacity-50 ${serviceButtonClass(vehicle.status, vehicle.hasReset)}`}
                    >
                      {resetting === vehicle.deviceid ? "..." : serviceButtonLabel(vehicle.status, vehicle.hasReset)}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-xs text-gray-500">
          {vehicles.length === 0
            ? "0 vehicles"
            : `Showing ${start + 1}–${Math.min(start + rows.length, vehicles.length)} of ${vehicles.length}`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="service-page-size" className="text-xs text-gray-600">Rows</label>
          <select
            id="service-page-size"
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            className="px-2 py-1 rounded-lg border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-[#FFC107] focus:border-[#FFC107]"
          >
            {SERVICE_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={safePage <= 1}
            className="px-3 py-1 rounded-lg border border-gray-200 text-gray-700 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-xs text-gray-600">Page {safePage} of {pageCount}</span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            disabled={safePage >= pageCount}
            className="px-3 py-1 rounded-lg border border-gray-200 text-gray-700 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
