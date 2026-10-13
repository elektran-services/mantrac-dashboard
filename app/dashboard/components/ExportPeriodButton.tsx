"use client";

import { useState } from "react";
import { getAuthToken } from "@/lib/auth";

type ReportSource = "parking" | "trips" | "overspeed" | "offline" | "mileage";

export default function ExportPeriodButton({
  source,
  category,
  date,
  from,
  to,
  query,
  startTime = "00:00",
  endTime = "23:59",
  onError,
}: {
  source: ReportSource;
  category?: "daily" | "monthly";
  date: string;
  from: string;
  to: string;
  query?: string;
  startTime?: string;
  endTime?: string;
  onError: (message: string) => void;
}) {
  const [exporting, setExporting] = useState(false);

  const exportCsv = async () => {
    const text = query?.trim() || "";
    if (text && text.length < 2) {
      onError("Enter at least 2 characters of an IMEI or device name.");
      return;
    }
    if (!date.trim() && !from.trim() && !to.trim()) {
      onError("Choose a date or a from and to period before exporting.");
      return;
    }
    const token = getAuthToken();
    if (!token) return;
    setExporting(true);
    try {
      const res = await fetch("/api/report-export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          token,
          source,
          ...(category ? { category } : {}),
          ...(date.trim() ? { date: date.trim() } : {}),
          ...(from.trim() ? { from: from.trim() } : {}),
          ...(to.trim() ? { to: to.trim() } : {}),
          ...(text ? { query: text } : {}),
          startTime,
          endTime,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        onError(err.cause || `Export failed (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = match?.[1] || `${source}_report.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <button
      type="button"
      onClick={exportCsv}
      disabled={exporting}
      className="px-4 py-2 rounded-lg border border-gray-300 text-gray-900 font-medium text-sm hover:bg-gray-50 disabled:opacity-50"
    >
      {exporting ? "Exporting..." : "Export CSV"}
    </button>
  );
}
