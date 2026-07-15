import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { api, getCachedGetData } from "../../services/api.js";
import { filterAvailableBanks, uniqueBankValues } from "./bankTieUps.helpers.js";
import { BankTieUpSettingsView } from "./BankTieUpSettingsView.jsx";

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
  const cachedBankTieUps = getCachedGetData("/dealer/bank-tieups");

  // State Management
  const [currentTieUps, setCurrentTieUps] = useState(() => cachedBankTieUps?.currentTieUps || []);
  const [availableBanks, setAvailableBanks] = useState(() => cachedBankTieUps?.availableBanks || []);
  const [loading, setLoading] = useState(() => !cachedBankTieUps);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCity, setFilterCity] = useState("");
  const [filterState, setFilterState] = useState("");
  const [selectedBankToAdd, setSelectedBankToAdd] = useState(null);

  // Modal & Confirmation State
  const [showAddModal, setShowAddModal] = useState(false);
  const [confirmRemoveIfsc, setConfirmRemoveIfsc] = useState(null);
  const [removingIfsc, setRemovingIfsc] = useState(null);
  const [addingIfsc, setAddingIfsc] = useState(null);

  const uniqueCities = React.useMemo(() => uniqueBankValues(availableBanks, "city"), [availableBanks]);
  const uniqueStates = React.useMemo(() => uniqueBankValues(availableBanks, "state"), [availableBanks]);

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

  const filteredAvailableBanks = React.useMemo(
    () => filterAvailableBanks({ availableBanks, currentTieUps, searchQuery, filterCity, filterState }),
    [availableBanks, currentTieUps, searchQuery, filterCity, filterState]
  );

  // Load data on mount
  useEffect(() => {
    if (user) {
      fetchBankTieUps();
    } else {
      navigate("/dealer/login");
    }
  }, [user, navigate, fetchBankTieUps]);

  if (loading && !currentTieUps.length && !availableBanks.length) {
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
    <BankTieUpSettingsView
      addingIfsc={addingIfsc}
      availableBanks={availableBanks}
      confirmRemoveIfsc={confirmRemoveIfsc}
      currentTieUps={currentTieUps}
      error={error}
      filterCity={filterCity}
      filterState={filterState}
      filteredAvailableBanks={filteredAvailableBanks}
      handleAddTieUp={handleAddTieUp}
      handleRemoveTieUp={handleRemoveTieUp}
      removingIfsc={removingIfsc}
      searchQuery={searchQuery}
      setConfirmRemoveIfsc={setConfirmRemoveIfsc}
      setError={setError}
      setFilterCity={setFilterCity}
      setFilterState={setFilterState}
      setSearchQuery={setSearchQuery}
      setShowAddModal={setShowAddModal}
      setSuccess={setSuccess}
      success={success}
      uniqueCities={uniqueCities}
      uniqueStates={uniqueStates}
    />
  );
}
