'use client';

import { useState, useEffect } from 'react';
import { getAuthToken, getUserData } from '@/lib/auth';
import { apiCallWithAutoRefresh } from '@/lib/utils';

interface Device {
  deviceid: string;
  name: string;
  groupid?: string;
}

interface OfflineDevice {
  deviceid: string;
  devicename: string;
  simnum: string;
  groupid: number;
  updatetime: number;
  callat: number;
  callon: number;
  strstatus: string;
  strstatusen: string;
  moving: number;
  status: number;
}

interface OfflineData {
  status: number;
  cause: string;
  records: OfflineDevice[];
  addressmap?: Record<string, string>;
}

export default function OfflineReport() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [offlineHours, setOfflineHours] = useState<number>(0);
  const [offlineData, setOfflineData] = useState<OfflineData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [loadingDevices, setLoadingDevices] = useState(true);

  useEffect(() => {
    fetchDevices();
  }, []);

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

  const fetchOfflineReport = async () => {
    if (devices.length === 0) {
      setError('No devices available');
      return;
    }

    setLoading(true);
    setError('');
    setOfflineData(null);

    try {
      const token = getAuthToken();
      const deviceids = devices.map(d => d.deviceid);

      const data = await apiCallWithAutoRefresh('/api/offline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceids,
          offlinehours: offlineHours,
          token
        }),
      });

      if (data.status === 0) {
        setOfflineData(data);
      } else {
        setError(data.cause || 'Failed to fetch offline data');
      }
    } catch (err) {
      console.error('Error fetching offline report:', err);
      setError('Failed to load offline report');
    } finally {
      setLoading(false);
    }
  };

  const formatDateTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getAddress = (lat: number, lon: number) => {
    if (!offlineData?.addressmap) return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    
    const key = `${lat.toFixed(5)}_${lon.toFixed(5)}`;
    return offlineData.addressmap[key] || `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  };

  const getOfflineDuration = (updatetime: number) => {
    const now = Date.now();
    const diff = now - updatetime;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h`;
    }
    return `${hours}h ${minutes}m`;
  };

  const exportToCSV = () => {
    if (!offlineData || !offlineData.records) return;

    const headers = [
      'Device Name',
      'IMEI',
      'SIM Number',
      'Last Update',
      'Offline Duration',
      'Location',
      'Status'
    ];

    const rows = offlineData.records.map(device => [
      device.devicename,
      device.deviceid,
      device.simnum || 'N/A',
      formatDateTime(device.updatetime),
      getOfflineDuration(device.updatetime),
      getAddress(device.callat, device.callon),
      device.strstatusen || device.strstatus
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `offline-devices-${new Date().toISOString().split('T')[0]}.csv`;
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
          <h2 className="text-xl font-bold text-gray-900">Offline Devices</h2>
          <p className="text-sm text-gray-600 mt-0.5">Monitor device connectivity and status</p>
        </div>
        <button
          onClick={exportToCSV}
          disabled={!offlineData || !offlineData.records || offlineData.records.length === 0}
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
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Offline Hours Threshold */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1.5">
              Offline Hours Threshold
            </label>
            <input
              type="number"
              value={offlineHours}
              onChange={(e) => setOfflineHours(Number(e.target.value))}
              min="0"
              placeholder="0"
              className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-[#FFC107] text-gray-900"
            />
            <p className="text-xs text-gray-500 mt-1">0 = all offline devices</p>
          </div>

          {/* Total Devices */}
          <div className="flex items-end">
            <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2 w-full">
              <p className="text-xs text-blue-700 font-medium">Total Devices</p>
              <p className="text-lg font-bold text-blue-900">{devices.length}</p>
            </div>
          </div>
        </div>

        {/* Generate Button */}
        <div className="mt-3">
          <button
            onClick={fetchOfflineReport}
            disabled={loading || loadingDevices || devices.length === 0}
            className="px-4 py-1.5 text-sm bg-[#FFC107] text-gray-900 rounded hover:bg-[#FFD54F] transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
          >
            {loading ? 'Loading...' : 'Check Offline Devices'}
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

      {/* Summary */}
      {!loading && offlineData && offlineData.records && (
        <div className="bg-white rounded shadow-sm p-3">
          <p className="text-xs text-gray-700">
            Found <span className="font-semibold text-red-600">{offlineData.records.length}</span> offline device{offlineData.records.length !== 1 ? 's' : ''}
            {offlineHours > 0 && ` (offline for more than ${offlineHours} hour${offlineHours !== 1 ? 's' : ''})`}
          </p>
        </div>
      )}

      {/* Offline Devices Table */}
      {!loading && offlineData && offlineData.records && offlineData.records.length > 0 && (
        <div className="bg-white rounded shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Device</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Last Update</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Offline Duration</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Last Location</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {offlineData.records.map((device) => (
                  <tr key={device.deviceid} className="hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <div className="text-xs text-gray-900 font-medium">{device.devicename}</div>
                      <div className="text-xs text-gray-500">{device.deviceid}</div>
                      {device.simnum && (
                        <div className="text-xs text-gray-500">SIM: {device.simnum}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs text-gray-900">{formatDateTime(device.updatetime)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-block px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded">
                        {getOfflineDuration(device.updatetime)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs text-gray-900 max-w-xs truncate" title={getAddress(device.callat, device.callon)}>
                        {getAddress(device.callat, device.callon)}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-xs text-gray-700">{device.strstatusen || device.strstatus}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* No Offline Devices */}
      {!loading && offlineData && offlineData.records && offlineData.records.length === 0 && (
        <div className="bg-white rounded shadow-sm p-8">
          <div className="text-center">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-gray-900 mb-1">All devices online</h3>
            <p className="text-xs text-gray-600">No offline devices found</p>
          </div>
        </div>
      )}
    </div>
  );
}
