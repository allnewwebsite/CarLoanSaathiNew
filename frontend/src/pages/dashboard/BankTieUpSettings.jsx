import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../services/api.js";

/**
 * Bank Tie-Up Settings Component
 * Allows dealership to manage their bank branch partnerships dynamically
 * 
 * Features:
 * - Display current tied-up banks
 * - Search and filter available banks
 * - Add new bank tie-ups
 * - Remove existing tie-ups with active lead protection
 * - Real-time bank availability updates
 */
export default function BankTieUpSettings() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // State Management
  const [currentTieUps, setCurrentTieUps] = useState([]);
  const [availableBanks, setAvailableBanks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCity, setFilterCity] = useState("All");
  const [filterState, setFilterState] = useState("All");
  const [selectedBankToAdd, setSelectedBankToAdd] = useState(null);

  // Modal & Confirmation State
  const [showAddModal, setShowAddModal] = useState(false);
  const [confirmRemoveIfsc, setConfirmRemoveIfsc] = useState(null);
  const [removingIfsc, setRemovingIfsc] = useState(null);
  const [addingIfsc, setAddingIfsc] = useState(null);

  // Get unique cities and states for filters
  const uniqueCities = React.useMemo(() => {
    const cities = new Set(availableBanks.map((b) => b.city).filter(Boolean));
    return ["All", ...Array.from(cities).sort()];
  }, [availableBanks]);

  const uniqueStates = React.useMemo(() => {
    const states = new Set(availableBanks.map((b) => b.state).filter(Boolean));
    return ["All", ...Array.from(states).sort()];
  }, [availableBanks]);

  /**
   * Fetch current tie-ups and available banks from API
   */
  const fetchBankTieUps = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await api.get("/dealer/bank-tieups");

      setCurrentTieUps(response.data.currentTieUps || []);
      setAvailableBanks(response.data.availableBanks || []);
    } catch (err) {
      console.error("Error fetching bank tie-ups:", err);
      setError(err.response?.data?.message || "Failed to load bank tie-ups");
    } finally {
      setLoading(false);
    }
  }, [user]);

  /**
   * Add a new bank tie-up
   */
  const handleAddTieUp = useCallback(
    async (bank) => {
      try {
        setAddingIfsc(bank.ifscCode);
        const response = await api.patch("/dealer/bank-tieups", {
          bankTieUps: [...currentTieUps.map((t) => t.ifscCode), bank.ifscCode],
        });

        setCurrentTieUps(response.data.bankTieUps);
        setSuccess(`Added ${bank.bankName} - ${bank.branchName}`);
        setShowAddModal(false);
        setSelectedBankToAdd(null);

        // Clear success message after 5 seconds
        setTimeout(() => setSuccess(null), 5000);
      } catch (err) {
        console.error("Error adding tie-up:", err);
        setError(
          err.response?.data?.message || "Failed to add bank tie-up. Try again."
        );
      } finally {
        setAddingIfsc(null);
      }
    },
    [user, currentTieUps]
  );

  /**
   * Remove a bank tie-up
   */
  const handleRemoveTieUp = useCallback(
    async (ifscCode) => {
      try {
        setRemovingIfsc(ifscCode);
        const updatedTieUps = currentTieUps
          .filter((t) => t.ifscCode !== ifscCode)
          .map((t) => t.ifscCode);

        const response = await api.patch("/dealer/bank-tieups", { bankTieUps: updatedTieUps });

        setCurrentTieUps(response.data.bankTieUps);
        setSuccess("Bank tie-up removed successfully");
        setConfirmRemoveIfsc(null);

        // Clear success message after 5 seconds
        setTimeout(() => setSuccess(null), 5000);
      } catch (err) {
        console.error("Error removing tie-up:", err);
        const errorMsg = err.response?.data?.message || "Failed to remove tie-up";

        // Check if error is due to active leads
        if (err.response?.data?.code === "ACTIVE_LEADS_WITH_REMOVED_BRANCH") {
          setError(
            `Cannot remove this bank - you have active leads with this branch. Close all leads first.`
          );
        } else {
          setError(errorMsg);
        }
      } finally {
        setRemovingIfsc(null);
      }
    },
    [user, currentTieUps]
  );

  /**
   * Filter available banks based on search and filters
   */
  const filteredAvailableBanks = React.useMemo(() => {
    return availableBanks.filter((bank) => {
      // Check if already tied up
      if (currentTieUps.some((t) => t.ifscCode === bank.ifscCode)) {
        return false;
      }

      // Search filter
      const query = searchQuery.toLowerCase();
      const matchesSearch =
        !query ||
        bank.bankName.toLowerCase().includes(query) ||
        bank.branchName.toLowerCase().includes(query) ||
        bank.ifscCode.toLowerCase().includes(query) ||
        bank.city.toLowerCase().includes(query);

      // City filter
      const matchesCity = filterCity === "All" || bank.city === filterCity;

      // State filter
      const matchesState = filterState === "All" || bank.state === filterState;

      return matchesSearch && matchesCity && matchesState;
    });
  }, [availableBanks, currentTieUps, searchQuery, filterCity, filterState]);

  // Load data on mount
  useEffect(() => {
    if (user) {
      fetchBankTieUps();
    } else {
      navigate("/dealer/login");
    }
  }, [user, navigate, fetchBankTieUps]);

  // Set up auto-refresh interval (check for new banks every 30 seconds)
  useEffect(() => {
    const interval = setInterval(() => {
      fetchBankTieUps();
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchBankTieUps]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-6xl mx-auto">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-gray-200 rounded w-1/4"></div>
            <div className="h-64 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Bank Tie-Up Management
            </h1>
            <p className="text-gray-600 mt-1">
              Manage your dealership's bank partnerships
            </p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            + Add Bank
          </button>
        </div>

        {/* Alerts */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 flex justify-between items-center">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-red-500 hover:text-red-700"
            >
              ✕
            </button>
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 flex justify-between items-center">
            <span>{success}</span>
            <button
              onClick={() => setSuccess(null)}
              className="text-green-500 hover:text-green-700"
            >
              ✕
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Current Tie-Ups Section */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">
                  Your Bank Partners ({currentTieUps.length})
                </h2>
              </div>

              <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
                {currentTieUps.length === 0 ? (
                  <div className="p-6 text-center text-gray-500">
                    <p className="text-sm">No bank tie-ups yet</p>
                    <p className="text-xs mt-2">
                      Click "Add Bank" to add your first partner
                    </p>
                  </div>
                ) : (
                  currentTieUps.map((tieUp) => (
                    <div key={tieUp.ifscCode} className="p-4 hover:bg-gray-50">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-gray-900 truncate">
                            {tieUp.bankName}
                          </h3>
                          <p className="text-sm text-gray-600 truncate">
                            {tieUp.branchName}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            {tieUp.ifscCode}
                          </p>
                        </div>
                        <button
                          onClick={() => setConfirmRemoveIfsc(tieUp.ifscCode)}
                          disabled={removingIfsc === tieUp.ifscCode}
                          className="ml-2 p-2 text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50 flex-shrink-0"
                          title="Remove tie-up"
                        >
                          <svg
                            className="w-4 h-4"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </button>
                      </div>
                      {tieUp.addedAt && (
                        <p className="text-xs text-gray-400 mt-2">
                          Added {new Date(tieUp.addedAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Available Banks Section */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow">
              <div className="p-6 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  Available Banks ({filteredAvailableBanks.length} of{" "}
                  {availableBanks.length})
                </h2>

                {/* Search & Filters */}
                <div className="space-y-4">
                  {/* Search */}
                  <input
                    type="text"
                    placeholder="Search by bank name, branch, IFSC, or city..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />

                  {/* Filters */}
                  <div className="grid grid-cols-2 gap-3">
                    <select
                      value={filterCity}
                      onChange={(e) => setFilterCity(e.target.value)}
                      className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    >
                      {uniqueCities.map((city) => (
                        <option key={city} value={city}>
                          {city === "All" ? "All Cities" : city}
                        </option>
                      ))}
                    </select>

                    <select
                      value={filterState}
                      onChange={(e) => setFilterState(e.target.value)}
                      className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    >
                      {uniqueStates.map((state) => (
                        <option key={state} value={state}>
                          {state === "All" ? "All States" : state}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* Banks List */}
              <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
                {filteredAvailableBanks.length === 0 ? (
                  <div className="p-6 text-center text-gray-500">
                    {availableBanks.length === 0 ? (
                      <>
                        <p className="text-sm font-medium">No banks available yet</p>
                        <p className="text-xs mt-1">
                          Contact admin to register new bank branches
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium">No matching banks found</p>
                        <p className="text-xs mt-1">Try adjusting your search filters</p>
                      </>
                    )}
                  </div>
                ) : (
                  filteredAvailableBanks.map((bank) => (
                    <div
                      key={bank.ifscCode}
                      className="p-4 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-gray-900">
                            {bank.bankName}
                          </h3>
                          <p className="text-sm text-gray-600">
                            {bank.branchName}
                          </p>
                          <div className="flex flex-wrap gap-2 mt-2">
                            <span className="inline-block px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded">
                              {bank.ifscCode}
                            </span>
                            <span className="inline-block px-2 py-1 text-xs bg-gray-100 text-gray-800 rounded">
                              {bank.city}, {bank.state}
                            </span>
                          </div>
                          {bank.email && (
                            <p className="text-xs text-gray-500 mt-2">
                              📧 {bank.email}
                            </p>
                          )}
                          {bank.phone && (
                            <p className="text-xs text-gray-500">
                              📱 {bank.phone}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => handleAddTieUp(bank)}
                          disabled={addingIfsc === bank.ifscCode}
                          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium disabled:opacity-50 whitespace-nowrap flex-shrink-0"
                        >
                          {addingIfsc === bank.ifscCode ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Add"}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Refresh Info */}
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm">
              <p>
                💡 <strong>Tip:</strong> New banks appear automatically as soon as they're
                approved by the admin. This page refreshes every 30 seconds.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Remove Confirmation Modal */}
      {confirmRemoveIfsc && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Remove Bank Tie-Up?
            </h3>
            <p className="text-gray-600 mb-2">
              Are you sure you want to remove this bank from your tie-ups?
            </p>
            <p className="text-sm text-gray-500 mb-6">
              Make sure you have no active leads with this bank before removing.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmRemoveIfsc(null)}
                className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  handleRemoveTieUp(confirmRemoveIfsc);
                }}
                disabled={removingIfsc === confirmRemoveIfsc}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {removingIfsc === confirmRemoveIfsc ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Remove"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
