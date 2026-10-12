'use client';

import { useEffect, useState } from 'react';
import { getAuthToken } from '@/lib/auth';
import ExportPeriodButton from './ExportPeriodButton';

type ReportFile = {
  filename: string;
  size: number;
  modifiedAt: string;
  reportDate: string | null;
};

type SearchHit = {
  filename: string;
  reportDate: string | null;
  deviceid: string;
  devicename: string;
  fields: Record<string, string>;
};

const MATCH_COLUMNS = [
  { key: 'lastUpdate', label: 'Last update' },
  { key: 'offlineDuration', label: 'Offline duration' },
  { key: 'lastLocation', label: 'Last location' },
  { key: 'status', label: 'Status' },
];

async function fetchOfflineReportsList(filters: { from?: string; to?: string }) {
  const token = getAuthToken();
  if (!token) throw new Error('Not logged in.');
  const res = await fetch('/api/offline-reports', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      token,
      ...(filters.from?.trim() ? { from: filters.from.trim() } : {}),
      ...(filters.to?.trim() ? { to: filters.to.trim() } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok || data.status !== 0) {
    throw new Error(data.cause || 'Failed to load offline reports');
  }
  return data as { files: ReportFile[]; retentionDays?: number };
}

async function searchOffline(filters: { query: string; from?: string; to?: string }) {
  const token = getAuthToken();
  if (!token) throw new Error('Not logged in.');
  const res = await fetch('/api/report-search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      token,
      source: 'offline',
      query: filters.query,
      ...(filters.from?.trim() ? { from: filters.from.trim() } : {}),
      ...(filters.to?.trim() ? { to: filters.to.trim() } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok || data.status !== 0) throw new Error(data.cause || 'Search failed');
  return data as { matches: SearchHit[]; filesSearched: number; truncated?: boolean };
}

export default function OfflineReport() {
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [files, setFiles] = useState<ReportFile[]>([]);
  const [matches, setMatches] = useState<SearchHit[]>([]);
  const [filesSearched, setFilesSearched] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [showingMatches, setShowingMatches] = useState(false);
  const [retentionDays, setRetentionDays] = useState(365);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const loadFiles = async (filters: { from?: string; to?: string }) => {
    const data = await fetchOfflineReportsList(filters);
    setFiles(data.files || []);
    setMatches([]);
    setShowingMatches(false);
    if (typeof data.retentionDays === 'number') setRetentionDays(data.retentionDays);
  };

  const applyFilters = async () => {
    const text = query.trim();
    if (text && text.length < 2) {
      setError('Enter at least 2 characters of an IMEI or device name.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (text) {
        const data = await searchOffline({ query: text, from, to });
        setMatches(data.matches || []);
        setFilesSearched(data.filesSearched || 0);
        setTruncated(Boolean(data.truncated));
        setShowingMatches(true);
      } else {
        await loadFiles({ from, to });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
      setFiles([]);
      setMatches([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchOfflineReportsList({});
        if (!cancelled) {
          setFiles(data.files || []);
          if (typeof data.retentionDays === 'number') setRetentionDays(data.retentionDays);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Request failed');
          setFiles([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDownload = async (filename: string) => {
    const token = getAuthToken();
    if (!token) return;
    setDownloading(filename);
    setError(null);
    try {
      const url = `/api/offline-reports/download?file=${encodeURIComponent(filename)}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.cause || `Download failed (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
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
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900">Offline Devices</h2>
          <p className="text-sm text-gray-600 mt-1">
            Download scheduled offline device reports from local storage. Files are kept for{' '}
            <span className="font-medium text-gray-800">{retentionDays} days</span>.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mb-2">
          <div className="md:col-span-4">
            <label className="block text-xs font-medium text-gray-600 mb-1">Search IMEI or device name</label>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyFilters();
              }}
              placeholder="IMEI or device name"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-[#FFC107] focus:border-[#FFC107]"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-[#FFC107] focus:border-[#FFC107]"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-[#FFC107] focus:border-[#FFC107]"
            />
          </div>
          <div className="md:col-span-4 flex items-end gap-2">
            <button
              type="button"
              onClick={applyFilters}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-[#FFC107] text-gray-900 font-medium text-sm hover:bg-yellow-400 disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Apply filters'}
            </button>
            <ExportPeriodButton source="offline" date="" from={from} to={to} query={query} onError={setError} />
            <button
              type="button"
              onClick={async () => {
                setQuery('');
                setFrom('');
                setTo('');
                setLoading(true);
                setError(null);
                try {
                  await loadFiles({});
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Request failed');
                  setFiles([]);
                } finally {
                  setLoading(false);
                }
              }}
              className="px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm hover:bg-gray-50"
            >
              Clear
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500 mb-4">
          Leave the search empty for every vehicle. Type an IMEI or device name to show only that vehicle. From and To limit the days. Use the same dates in both for one day.
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm border border-red-200">{error}</div>
        )}

        {showingMatches ? (
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">
              Search results
              <span className="ml-2 font-normal text-gray-500">
                {matches.length} match{matches.length === 1 ? '' : 'es'} in {filesSearched} file{filesSearched === 1 ? '' : 's'}
                {truncated ? ' (showing the first 400)' : ''}
              </span>
            </h3>
            <div className="rounded-lg border border-gray-200 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">File date</th>
                    <th className="px-4 py-3 font-medium">Device name</th>
                    <th className="px-4 py-3 font-medium">IMEI</th>
                    {MATCH_COLUMNS.map((column) => (
                      <th key={column.key} className="px-4 py-3 font-medium">{column.label}</th>
                    ))}
                    <th className="px-4 py-3 font-medium w-24"> </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {matches.length === 0 ? (
                    <tr>
                      <td colSpan={4 + MATCH_COLUMNS.length} className="px-4 py-8 text-center text-gray-500">
                        No vehicle matched that IMEI or name in the saved files.
                      </td>
                    </tr>
                  ) : (
                    matches.map((hit, index) => (
                      <tr key={`${hit.filename}-${hit.deviceid}-${index}`} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-900 font-medium whitespace-nowrap">{hit.reportDate || hit.filename}</td>
                        <td className="px-4 py-3 text-gray-800">{hit.devicename || '—'}</td>
                        <td className="px-4 py-3 text-gray-700 font-mono text-xs">{hit.deviceid || '—'}</td>
                        {MATCH_COLUMNS.map((column) => (
                          <td key={column.key} className="px-4 py-3 text-gray-700">{hit.fields[column.key] || '—'}</td>
                        ))}
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => handleDownload(hit.filename)}
                            disabled={downloading === hit.filename}
                            className="text-[#FFC107] hover:text-yellow-600 font-medium text-xs disabled:opacity-50"
                          >
                            {downloading === hit.filename ? '...' : 'Download'}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
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
                    No offline reports match your filters.
                  </td>
                </tr>
              ) : (
                files.map((f) => (
                  <tr key={f.filename} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-900 font-mono text-xs break-all">{f.filename}</td>
                    <td className="px-4 py-3 text-gray-700">{f.reportDate || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{formatSize(f.size)}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{new Date(f.modifiedAt).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleDownload(f.filename)}
                        disabled={downloading === f.filename}
                        className="text-[#FFC107] hover:text-yellow-600 font-medium text-xs disabled:opacity-50"
                      >
                        {downloading === f.filename ? '...' : 'Download'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>
    </div>
  );
}
