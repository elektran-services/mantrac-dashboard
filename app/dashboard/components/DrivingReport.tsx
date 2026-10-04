'use client';

import { useEffect, useMemo, useState } from 'react';
import { getAuthToken } from '@/lib/auth';

interface Device {
  deviceid: string;
  name: string;
}

interface DriveRow {
  deviceid: string;
  devicename: string;
  startMs: number;
  endMs: number;
  durationMin: number;
  distanceKm: number;
  maxSpeedKmh: number;
  avgSpeedKmh: number;
  startAddress: string;
  endAddress: string;
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
    devices?: Device[];
    drives?: DriveRow[];
    missingDates?: string[];
    earliestReportDate?: string | null;
    latestReportDate?: string | null;
    fileCount?: number;
  };
}

export default function DrivingReport() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDevice, setSelectedDevice] = useState('');
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
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingDevices(true);
      setError('');
      try {
        const data = await postDrivingReport({ mode: 'devices' });
        if (cancelled) return;
        setDevices(data.devices || []);
        setFileCount(data.fileCount || 0);
        setEarliestReportDate(data.earliestReportDate ?? null);
        setLatestReportDate(data.latestReportDate ?? null);
        if (data.latestReportDate) {
          setStartDate(data.latestReportDate);
          setEndDate(data.latestReportDate);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load saved trips');
      } finally {
        if (!cancelled) setLoadingDevices(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredDevices = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return devices;
    return devices.filter(
      (device) => device.name.toLowerCase().includes(query) || device.deviceid.toLowerCase().includes(query)
    );
  }, [devices, searchQuery]);

  const fetchDrivingReport = async () => {
    if (!selectedDevice) {
      setError('Please select a vehicle');
      return;
    }
    if (!startDate || !endDate) {
      setError('Start and end dates are required');
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
        deviceid: selectedDevice,
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

  const place = (address: string) => address.trim() || 'Address not available';

  const totalDistanceKm = drives.reduce((sum, row) => sum + row.distanceKm, 0);
  const totalDurationMin = drives.reduce((sum, row) => sum + row.durationMin, 0);
  const maxSpeedKmh = drives.reduce((max, row) => Math.max(max, row.maxSpeedKmh), 0);
  const selectedName = devices.find((device) => device.deviceid === selectedDevice)?.name;

  const exportToCSV = () => {
    if (drives.length === 0) return;
    const headers = [
      'Drive #',
      'Vehicle',
      'Start',
      'End',
      'Duration',
      'Distance (km)',
      'Max Speed (km/h)',
      'Avg Speed (km/h)',
      'Start Location',
      'End Location',
    ];
    const rows = drives.map((drive, index) => [
      String(index + 1),
      drive.devicename,
      formatDateTime(drive.startMs),
      formatDateTime(drive.endMs),
      formatDuration(drive.durationMin),
      drive.distanceKm.toFixed(2),
      drive.maxSpeedKmh.toFixed(1),
      drive.avgSpeedKmh.toFixed(1),
      place(drive.startAddress),
      place(drive.endAddress),
    ]);
    const csvContent = [headers.join(','), ...rows.map((row) => row.map((cell) => `"${cell}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `driving-report-${selectedDevice}-${startDate}-to-${endDate}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Driving Report</h2>
          <p className="text-sm text-gray-600 mt-0.5">
            {coverageText(fileCount, earliestReportDate, latestReportDate)}
          </p>
        </div>
        <button
          onClick={exportToCSV}
          disabled={drives.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[#FFC107] text-gray-900 rounded hover:bg-[#FFD54F] transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
        >
          Export CSV
        </button>
      </div>

      <div className="bg-white rounded shadow-sm p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Filters</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Search vehicle or IMEI</label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search vehicles..."
              className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#FFC107] text-gray-900 placeholder:text-gray-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Vehicle {!searchQuery && devices.length > 0 && <span className="text-gray-500">({devices.length})</span>}
            </label>
            <select
              value={selectedDevice}
              onChange={(e) => setSelectedDevice(e.target.value)}
              disabled={loadingDevices || filteredDevices.length === 0}
              className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#FFC107] text-gray-900 disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              <option value="">
                {loadingDevices ? 'Loading saved vehicles...' : filteredDevices.length === 0 ? 'No saved vehicles' : 'Select a vehicle'}
              </option>
              {filteredDevices.map((device) => (
                <option key={device.deviceid} value={device.deviceid}>
                  {device.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Start</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="flex-1 px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#FFC107] text-gray-900"
              />
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-24 px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#FFC107] text-gray-900"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">End</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="flex-1 px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#FFC107] text-gray-900"
              />
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-24 px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#FFC107] text-gray-900"
              />
            </div>
          </div>
        </div>
        <div className="mt-3">
          <button
            onClick={fetchDrivingReport}
            disabled={loading || loadingDevices || !selectedDevice}
            className="px-4 py-1.5 text-sm bg-[#FFC107] text-gray-900 rounded hover:bg-[#FFD54F] transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
          >
            {loading ? 'Loading...' : 'Generate Report'}
          </button>
        </div>
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
            {selectedName ? <span className="font-semibold">{selectedName}</span> : 'Vehicle'} —{' '}
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
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">#</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Start</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">End</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Duration</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Distance</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Max speed</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Avg speed</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">Start location</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase">End location</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {drives.map((drive, index) => (
                  <tr key={`${drive.startMs}-${index}`} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-900 font-medium">{index + 1}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">{formatDateTime(drive.startMs)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">{formatDateTime(drive.endMs)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">{formatDuration(drive.durationMin)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-900">{drive.distanceKm.toFixed(2)} km</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-900 font-medium">{drive.maxSpeedKmh.toFixed(1)} km/h</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600">{drive.avgSpeedKmh.toFixed(1)} km/h</td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      <div className="max-w-xs truncate" title={place(drive.startAddress)}>{place(drive.startAddress)}</div>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      <div className="max-w-xs truncate" title={place(drive.endAddress)}>{place(drive.endAddress)}</div>
                    </td>
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
          <p className="text-xs text-gray-600">No saved movement for this vehicle in the selected period.</p>
        </div>
      )}
    </div>
  );
}
