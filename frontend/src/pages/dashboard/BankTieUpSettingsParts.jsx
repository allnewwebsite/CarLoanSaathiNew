import { Loader2 } from "lucide-react";

export function BankTieUpAlert({ message, tone, onClose }) {
  if (!message) return null;
  const classes = tone === "error"
    ? "mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 flex justify-between items-center"
    : "mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700 flex justify-between items-center";
  return (
    <div className={classes}>
      <span>{message}</span>
      <button onClick={onClose} className={tone === "error" ? "text-red-500 hover:text-red-700" : "text-green-500 hover:text-green-700"}>
        x
      </button>
    </div>
  );
}

export function CurrentTieUpsPanel({ currentTieUps, removingIfsc, setConfirmRemoveIfsc }) {
  return (
    <div className="lg:col-span-1">
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Your Bank Partners ({currentTieUps.length})</h2>
        </div>

        <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
          {currentTieUps.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              <p className="text-sm">No bank tie-ups yet</p>
              <p className="text-xs mt-2">Click "Add Bank" to add your first partner</p>
            </div>
          ) : (
            currentTieUps.map((tieUp) => (
              <div key={tieUp.ifscCode} className="p-4 hover:bg-gray-50">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-gray-900 truncate">{tieUp.bankName}</h3>
                    <p className="text-sm text-gray-600 truncate">{tieUp.branchName}</p>
                    <p className="text-xs text-gray-500 mt-1">{tieUp.ifscCode}</p>
                  </div>
                  <button
                    onClick={() => setConfirmRemoveIfsc(tieUp.ifscCode)}
                    disabled={removingIfsc === tieUp.ifscCode}
                    className="ml-2 p-2 text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50 flex-shrink-0"
                    title="Remove tie-up"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
                {tieUp.addedAt && <p className="text-xs text-gray-400 mt-2">Added {new Date(tieUp.addedAt).toLocaleDateString()}</p>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function AvailableBanksPanel({
  addingIfsc,
  availableBanks,
  filterCity,
  filterState,
  filteredAvailableBanks,
  handleAddTieUp,
  searchQuery,
  setFilterCity,
  setFilterState,
  setSearchQuery,
  uniqueCities,
  uniqueStates,
}) {
  return (
    <div className="lg:col-span-2">
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Available Banks ({filteredAvailableBanks.length} of {availableBanks.length})</h2>
          <div className="space-y-4">
            <input
              type="text"
              placeholder="Search by bank name, branch, IFSC, or city..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="grid grid-cols-2 gap-3">
              <select value={filterCity} onChange={(e) => setFilterCity(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
                <option value="">Select City</option>
                {uniqueCities.filter((city) => city !== "All").map((city) => <option key={city} value={city}>{city}</option>)}
              </select>
              <select value={filterState} onChange={(e) => setFilterState(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
                <option value="">Select State</option>
                {uniqueStates.filter((state) => state !== "All").map((state) => <option key={state} value={state}>{state}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
          {filteredAvailableBanks.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              {availableBanks.length === 0 ? (
                <>
                  <p className="text-sm font-medium">No banks available yet</p>
                  <p className="text-xs mt-1">Contact admin to register new bank branches</p>
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
              <div key={bank.ifscCode} className="p-4 hover:bg-gray-50 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-gray-900">{bank.bankName}</h3>
                    <p className="text-sm text-gray-600">{bank.branchName}</p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      <span className="inline-block px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded">{bank.ifscCode}</span>
                      <span className="inline-block px-2 py-1 text-xs bg-gray-100 text-gray-800 rounded">{bank.city}, {bank.state}</span>
                    </div>
                    {bank.email && <p className="text-xs text-gray-500 mt-2">Email: {bank.email}</p>}
                    {bank.phone && <p className="text-xs text-gray-500">Phone: {bank.phone}</p>}
                  </div>
                  <button onClick={() => handleAddTieUp(bank)} disabled={addingIfsc === bank.ifscCode} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium disabled:opacity-50 whitespace-nowrap flex-shrink-0">
                    {addingIfsc === bank.ifscCode ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Add"}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm">
        <p><strong>Tip:</strong> New banks appear automatically as soon as they're approved by the admin. This page refreshes every 30 seconds.</p>
      </div>
    </div>
  );
}

export function RemoveTieUpModal({ confirmRemoveIfsc, handleRemoveTieUp, removingIfsc, setConfirmRemoveIfsc }) {
  if (!confirmRemoveIfsc) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Remove Bank Tie-Up?</h3>
        <p className="text-gray-600 mb-2">Are you sure you want to remove this bank from your tie-ups?</p>
        <p className="text-sm text-gray-500 mb-6">Make sure you have no active leads with this bank before removing.</p>
        <div className="flex gap-3 justify-end">
          <button onClick={() => setConfirmRemoveIfsc(null)} className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={() => handleRemoveTieUp(confirmRemoveIfsc)} disabled={removingIfsc === confirmRemoveIfsc} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50">
            {removingIfsc === confirmRemoveIfsc ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Remove"}
          </button>
        </div>
      </div>
    </div>
  );
}
