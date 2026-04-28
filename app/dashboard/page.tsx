"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { getUserData, clearAuth, getAuthToken } from "@/lib/auth";
import CustomSelect from "@/app/components/CustomSelect";
import { buildGPS51Url } from "@/lib/config";
import DeviceList from "./components/DeviceList";
import AlarmList from "./components/AlarmList";
import TripReport from "./components/TripReport";
import LastPosition from "./components/LastPosition";
import MileageReport from "./components/MileageReport";
import OfflineReport from "./components/OfflineReport";
import ParkingReport from "./components/ParkingReport";
import OverspeedReport from "./components/OverspeedReport";

export default function DashboardPage() {
  const router = useRouter();
  const [userData, setUserData] = useState<any>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState("dashboard");
  const [dashboardStats, setDashboardStats] = useState({
    totalVehicles: 0,
    activeVehicles: 0,
    alerts: 0,
    todayDistance: 0,
    loading: true
  });
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);


  useEffect(() => {
    const data = getUserData();
    if (!data) {
      router.push("/");
    } else {
      setUserData(data);
      fetchDashboardStats(data.username);
    }
  }, [router]);

  // Handler for refresh button
  const handleRefresh = () => {
    if (userData && userData.username) {
      setDashboardStats(prev => ({ ...prev, loading: true }));
      fetchDashboardStats(userData.username);
    }
  };

  const fetchDashboardStats = async (username: string) => {
    try {
      const token = getAuthToken();
      
      // Fetch devices
      const devicesResponse = await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, token }),
      });
      
      const devicesData = await devicesResponse.json();
      
      let totalVehicles = 0;
      let deviceIds: string[] = [];
      
      if (devicesData.status === 0 && devicesData.groups) {
        devicesData.groups.forEach((group: any) => {
          if (group.devices) {
            totalVehicles += group.devices.length;
            deviceIds.push(...group.devices.map((d: any) => d.deviceid));
          }
        });
      }
      
      // Fetch lastposition for all devices to check ACC status
      let activeVehicles = 0;
      if (deviceIds.length > 0) {
        const positionResponse = await fetch('/api/lastposition', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            username, 
            deviceids: deviceIds,
            lastquerypositiontime: 0 
          }),
        });
        
        const positionData = await positionResponse.json();
        
        if (positionData.status === 0 && positionData.records) {
          // Count devices with ACC ON
          activeVehicles = positionData.records.filter((record: any) => {
            return record.strstatusen && record.strstatusen.includes('ACC ON');
          }).length;
        }
      }
      
      // Fetch alarms with valid payload expected by /api/alarms
      let alertsCount = 0;
      if (deviceIds.length > 0 && token) {
        const today = new Date().toISOString().split('T')[0];
        const alarmsResponse = await fetch('/api/alarms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            devices: deviceIds,
            startday: today,
            endday: today,
            offset: 1,
            needalarm: "5",
            token,
          }),
        });
        
        const alarmsData = await alarmsResponse.json();
        alertsCount = alarmsData.status === 0 && alarmsData.alarmrecords ? alarmsData.alarmrecords.length : 0;
      }
      
      setDashboardStats({
        totalVehicles,
        activeVehicles,
        alerts: alertsCount,
        todayDistance: 0,
        loading: false
      });
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
      setDashboardStats(prev => ({ ...prev, loading: false }));
    }
  };

  const handleLogout = () => {
    clearAuth();
    router.push("/");
  };

  const handleLogoutClick = () => {
    setShowLogoutConfirm(true);
  };

  const handleCancelLogout = () => {
    setShowLogoutConfirm(false);
  };

  const handleConfirmLogout = () => {
    setShowLogoutConfirm(false);
    handleLogout();
  };

  if (!userData) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#FFC107]"></div>
      </div>
    );
  }

  const menuItems = [
    { id: "dashboard", label: "Dashboard", icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    )},
    { id: "lastposition", label: "Last Position", icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
      </svg>
    )},
    { id: "reports", label: "Trip Report", icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    )},
    { id: "mileage", label: "Mileage Report", icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    )},
    { id: "offline", label: "Offline Devices", icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3" />
      </svg>
    )},
    { id: "parking", label: "Parking Report", icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    )},
    { id: "overspeed", label: "Overspeed Report", icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    )},
    { id: "alerts", label: "Alerts", icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
    )},
    { id: "settings", label: "Settings", icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    )},
  ];

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 fixed lg:static inset-y-0 left-0 z-50 w-64 bg-gray-900 transform transition-transform duration-300 ease-in-out flex flex-col`}>
        {/* Logo */}
        <div className="flex items-center justify-start px-4 h-16 bg-gray-800 border-b border-gray-700">
          <Image
            src="/mantrac_logo.png"
            alt="Mantrac Logo"
            width={140}
            height={45}
            priority
            className="h-10 w-auto"
          />
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveMenu(item.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                activeMenu === item.id
                  ? 'bg-[#FFC107] text-gray-900 font-medium'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white font-normal'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Logout Button restored to sidebar */}
        <div className="px-3 pb-3">
          <button
            onClick={handleLogoutClick}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white hover:bg-red-600 transition-colors font-medium"
            style={{ justifyContent: 'flex-start' }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H7a2 2 0 01-2-2V7a2 2 0 012-2h4a2 2 0 012 2v1" />
            </svg>
            <span>Logout</span>
          </button>
        </div>

        {/* Footer */}
        <div className="mt-auto px-3 pb-4 text-left border-t border-gray-700 pt-4">
          <p className="text-xs text-gray-400 mb-1">© {new Date().getFullYear()}</p>
          <p className="text-xs text-gray-500">Powered by</p>
          <p className="text-xs text-gray-300 font-medium">SafeTrack Technologies</p>
        </div>

        {/* Logout Confirmation Popup */}
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
                {showLogoutConfirm && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
                    <div className="bg-white rounded-lg shadow-2xl p-6 w-full max-w-xs mx-auto flex flex-col items-center">
                      <svg className="w-10 h-10 text-red-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H7a2 2 0 01-2-2V7a2 2 0 012-2h4a2 2 0 012 2v1" />
                      </svg>
                      <h2 className="text-lg font-semibold text-gray-900 mb-1">Confirm Logout</h2>
                      <p className="text-sm text-gray-600 mb-4 text-center">Are you sure you want to logout?</p>
                      <div className="flex gap-3 w-full">
                        <button
                          onClick={handleConfirmLogout}
                          className="flex-1 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition-colors"
                        >
                          Yes, Logout
                        </button>
                        <button
                          onClick={handleCancelLogout}
                          className="flex-1 py-2 rounded-lg bg-gray-200 text-gray-700 font-medium hover:bg-gray-300 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}
        {/* Header */}
        <header className="bg-white shadow-sm h-16 flex items-center justify-between px-4 lg:px-8">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-2 rounded-lg text-gray-600 hover:bg-gray-100"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h1 className="text-xl font-semibold text-gray-900 capitalize">{activeMenu}</h1>
          <div className="flex items-center gap-4">
            <button className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 relative">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-[#FFC107] flex items-center justify-center shrink-0">
                <span className="text-gray-900 font-semibold text-xs">
                  {userData.nickname.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="flex flex-col min-w-0">
                <p className="text-xs font-medium text-gray-900 truncate">{userData.nickname}</p>
                <p className="text-xs text-gray-500 truncate">{userData.username}</p>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto p-3 lg:p-6">
          {activeMenu === "dashboard" && (
            <>
              <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <h2 className="text-xl font-bold text-gray-900 mb-1">Welcome back, {userData.nickname}!</h2>
                  <p className="text-sm text-gray-600">Here's what's happening with your fleet today.</p>
                </div>
                <button
                  className="p-2 rounded-lg bg-[#FFC107] text-gray-900 hover:bg-yellow-400 flex items-center gap-1 border border-yellow-300 shadow-sm"
                  onClick={handleRefresh}
                  title="Refresh dashboard stats"
                  aria-label="Refresh dashboard stats"
                  disabled={dashboardStats.loading}
                >
                  <svg className={`w-5 h-5 ${dashboardStats.loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.93 4.93a10 10 0 0114.14 0m0 0V1m0 3.93H17M19.07 19.07a10 10 0 01-14.14 0m0 0V23m0-3.93H7" />
                  </svg>
                  <span className="sr-only">Refresh</span>
                  <span className="hidden sm:inline text-sm font-medium">Refresh</span>
                </button>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="bg-white rounded-lg shadow-sm p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                      <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </div>
                  </div>
                  <h3 className="text-xs font-medium text-gray-600 mb-1">Total Vehicles</h3>
                  {dashboardStats.loading ? (
                    <div className="animate-pulse h-7 bg-gray-200 rounded w-16"></div>
                  ) : (
                    <p className="text-xl font-bold text-gray-900">{dashboardStats.totalVehicles}</p>
                  )}
                </div>

                <div className="bg-white rounded-lg shadow-sm p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                      <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    {!dashboardStats.loading && dashboardStats.totalVehicles > 0 && (
                      <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded">
                        {((dashboardStats.activeVehicles / dashboardStats.totalVehicles) * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                  <h3 className="text-xs font-medium text-gray-600 mb-1">Active Now</h3>
                  {dashboardStats.loading ? (
                    <div className="animate-pulse h-7 bg-gray-200 rounded w-16"></div>
                  ) : (
                    <p className="text-xl font-bold text-gray-900">{dashboardStats.activeVehicles}</p>
                  )}
                </div>

                <div className="bg-white rounded-lg shadow-sm p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                      <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                  </div>
                  <h3 className="text-xs font-medium text-gray-600 mb-1">Parked Vehicles</h3>
                  {dashboardStats.loading ? (
                    <div className="animate-pulse h-7 bg-gray-200 rounded w-16"></div>
                  ) : (
                    <p className="text-xl font-bold text-gray-900">{dashboardStats.totalVehicles - dashboardStats.activeVehicles}</p>
                  )}
                </div>
              </div>

              {/* Device List Component */}
              <div className="mt-6">
                <DeviceList />
              </div>
            </>
          )}

          {activeMenu !== "dashboard" && activeMenu !== "alerts" && activeMenu !== "reports" && activeMenu !== "lastposition" && activeMenu !== "mileage" && activeMenu !== "offline" && activeMenu !== "parking" && activeMenu !== "overspeed" && activeMenu !== "settings" && (
            <div className="bg-white rounded-lg shadow-sm p-8">
              <div className="text-center">
                <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <h3 className="text-base font-semibold text-gray-900 mb-1 capitalize">{activeMenu}</h3>
                <p className="text-sm text-gray-600">This section is under development.</p>
              </div>
            </div>
          )}

          {activeMenu === "alerts" && (
            <AlarmList />
          )}

          {activeMenu === "reports" && (
            <TripReport />
          )}

          {activeMenu === "lastposition" && (
            <LastPosition />
          )}

          {activeMenu === "mileage" && (
            <MileageReport />
          )}

          {activeMenu === "offline" && (
            <OfflineReport />
          )}

          {activeMenu === "parking" && (
            <ParkingReport />
          )}

          {activeMenu === "overspeed" && (
            <OverspeedReport />
          )}

          {activeMenu === "settings" && (
            <SettingsPage />
          )}
        </main>
      </div>
    </div>
  );
}

