import React, { useState, useEffect } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { getAuth, signOut } from "firebase/auth";

/**
 * Dealer Dashboard Layout
 * Provides navigation, header, and sidebar for finance desk dealership portal
 */
export default function DealerLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = getAuth();
  const user = auth.currentUser;

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Navigation items for sidebar
  const navItems = [
    { label: "Dashboard", href: "/dealer/", icon: "📊", id: "dashboard" },
    { label: "Create Lead", href: "/dealer/create-lead", icon: "➕", id: "create-lead" },
    { label: "All Leads", href: "/dealer/leads", icon: "📋", id: "leads" },
    { label: "Salespersons", href: "/dealer/salespersons", icon: "👥", id: "salespersons" },
    { label: "Staff", href: "/dealer/staff", icon: "👔", id: "staff" },
    {
      label: "Bank Tie-Ups",
      href: "/dealer/bank-tieups",
      icon: "🏦",
      id: "bank-tieups",
      badge: "NEW",
    },
    { label: "Earnings", href: "/dealer/earnings", icon: "💰", id: "earnings" },
    { label: "Profile", href: "/dealer/profile", icon: "⚙️", id: "profile" },
  ];

  const isActive = (href) => {
    if (href === "/dealer/") {
      return location.pathname === "/dealer/";
    }
    return location.pathname.startsWith(href);
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate("/login");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  return (
    <div className="flex h-screen bg-gray-900">
      {/* Sidebar */}
      <div
        className={`${
          sidebarOpen ? "w-64" : "w-20"
        } bg-gray-800 text-white flex flex-col transition-all duration-300 fixed h-full z-40 lg:relative`}
      >
        {/* Logo */}
        <div className="p-4 border-b border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-lg">
              CL
            </div>
            {sidebarOpen && <span className="font-bold">CarLoan</span>}
          </div>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="hidden lg:block text-gray-400 hover:text-white"
          >
            {sidebarOpen ? "←" : "→"}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-4">
          <ul className="space-y-2">
            {navItems.map((item) => (
              <li key={item.id}>
                <a
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors relative ${
                    isActive(item.href)
                      ? "bg-blue-600 text-white"
                      : "text-gray-300 hover:bg-gray-700"
                  }`}
                >
                  <span className="text-xl flex-shrink-0">{item.icon}</span>
                  {sidebarOpen && (
                    <>
                      <span className="flex-1">{item.label}</span>
                      {item.badge && (
                        <span className="text-xs bg-green-500 text-white px-2 py-1 rounded-full">
                          {item.badge}
                        </span>
                      )}
                    </>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* User Section */}
        <div className="p-4 border-t border-gray-700">
          <div className="flex items-center justify-between">
            <div className={`flex items-center gap-3 ${!sidebarOpen && "hidden"}`}>
              <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-sm font-bold">
                {user?.email?.[0]?.toUpperCase() || "U"}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{user?.email}</p>
                <p className="text-xs text-gray-400">Finance Desk</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="text-gray-400 hover:text-red-400 transition-colors"
              title="Logout"
            >
              🚪
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden text-gray-600 hover:text-gray-900"
            >
              ☰
            </button>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Finance Desk Dashboard
              </h2>
              <p className="text-xs text-gray-500">
                {new Date().toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </p>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => window.location.href = "/dealer/create-lead"}
              className="hidden sm:inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm"
            >
              + New Lead
            </button>
            <button
              onClick={() => navigate("/dealer/bank-tieups")}
              className="hidden sm:inline-block px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium text-sm"
            >
              🏦 Banks
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-30 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        ></div>
      )}
    </div>
  );
}
