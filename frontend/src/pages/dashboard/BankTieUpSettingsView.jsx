import {
  AvailableBanksPanel,
  BankTieUpAlert,
  CurrentTieUpsPanel,
  RemoveTieUpModal,
} from "./BankTieUpSettingsParts.jsx";

export function BankTieUpSettingsView({
  addingIfsc,
  availableBanks,
  confirmRemoveIfsc,
  currentTieUps,
  error,
  filterCity,
  filterState,
  filteredAvailableBanks,
  handleAddTieUp,
  handleRemoveTieUp,
  removingIfsc,
  searchQuery,
  setConfirmRemoveIfsc,
  setError,
  setFilterCity,
  setFilterState,
  setSearchQuery,
  setShowAddModal,
  setSuccess,
  success,
  uniqueCities,
  uniqueStates,
}) {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Bank Tie-Up Management</h1>
            <p className="text-gray-600 mt-1">Manage your dealership's bank partnerships</p>
          </div>
          <button onClick={() => setShowAddModal(true)} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium">
            + Add Bank
          </button>
        </div>

        <BankTieUpAlert message={error} tone="error" onClose={() => setError(null)} />
        <BankTieUpAlert message={success} tone="success" onClose={() => setSuccess(null)} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <CurrentTieUpsPanel currentTieUps={currentTieUps} removingIfsc={removingIfsc} setConfirmRemoveIfsc={setConfirmRemoveIfsc} />
          <AvailableBanksPanel
            addingIfsc={addingIfsc}
            availableBanks={availableBanks}
            filterCity={filterCity}
            filterState={filterState}
            filteredAvailableBanks={filteredAvailableBanks}
            handleAddTieUp={handleAddTieUp}
            searchQuery={searchQuery}
            setFilterCity={setFilterCity}
            setFilterState={setFilterState}
            setSearchQuery={setSearchQuery}
            uniqueCities={uniqueCities}
            uniqueStates={uniqueStates}
          />
        </div>
      </div>

      <RemoveTieUpModal
        confirmRemoveIfsc={confirmRemoveIfsc}
        handleRemoveTieUp={handleRemoveTieUp}
        removingIfsc={removingIfsc}
        setConfirmRemoveIfsc={setConfirmRemoveIfsc}
      />
    </div>
  );
}
