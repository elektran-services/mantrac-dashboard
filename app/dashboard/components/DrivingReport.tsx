'use client';

import { useEffect, useState } from 'react';
import { getAuthToken } from '@/lib/auth';

interface DriveRow {
  deviceid: string;
  devicename: string;
  startMs: number;
  endMs: number;
  durationMin: number;
  distanceKm: number;
  startMileageKm: number | null;
  endMileageKm: number | null;
  maxSpeedKmh: number;
  avgSpeedKmh: number;
  startAddress: string;
  endAddress: string;
  startLat: number | null;
  startLon: number | null;
  endLat: number | null;
  endLon: number | null;
  reportDate: string;
}

async function postDrivingReport(body: Record<string, unknown>) {
  const token = getAuthToken();
  if (!token) throw new Error('Not logged in.');
  const res = await fetch('/api/driving-report', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ token, ...body }),
  });
  const data = await res.json();
  if (!res.ok || data.status !== 0) {
    throw new Error(data.cause || 'Failed to load driving report');
  }
  return data as {
    drives?: DriveRow[];
    missingDates?: string[];
    earliestReportDate?: string | null;
    latestReportDate?: string | null;
    fileCount?: number;
  };
}

export default function DrivingReport() {
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('00:00');
  const [endDate, setEndDate] = useState('');
  const [endTime, setEndTime] = useState('23:59');
  const [earliestReportDate, setEarliestReportDate] = useState<string | null>(null);
  const [latestReportDate, setLatestReportDate] = useState<string | null>(null);
  const [fileCount, setFileCount] = useState(0);
  const [drives, setDrives] = useState<DriveRow[]>([]);
  const [missingDates, setMissingDates] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError('');
      try {
        const data = await postDrivingReport({ mode: 'devices' });
        if (cancelled) return;
        setFileCount(data.fileCount || 0);
        setEarliestReportDate(data.earliestReportDate ?? null);
        setLatestReportDate(data.latestReportDate ?? null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load saved trips');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchDrivingReport = async () => {
    const text = searchQuery.trim();
    if (text && text.length < 2) {
      setError('Enter at least 2 characters of an IMEI or device name.');
      return;
    }
    if (!startDate || !endDate) {
      setError('Choose a from and to period.');
      return;
    }

    setLoading(true);
    setError('');
    setLoaded(false);
    setDrives([]);
    setMissingDates([]);

    try {
      const data = await postDrivingReport({
        mode: 'report',
        ...(text ? { query: text } : {}),
        from: startDate,
        to: endDate,
        startTime,
        endTime,
      });
      setDrives(data.drives || []);
      setMissingDates(data.missingDates || []);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load driving report');
    } finally {
      setLoading(false);
    }
  };

  const formatDay = (iso: string) => {
    const [year, month, day] = iso.split('-').map(Number);
    if (!year || !month || !day) return iso;
    return new Date(year, month - 1, day).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const coverageText = (days: number, earliest: string | null, latest: string | null) => {
    if (days <= 0 || !latest) return 'No trip records yet.';
    if (!earliest || earliest === latest) return `Records for ${formatDay(latest)}.`;
    return `Records from ${formatDay(earliest)} to ${formatDay(latest)}.`;
  };

  const formatDuration = (minutes: number) => {
    const total = Math.round(minutes);
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    if (hours === 0) return `${mins}m`;
    return `${hours}h ${mins}m`;
  };

  const formatDateTime = (timestamp: number) =>
    new Date(timestamp).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const place = (address: string) => address.trim() || '—';

  const formatKm = (value: number | null) => (value == null ? '—' : value.toFixed(2));

  const coordText = (lat: number | null, lon: number | null) =>
    lat == null || lon == null ? '—' : `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

  const totalDistanceKm = drives.reduce((sum, row) => sum + row.distanceKm, 0);
  const totalDurationMin = drives.reduce((sum, row) => sum + row.durationMin, 0);
  const maxSpeedKmh = drives.reduce((max, row) => Math.max(max, row.maxSpeedKmh), 0);
  const exportToCSV = () => {
    if (drives.length === 0) return;
    const headers = [
      'Name',
      'Start date/time',
      'End date/time',
      'Travel time',
      'Start mileage',
      'End mileage',
      'Mileage',
      'Start location',
      'End location',
      'Max speed',
      'Start coordinate',
      'End coordinate',
    ];
    const rows = drives.map((drive) => [
      drive.devicename,
      formatDateTime(drive.startMs),
      formatDateTime(drive.endMs),
      formatDuration(drive.durationMin),
      formatKm(drive.startMileageKm),
      formatKm(drive.endMileageKm),
      drive.distanceKm.toFixed(2),
      place(drive.startAddress),
      place(drive.endAddress),
      drive.maxSpeedKmh.toFixed(1),
      coordText(drive.startLat, drive.startLon),
      coordText(drive.endLat, drive.endLon),
    ]);
    const csvContent = [headers.join(','), ...rows.map((row) => row.map((cell) => `"${cell}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const slug = searchQuery.trim().replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(0, 40);
    const range = startDate === endDate ? startDate : `${startDate}_to_${endDate}`;
    a.download = `driving_report_${range}${slug ? `_${slug}` : ''}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-sm p-6">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900">Driving Report</h2>
          <p className="text-sm text-gray-600 mt-1">
            {coverageText(fileCount, earliestReportDate, latestReportDate)}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 mb-2">
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">Search IMEI or device name</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') fetchDrivingReport();
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
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-[#FFC107] focus:border-[#FFC107]"
              />
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-28 px-3 py-2 rounded-lg border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-[#FFC107] focus:border-[#FFC107]"
              />
            </div>
          </div>
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-[#FFC107] focus:border-[#FFC107]"
              />
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-28 px-3 py-2 rounded-lg border border-gray-200 text-gray-900 text-sm focus:ring-2 focus:ring-[#FFC107] focus:border-[#FFC107]"
              />
            </div>
          </div>
          <div className="md:col-span-3 flex items-end gap-2">
            <button
              type="button"
              onClick={fetchDrivingReport}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-[#FFC107] text-gray-900 font-medium text-sm hover:bg-yellow-400 disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Apply filters'}
            </button>
            <button
              type="button"
              onClick={exportToCSV}
              disabled={drives.length === 0}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-900 font-medium text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setStartDate('');
                setStartTime('00:00');
                setEndDate('');
                setEndTime('23:59');
                setDrives([]);
                setMissingDates([]);
                setLoaded(false);
                setError('');
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
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded">
          <p className="text-xs">{error}</p>
        </div>
      )}

      {missingDates.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 rounded">
          <p className="text-xs">No saved trip file for {missingDates.join(', ')}.</p>
        </div>
      )}

      {!loading && loaded && drives.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 px-3 py-2 rounded">
          <p className="text-xs">
            <span className="font-semibold">{searchQuery.trim() || 'All vehicles'}</span> —{' '}
            <span className="font-semibold">{drives.length}</span> drive{drives.length === 1 ? '' : 's'},{' '}
            <span className="font-semibold">{formatDuration(totalDurationMin)}</span> moving,{' '}
            <span className="font-semibold">{totalDistanceKm.toFixed(2)} km</span>, max speed{' '}
            <span className="font-semibold">{maxSpeedKmh.toFixed(1)} km/h</span>
          </p>
        </div>
      )}

      {!loading && drives.length > 0 && (
        <div className="bg-white rounded shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Name</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Start date/time</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">End date/time</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Travel time</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Start mileage</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">End mileage</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Mileage</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Start location</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">End location</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Max speed</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Start coordinate</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">End coordinate</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {drives.map((drive, index) => (
                  <tr key={`${drive.startMs}-${index}`} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2 text-xs text-gray-900">{drive.devicename}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">{formatDateTime(drive.startMs)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">{formatDateTime(drive.endMs)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">{formatDuration(drive.durationMin)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-900">{formatKm(drive.startMileageKm)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-900">{formatKm(drive.endMileageKm)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-900">{drive.distanceKm.toFixed(2)}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      <div className="max-w-xs truncate" title={place(drive.startAddress)}>{place(drive.startAddress)}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      <div className="max-w-xs truncate" title={place(drive.endAddress)}>{place(drive.endAddress)}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-900 font-medium">{drive.maxSpeedKmh.toFixed(1)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs"><MapPoint lat={drive.startLat} lon={drive.startLon} /></td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs"><MapPoint lat={drive.endLat} lon={drive.endLon} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && loaded && drives.length === 0 && (
        <div className="bg-white rounded shadow-sm p-8 text-center">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">No drives found</h3>
          <p className="text-xs text-gray-600">
            {searchQuery.trim()
              ? 'No vehicle matched that IMEI or name in the selected period.'
              : 'No saved movement in the selected period.'}
          </p>
        </div>
      )}
    </div>
  );
}

function MapPoint({ lat, lon }: { lat: number | null; lon: number | null }) {
  if (lat == null || lon == null) return <span className="text-gray-400">—</span>;
  return (
    <a
      href={`https://www.google.com/maps?q=${lat},${lon}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-700 underline"
    >
      {lat.toFixed(5)}, {lon.toFixed(5)}
    </a>
  );
}
