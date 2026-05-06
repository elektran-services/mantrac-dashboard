"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { getUserData, clearAuth, getAuthToken } from "@/lib/auth";
import CustomSelect from "@/app/components/CustomSelect";
import { buildGPS51Url } from "@/lib/config";
import AlarmList from "./components/AlarmList";
import SavedMileageReports from "./components/SavedMileageReports";
import OfflineReport from "./components/OfflineReport";
import ParkingReport from "./components/ParkingReport";
import SavedReports from "./components/SavedReports";
import SavedTripsReports from "./components/SavedTripsReports";

export default function DashboardPage() {
  const router = useRouter();
  const [userData, setUserData] = useState<any>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeMenu, setActiveMenu] = useState("dashboard");
  type Bucket = { count: number; latestReportDate: string | null };
  const [reportStats, setReportStats] = useState<{
    overspeed: Bucket;
    trips: Bucket;
    mileageDaily: Bucket;
    mileageMonthly: Bucket;
    offline: Bucket;
    parking: Bucket;
    generatedAt: string | null;
    loading: boolean;
    error: string | null;
  }>({
    overspeed: { count: 0, latestReportDate: null },
    trips: { count: 0, latestReportDate: null },
    mileageDaily: { count: 0, latestReportDate: null },
    mileageMonthly: { count: 0, latestReportDate: null },
    offline: { count: 0, latestReportDate: null },
    parking: { count: 0, latestReportDate: null },
    generatedAt: null,
    loading: true,
    error: null,
  });
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);


  useEffect(() => {
    const data = getUserData();
    if (!data) {
      router.push("/");
    } else {
      setUserData(data);
      fetchReportStats();
    }
  }, [router]);

  // Handler for refresh button
  const handleRefresh = () => {
    setReportStats((prev) => ({ ...prev, loading: true, error: null }));
    fetchReportStats();
  };

  const fetchReportStats = async () => {
    try {
      const token = getAuthToken();
      if (!token) {
        setReportStats((prev) => ({ ...prev, loading: false, error: 'Not logged in' }));
        return;
      }

      const res = await fetch('/api/dashboard-stats', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ token }),
      });

      const data = await res.json();
      if (!res.ok || data.status !== 0) {
        setReportStats((prev) => ({
          ...prev,
          loading: false,
          error: data.cause || 'Failed to load report stats',
        }));
        return;
      }

      setReportStats({
        overspeed: data.overspeed,
        trips: data.trips,
        mileageDaily: data.mileageDaily,
        mileageMonthly: data.mileageMonthly,
        offline: data.offline,
        parking: data.parking,
        generatedAt: data.generatedAt ?? null,
        loading: false,
        error: null,
      });
    } catch (error) {
      console.error('Error fetching dashboard stats:', error);
      setReportStats((prev) => ({
        ...prev,
        loading: false,
        error: 'Could not load saved report counts',
      }));
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
    { id: "saved-reports", label: "Overspeed Report", icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    )},
    { id: "saved-trips-reports", label: "Trips Report", icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
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

  const menuHeaderLabel =
    menuItems.find((item) => item.id === activeMenu)?.label ??
    activeMenu.replace(/-/g, " ");

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
          <h1 className="text-xl font-semibold text-gray-900">{menuHeaderLabel}</h1>
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
              <div className="mb-4 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2.5">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-gray-900 tracking-tight">Welcome back, {userData.nickname}</h2>
                  <p className="text-xs sm:text-sm text-gray-600 mt-0.5 max-w-xl">
                    Saved reports on this server. Counts reflect files in each folder (after retention rules). Open a card to list and download.
                  </p>
                  {reportStats.generatedAt && !reportStats.loading && (
                    <p className="text-xs text-gray-400 mt-2">
                      Last refreshed {new Date(reportStats.generatedAt).toLocaleString()}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#FFC107] text-gray-900 font-medium hover:bg-yellow-400 border border-yellow-500/30 shadow-sm disabled:opacity-50"
                  onClick={handleRefresh}
                  title="Refresh counts from disk"
                  aria-label="Refresh counts from disk"
                  disabled={reportStats.loading}
                >
                  <svg className={`w-5 h-5 ${reportStats.loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.93 4.93a10 10 0 0114.14 0m0 0V1m0 3.93H17M19.07 19.07a10 10 0 01-14.14 0m0 0V23m0-3.93H7" />
                  </svg>
                  Refresh
                </button>
              </div>

              {reportStats.error && (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 text-red-800 text-sm px-4 py-3">{reportStats.error}</div>
              )}

              {/* Report inventory — compact (~40% smaller footprint vs prior row) */}
              <div className="grid grid-cols-3 gap-2 w-full max-w-7xl">
                {[
                  {
                    menu: "saved-reports" as const,
                    title: "Overspeed Report",
                    desc: "Daily violation Excel files",
                    folder: "generated_reports/",
                    bucket: reportStats.overspeed,
                    icon: "speed" as const,
                    accent: "from-amber-500/15 to-orange-500/10 border-amber-200/80",
                    iconBg: "bg-amber-100 text-amber-700",
                  },
                  {
                    menu: "saved-trips-reports" as const,
                    title: "Trips Report",
                    desc: "Daily trip exports",
                    folder: "trips/",
                    bucket: reportStats.trips,
                    icon: "doc" as const,
                    accent: "from-sky-500/15 to-blue-500/10 border-sky-200/80",
                    iconBg: "bg-sky-100 text-sky-700",
                  },
                  {
                    menu: "mileage" as const,
                    title: "Mileage Report",
                    desc: "Daily threshold + monthly fleet snapshot",
                    folder: "mileage_report/ · mileage_overall_report/",
                    folderTooltip: "mileage_report/ · mileage_overall_report/",
                    bucket: reportStats.mileageDaily,
                    secondary: reportStats.mileageMonthly,
                    icon: "chart" as const,
                    accent: "from-emerald-500/15 to-teal-500/10 border-emerald-200/80",
                    iconBg: "bg-emerald-100 text-emerald-700",
                  },
                  {
                    menu: "offline" as const,
                    title: "Offline Devices",
                    desc: "Daily offline snapshots",
                    folder: "offline_reports/",
                    bucket: reportStats.offline,
                    icon: "signal" as const,
                    accent: "from-slate-500/15 to-gray-500/10 border-slate-200/80",
                    iconBg: "bg-slate-100 text-slate-700",
                  },
                  {
                    menu: "parking" as const,
                    title: "Parking Report",
                    desc: "Daily parking / idle exports",
                    folder: "parking_reports/",
                    bucket: reportStats.parking,
                    icon: "pin" as const,
                    accent: "from-violet-500/15 to-purple-500/10 border-violet-200/80",
                    iconBg: "bg-violet-100 text-violet-700",
                  },
                ].map((card) => (
                  <button
                    key={card.menu + card.title}
                    type="button"
                    onClick={() => setActiveMenu(card.menu)}
                    className={`text-left w-full flex flex-col min-h-[12rem] sm:min-h-[13.5rem] rounded-md border bg-gradient-to-br ${card.accent} p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_3px_8px_rgba(15,23,42,0.05)] ring-1 ring-black/5 hover:shadow-[0_2px_6px_rgba(0,0,0,0.05),0_8px_20px_rgba(15,23,42,0.08)] hover:-translate-y-px active:translate-y-0 active:shadow-sm transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FFC107] focus-visible:ring-offset-1 group`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className={`w-5 h-5 sm:w-6 sm:h-6 rounded-md ${card.iconBg} flex items-center justify-center shrink-0 shadow-sm`}>
                        {card.icon === "speed" && (
                          <svg className="w-2.5 h-2.5 sm:w-3 sm:h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                        )}
                        {card.icon === "doc" && (
                          <svg className="w-2.5 h-2.5 sm:w-3 sm:h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        )}
                        {card.icon === "chart" && (
                          <svg className="w-2.5 h-2.5 sm:w-3 sm:h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        )}
                        {card.icon === "signal" && (
                          <svg className="w-2.5 h-2.5 sm:w-3 sm:h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3" />
                          </svg>
                        )}
                        {card.icon === "pin" && (
                          <svg className="w-2.5 h-2.5 sm:w-3 sm:h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        )}
                      </div>
                      <span className="text-[12px] font-semibold text-gray-600 group-hover:text-gray-900 transition-colors">Open →</span>
                    </div>
                    <h3 className="mt-1.5 text-[14px] sm:text-[17px] font-bold text-gray-900 leading-tight line-clamp-1">{card.title}</h3>
                    <p className="text-[11px] sm:text-xs text-gray-600 mt-0.5 line-clamp-1">{card.desc}</p>
                    <p
                      className="text-[11px] font-mono text-gray-500 mt-0.5 truncate"
                      title={"folderTooltip" in card && card.folderTooltip ? card.folderTooltip : card.folder}
                    >
                      {card.folder}
                    </p>
                    <div className="mt-auto pt-2">
                      {reportStats.loading ? (
                        <div className="animate-pulse h-4 bg-white/70 rounded w-12" />
                      ) : "secondary" in card && card.secondary ? (
                        <div className="grid grid-cols-2 gap-1.5">
                          <div>
                            <p className="text-[11px] font-medium text-gray-600">Daily files</p>
                            <p className="text-[19px] sm:text-[22px] font-bold text-gray-900 tabular-nums mt-0 leading-none">{card.bucket.count}</p>
                            <p className="text-[11px] text-gray-500 mt-0.5 truncate">
                              Latest {card.bucket.latestReportDate ? card.bucket.latestReportDate.slice(0, 10) : "—"}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] font-medium text-gray-600">Monthly files</p>
                            <p className="text-[19px] sm:text-[22px] font-bold text-gray-900 tabular-nums mt-0 leading-none">{card.secondary.count}</p>
                            <p className="text-[11px] text-gray-500 mt-0.5 truncate">
                              Latest {card.secondary.latestReportDate ? card.secondary.latestReportDate.slice(0, 7) : "—"}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-end gap-1">
                          <span className="text-[19px] sm:text-[22px] font-bold text-gray-900 tabular-nums leading-none">{card.bucket.count}</span>
                          <span className="text-[11px] text-gray-500 font-medium pb-px uppercase tracking-wide">saved files</span>
                        </div>
                      )}
                      {!reportStats.loading && !("secondary" in card && card.secondary) && (
                        <p className="text-[11px] text-gray-500 mt-0.5">
                          Latest {card.bucket.latestReportDate ? card.bucket.latestReportDate.slice(0, 10) : "—"}
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>

              <div className="mt-4 max-w-7xl w-full rounded-lg border border-gray-200 bg-white p-3 sm:p-4 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_4px_14px_rgba(15,23,42,0.06)] ring-1 ring-black/5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
                  <div>
                    <h3 className="text-xs font-bold text-gray-900">Live alerts &amp; devices</h3>
                    <p className="text-[10px] sm:text-xs text-gray-600 mt-0.5">
                      GPS51-powered views are still available from the sidebar when you need real-time data.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveMenu("alerts")}
                    className="shrink-0 px-4 py-2 rounded-lg text-xs font-semibold bg-gray-900 text-white hover:bg-gray-800 shadow-md"
                  >
                    Open Alerts
                  </button>
                </div>
              </div>
            </>
          )}

          {activeMenu !== "dashboard" && activeMenu !== "alerts" && activeMenu !== "mileage" && activeMenu !== "offline" && activeMenu !== "parking" && activeMenu !== "saved-reports" && activeMenu !== "saved-trips-reports" && activeMenu !== "settings" && (
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

          {activeMenu === "mileage" && (
            <SavedMileageReports />
          )}

          {activeMenu === "offline" && (
            <OfflineReport />
          )}

          {activeMenu === "parking" && (
            <ParkingReport />
          )}

          {activeMenu === "saved-reports" && (
            <SavedReports />
          )}

          {activeMenu === "saved-trips-reports" && (
            <SavedTripsReports />
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
