'use client';

import { useState, useEffect } from 'react';
import { getAuthToken, getUserData } from '@/lib/auth';
import { apiCallWithAutoRefresh } from '@/lib/utils';

interface Device {
  deviceid: string;
  name: string;
  groupid?: string;
}

interface ParkingRecord {
  starttime: number;
  endtime: number;
  durationidle?: number;
  callat: number;
  callon: number;
  address?: string;
}

interface ParkingData {
  status: number;
  cause: string;
  records: ParkingRecord[];
}

export default function ParkingReport() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [filteredDevices, setFilteredDevices] = useState<Device[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [minInterval, setMinInterval] = useState<number>(5);
  const [parkingData, setParkingData] = useState<ParkingData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [loadingDevices, setLoadingDevices] = useState(true);

  useEffect(() => {
    fetchDevices();
  }, []);

  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredDevices(devices);
    } else {
      const query = searchQuery.toLowerCase();
      const filtered = devices.filter(
        (device) =>
          device.name.toLowerCase().includes(query) ||
          device.deviceid.toLowerCase().includes(query)
      );
      setFilteredDevices(filtered);
    }
  }, [searchQuery, devices]);

  const fetchDevices = async () => {
    setLoadingDevices(true);
    try {
      const token = getAuthToken();
      const userData = getUserData();
      
      if (!userData?.username) {
        setError('User data not found');
        setLoadingDevices(false);
        return;
      }

      const data = await apiCallWithAutoRefresh('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username: userData.username, 
          token 
        }),
      });
      
      if (data.status === 0 && data.groups) {
        const allDevices = data.groups.flatMap((group: any) =>
          (group.devices || []).map((device: any) => ({
            deviceid: device.deviceid,
            name: device.devicename || device.deviceid,
            groupid: group.groupid
          }))
        );
        setDevices(allDevices);
        setFilteredDevices(allDevices);
      } else {
        setError('Failed to load devices: ' + (data.cause || 'Unknown error'));
      }
    } catch (err) {
      console.error('Error fetching devices:', err);
      setError('Failed to load devices');
    } finally {
      setLoadingDevices(false);
    }
  };

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  const formatDateForAPI = (dateString: string) => {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  const fetchParkingReport = async () => {
    if (!selectedDevice) {
      setError('Please select a device');
      return;
    }

    if (!startDate || !endDate) {
      setError('Please select start and end dates');
      return;
    }

    setLoading(true);
    setError('');
    setParkingData(null);

    try {
      const token = getAuthToken();
      const begintime = formatDateForAPI(startDate);
      const endtime = formatDateForAPI(endDate);

      const data = await apiCallWithAutoRefresh('/api/parking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceid: selectedDevice,
          begintime,
          endtime,
          timezone: 8,
          interval: minInterval,
          token
        }),
      });

      if (data.status === 0) {
        console.log('Parking API Response:', data);
        if (data.records && data.records.length > 0) {
          console.log('First parking record:', data.records[0]);
        }
        setParkingData(data);
      } else {
        const errorMsg = data.cause || data.details || 'Failed to fetch parking data';
        setError(errorMsg);
        console.error('API Error:', data);
      }
    } catch (err) {
      console.error('Error fetching parking report:', err);
      if (err instanceof Error) {
        if (err.name === 'AbortError' || err.message.includes('timeout')) {
          setError('Request timeout - please try a shorter date range');
        } else if (err.message.includes('fetch') || err.message.includes('network')) {
          setError('Network error - please check your connection');
        } else {
          setError(`Error: ${err.message}`);
        }
      } else {
        setError('Failed to load parking report');
      }
    } finally {
      setLoading(false);
    }
  };

  const formatDateTime = (timestamp: number) => {
    if (!timestamp || isNaN(timestamp)) return 'Invalid date';
    try {
      return new Date(timestamp).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (err) {
      return 'Invalid date';
    }
  };
  const calculateDuration = (starttime: number, endtime: number): number => {
    // Duration in minutes
    return Math.floor((endtime - starttime) / (1000 * 60));
  };
  const formatDuration = (minutes: number) => {
    if (minutes < 60) {
      return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours < 24) {
      return `${hours}h ${mins}m`;
    }
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h ${mins}m`;
  };

  const exportToCSV = () => {
    if (!parkingData || !parkingData.records) return;

    const selectedDeviceData = devices.find(d => d.deviceid === selectedDevice);
    const deviceName = selectedDeviceData?.name || selectedDevice;

    const headers = [
      'Device',
      'Start Time',
      'End Time',
      'Duration (minutes)',
      'Location',
      'Coordinates'
    ];

    const rows = parkingData.records.map(record => {
      const duration = calculateDuration(record.starttime, record.endtime);
      return [
        deviceName,
        formatDateTime(record.starttime),
        formatDateTime(record.endtime),
        duration.toString(),
        record.address || 'Address not available',
        `${record.callat.toFixed(6)}, ${record.callon.toFixed(6)}`
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `parking-report-${deviceName}-${startDate}-to-${endDate}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Parking Report</h2>
          <p className="text-sm text-gray-600 mt-0.5">View parking events and durations by device</p>
        </div>
        <button
          onClick={exportToCSV}
          disabled={!parkingData || !parkingData.records || parkingData.records.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[#FFC107] text-gray-900 rounded hover:bg-[#FFD54F] transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded shadow-sm p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Filters</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          {/* Search */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Search Device
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={handleSearch}
              placeholder="Search by name or IMEI"
              className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#FFC107] text-gray-900"
            />
          </div>

          {/* Device Selector */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Select Device
            </label>
            <select
              value={selectedDevice}
              onChange={(e) => setSelectedDevice(e.target.value)}
              disabled={loadingDevices}
              className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#FFC107] text-gray-900 disabled:bg-gray-100"
            >
              <option value="">Select a device</option>
              {filteredDevices.map((device) => (
                <option key={device.deviceid} value={device.deviceid}>
                  {device.name} ({device.deviceid})
                </option>
              ))}
            </select>
          </div>

          {/* Start Date */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Start Date/Time
            </label>
            <input
              type="datetime-local"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#FFC107] text-gray-900"
            />
          </div>

          {/* End Date */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              End Date/Time
            </label>
            <input
              type="datetime-local"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#FFC107] text-gray-900"
            />
          </div>

          {/* Min Interval */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Min Duration (minutes)
            </label>
            <input
              type="number"
              value={minInterval}
              onChange={(e) => setMinInterval(Number(e.target.value))}
              min="0"
              placeholder="5"
              className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#FFC107] text-gray-900"
            />
          </div>
        </div>

        {/* Generate Button */}
        <div className="mt-3">
          <button
            onClick={fetchParkingReport}
            disabled={loading || !selectedDevice || !startDate || !endDate}
            className="px-4 py-1.5 text-sm bg-[#FFC107] text-gray-900 rounded hover:bg-[#FFD54F] transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
          >
            {loading ? 'Loading...' : 'Generate Report'}
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded">
          <p className="text-xs font-medium">Error</p>
          <p className="text-xs">{error}</p>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="bg-white rounded shadow-sm p-8">
          <div className="flex flex-col items-center justify-center">
            <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-[#FFC107] mb-3"></div>
            <p className="text-sm text-gray-600">Loading parking data...</p>
            <p className="text-xs text-gray-500 mt-1">This may take a moment for large date ranges</p>
          </div>
        </div>
      )}

      {/* Summary */}
      {!loading && parkingData && parkingData.records && (
        <div className="bg-white rounded shadow-sm p-3">
          <p className="text-xs text-gray-700">
            Found <span className="font-semibold text-[#FFC107]">{parkingData.records.length}</span> parking event{parkingData.records.length !== 1 ? 's' : ''}
            {minInterval > 0 && ` (minimum ${minInterval} minutes)`}
          </p>
          {parkingData.records.length > 50 && (
            <p className="text-xs text-gray-500 mt-1">
              <svg className="w-3 h-3 inline mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              Addresses loaded for first 50 records to ensure fast loading
            </p>
          )}
        </div>
      )}

      {/* Parking Records Table */}
      {!loading && parkingData && parkingData.records && parkingData.records.length > 0 && (
        <div className="bg-white rounded shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Start Time</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">End Time</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Duration</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Location</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Coordinates</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {parkingData.records.map((record, index) => {
                  const duration = calculateDuration(record.starttime, record.endtime);
                  return (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <div className="text-xs text-gray-900">{formatDateTime(record.starttime)}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-xs text-gray-900">{formatDateTime(record.endtime)}</div>
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-block px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded">
                          {formatDuration(duration)}
                        </span>
                        <div className="text-xs text-gray-500 mt-0.5">{duration} min</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-xs text-gray-900 max-w-md" title={record.address}>
                          {record.address || 'Loading address...'}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-xs text-gray-600">
                          {record.callat.toFixed(6)}, {record.callon.toFixed(6)}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* No Parking Records */}
      {!loading && parkingData && parkingData.records && parkingData.records.length === 0 && (
        <div className="bg-white rounded shadow-sm p-8">
          <div className="text-center">
            <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-gray-900 mb-1">No parking events</h3>
            <p className="text-xs text-gray-600">No parking records found for the selected period</p>
          </div>
        </div>
      )}
    </div>
  );
}