// Settings Component
function SettingsPage() {
  const [activeTab, setActiveTab] = useState<"single" | "batch">("single");
  const [devices, setDevices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [selectedDevices, setSelectedDevices] = useState<string[]>([]);
  const [speedLimit1, setSpeedLimit1] = useState("60");
  const [speedLimit2, setSpeedLimit2] = useState("35");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    fetchDevices();
  }, []);

  const fetchDevices = async () => {
    try {
      const token = getAuthToken();
      const userData = getUserData();
      
      const response = await fetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: userData?.username, token }),
      });
      
      const data = await response.json();
      
      if (data.status === 0 && data.groups) {
        const allDevices: any[] = [];
        data.groups.forEach((group: any) => {
          if (group.devices) {
            allDevices.push(...group.devices);
          }
        });
        setDevices(allDevices);
      }
    } catch (error) {
      console.error('Error fetching devices:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSingleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDevice) {
      setResult({ type: "error", message: "Please select a device" });
      return;
    }

    setSubmitting(true);
    setResult(null);

    try {
      const token = getAuthToken();
      if (!token) {
        setResult({ type: "error", message: "Authentication required. Please log in again." });
        setSubmitting(false);
        return;
      }
      const response = await fetch(buildGPS51Url('sendcmd', token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceid: selectedDevice,
          cmdcode: "TYPE_SERVER_SET_SPEED_LIMIT",
          params: [speedLimit1, speedLimit2]
        }),
      });

      const data = await response.json();
      
      if (data.status === 0) {
        setResult({ 
          type: "success", 
          message: `Speed limit set successfully! Command sent to device ${selectedDevice}. ${data.sendcmdrecord?.result || ''}`
        });
      } else {
        setResult({ type: "error", message: data.cause || "Failed to set speed limit" });
      }
    } catch (error: any) {
      setResult({ type: "error", message: error.message || "Failed to set speed limit" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleBatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedDevices.length === 0) {
      setResult({ type: "error", message: "Please select at least one device" });
      return;
    }

    setSubmitting(true);
    setResult(null);

    try {
      const token = getAuthToken();
      if (!token) {
        setResult({ type: "error", message: "Authentication required. Please log in again." });
        setSubmitting(false);
        return;
      }
      const response = await fetch(buildGPS51Url('batchoperate', token), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: "sendcommand",
          deviceids: selectedDevices,
          devicetype: 1,
          cmdcode: "TYPE_SERVER_SET_SPEED_LIMIT",
          params: [speedLimit1, speedLimit2]
        }),
      });

      const data = await response.json();
      
      if (data.status === 0) {
        setResult({ 
          type: "success", 
          message: `Batch operation completed! Total: ${data.total}, Success: ${data.success}, Failed: ${data.fail}`
        });
      } else {
        setResult({ type: "error", message: data.cause || "Failed to set speed limit" });
      }
    } catch (error: any) {
      setResult({ type: "error", message: error.message || "Failed to set speed limit" });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleDeviceSelection = (deviceId: string) => {
    setSelectedDevices(prev => 
      prev.includes(deviceId) 
        ? prev.filter(id => id !== deviceId)
        : [...prev, deviceId]
    );
  };

  const selectAllDevices = () => {
    setSelectedDevices(devices.map(d => d.deviceid));
  };

  const clearAllDevices = () => {
    setSelectedDevices([]);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#FFC107]"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Main Settings Card */}
      <div className="bg-white rounded-lg shadow-sm">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-[#FFC107]/10">
              <svg className="w-6 h-6 text-[#FFC107]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-gray-900">Overspeed Settings</h2>
              <p className="text-sm text-gray-600 mt-0.5">Set maximum speed limits and configure overspeed alarm parameters for your fleet devices.</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <div className="flex">
            <button
              onClick={() => setActiveTab("single")}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === "single"
                  ? "border-[#FFC107] text-[#FFC107]"
                  : "border-transparent text-gray-800 hover:text-gray-900 hover:border-gray-300"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Single Device
            </button>
            <button
              onClick={() => setActiveTab("batch")}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === "batch"
                  ? "border-[#FFC107] text-[#FFC107]"
                  : "border-transparent text-gray-800 hover:text-gray-900 hover:border-gray-300"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 12H9m6 0H9m6 8H9m6 0H9m6-4h-6m6 0h-6" />
              </svg>
              Batch Settings
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {result && (
            <div className={`mb-6 p-4 rounded-lg flex items-start gap-3 ${
              result.type === "success" 
                ? "bg-green-50 text-green-800 border border-green-200" 
                : "bg-red-50 text-red-800 border border-red-200"
            }`}>
              <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                {result.type === "success" ? (
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                ) : (
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                )}
              </svg>
              <p className="text-sm flex-1">{result.message}</p>
            </div>
          )}

          {activeTab === "single" && (
            <form onSubmit={handleSingleSubmit} className="space-y-8">
              {/* Device Selection Section */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                    <path fillRule="evenodd" d="M4 5a2 2 0 012-2 1 1 0 000 2H3a1 1 0 00-1 1v12a1 1 0 001 1h18a1 1 0 001-1V6a1 1 0 00-1-1h-1a1 1 0 000-2h2a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V5z" clipRule="evenodd" />
                  </svg>
                  <h3 className="text-sm font-semibold text-gray-900">Device Selection</h3>
                </div>
                <CustomSelect
                  label="Select Device"
                  value={selectedDevice}
                  onChange={(value) => setSelectedDevice(value)}
                  options={[
                    { value: "", label: "Choose a device..." },
                    ...devices.map((device) => ({
                      value: device.deviceid,
                      label: device.alias || device.deviceid,
                    })),
                  ]}
                  className="w-1/4"
                />
                <p className="text-xs text-gray-500">Device serial number</p>
              </div>

              {/* Parameters Section */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                  </svg>
                  <h3 className="text-sm font-semibold text-gray-900">Speed Parameters</h3>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="p-4 rounded-lg bg-gray-50 border border-gray-100">
                    <label className="block text-sm font-medium text-gray-900 mb-2">
                      Speed Limit (km/h)
                    </label>
                    <input
                      type="number"
                      value={speedLimit1}
                      onChange={(e) => setSpeedLimit1(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg focus:ring-2 focus:ring-[#FFC107] focus:border-[#FFC107] text-gray-900 bg-white border border-gray-200"
                      min="1"
                      max="200"
                      required
                    />
                    <p className="text-xs text-gray-500 mt-2">Maximum speed limit for your vehicles</p>
                  </div>

                  <div className="p-4 rounded-lg bg-gray-50 border border-gray-100">
                    <label className="block text-sm font-medium text-gray-900 mb-2">
                      Duration (seconds)
                    </label>
                    <input
                      type="number"
                      value={speedLimit2}
                      onChange={(e) => setSpeedLimit2(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg focus:ring-2 focus:ring-[#FFC107] focus:border-[#FFC107] text-gray-900 bg-white border border-gray-200"
                      min="1"
                      max="200"
                      required
                    />
                    <p className="text-xs text-gray-500 mt-2">Alarm trigger duration in seconds</p>
                  </div>
                </div>
              </div>

              {/* Submit Button */}
              <div className="flex items-center gap-3 pt-4 border-t border-gray-200">
                <button
                  type="submit"
                  disabled={submitting || !selectedDevice}
                  className="px-6 py-2.5 bg-[#FFC107] hover:bg-yellow-400 text-gray-900 rounded-lg transition-colors font-medium shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  {submitting ? "Setting..." : "Set Speed Limit"}
                </button>
                <span className="text-sm text-gray-500">
                  {selectedDevice ? `Device: ${selectedDevice}` : "Select a device first"}
                </span>
              </div>
            </form>
          )}

          {activeTab === "batch" && (
            <form onSubmit={handleBatchSubmit} className="space-y-8">
              {/* Device Selection Section */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                    <path fillRule="evenodd" d="M4 5a2 2 0 012-2 1 1 0 000 2H3a1 1 0 00-1 1v12a1 1 0 001 1h18a1 1 0 001-1V6a1 1 0 00-1-1h-1a1 1 0 000-2h2a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V5z" clipRule="evenodd" />
                  </svg>
                  <h3 className="text-sm font-semibold text-gray-900">Device Selection</h3>
                </div>

                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Select Devices ({selectedDevices.length} selected)
                  </label>
                  <div className="space-x-2">
                    <button
                      type="button"
                      onClick={selectAllDevices}
                      className="text-xs text-gray-700 hover:text-gray-900 font-medium"
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={clearAllDevices}
                      className="text-xs text-gray-600 hover:text-gray-800"
                    >
                      Clear All
                    </button>
                  </div>
                </div>

                <div className="rounded-lg max-h-64 overflow-y-auto bg-gray-50 border border-gray-200">
                  {devices.map((device) => (
                    <label
                      key={device.deviceid}
                      className="flex items-center px-4 py-2 hover:bg-gray-100 cursor-pointer border-b border-gray-100 last:border-b-0"
                    >
                      <input
                        type="checkbox"
                        checked={selectedDevices.includes(device.deviceid)}
                        onChange={() => toggleDeviceSelection(device.deviceid)}
                        className="w-4 h-4 text-[#FFC107] border-gray-300 rounded focus:ring-[#FFC107]"
                      />
                      <span className="ml-3 text-sm text-gray-900">
                        {device.alias || device.deviceid}
                      </span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-gray-500">Device serial number list</p>
              </div>

              {/* Parameters Section */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                  </svg>
                  <h3 className="text-sm font-semibold text-gray-900">Speed Parameters</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="p-4 rounded-lg bg-gray-50 border border-gray-100">
                    <label className="block text-sm font-medium text-gray-900 mb-2">
                      Speed Limit (km/h)
                    </label>
                    <input
                      type="number"
                      value={speedLimit1}
                      onChange={(e) => setSpeedLimit1(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg focus:ring-2 focus:ring-[#FFC107] focus:border-[#FFC107] text-gray-900 bg-white border border-gray-200"
                      min="1"
                      max="200"
                      required
                    />
                    <p className="text-xs text-gray-500 mt-2">Maximum speed limit for your vehicles</p>
                  </div>

                  <div className="p-4 rounded-lg bg-gray-50 border border-gray-100">
                    <label className="block text-sm font-medium text-gray-900 mb-2">
                      Duration (seconds)
                    </label>
                    <input
                      type="number"
                      value={speedLimit2}
                      onChange={(e) => setSpeedLimit2(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg focus:ring-2 focus:ring-[#FFC107] focus:border-[#FFC107] text-gray-900 bg-white border border-gray-200"
                      min="1"
                      max="200"
                      required
                    />
                    <p className="text-xs text-gray-500 mt-2">Alarm trigger duration in seconds</p>
                  </div>
                </div>
              </div>

              {/* Submit Button */}
              <div className="flex items-center gap-3 pt-4 border-t border-gray-200">
                <button
                  type="submit"
                  disabled={submitting || selectedDevices.length === 0}
                  className="px-6 py-2.5 bg-[#FFC107] hover:bg-yellow-400 text-gray-900 rounded-lg transition-colors font-medium shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  {submitting ? "Setting..." : `Set Speed Limit for ${selectedDevices.length} Device(s)`}
                </button>
                <span className="text-sm text-gray-500">
                  {selectedDevices.length === 0 ? "Select devices first" : `${selectedDevices.length} device(s) selected`}
                </span>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
