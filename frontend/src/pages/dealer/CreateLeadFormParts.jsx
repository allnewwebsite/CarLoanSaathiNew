export function CustomerDetailsFields({ formData, handleInputChange, onMobileChange }) {
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Customer Name <span className="text-red-600">*</span>
        </label>
        <input type="text" name="fullName" value={formData.fullName} onChange={handleInputChange} placeholder="Full name" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" required />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Mobile Number <span className="text-red-600">*</span>
        </label>
        <div className="flex overflow-hidden rounded-lg border border-gray-300 bg-white focus-within:ring-2 focus-within:ring-blue-500">
          <span className="inline-flex items-center border-r border-gray-300 bg-gray-50 px-3 text-sm font-semibold text-gray-700">+91</span>
          <input type="tel" name="mobile" value={formData.mobile} onChange={onMobileChange} placeholder="10-digit number" maxLength={10} inputMode="numeric" className="w-full px-4 py-2 focus:outline-none" required />
        </div>
      </div>

      <div className="md:col-span-2">
        <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
        <input type="email" name="email" value={formData.email} onChange={handleInputChange} placeholder="Email address (optional)" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          City <span className="text-red-600">*</span>
        </label>
        <input type="text" name="city" value={formData.city} onChange={handleInputChange} placeholder="City name" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" required />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Employment Type <span className="text-red-600">*</span>
        </label>
        <select name="employmentType" value={formData.employmentType} onChange={handleInputChange} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" required>
          <option value="">Select employment type</option>
          <option value="Salaried">Salaried</option>
          <option value="Self-Employed">Self-Employed</option>
          <option value="Freelancer">Freelancer</option>
          <option value="Business">Business</option>
        </select>
      </div>
    </>
  );
}

export function VehicleLoanFields({ cars, formData, handleInputChange, loadingCars, models }) {
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Car Brand <span className="text-red-600">*</span>
        </label>
        <select name="selectedBrand" value={formData.selectedBrand} onChange={handleInputChange} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" required disabled={loadingCars}>
          <option value="">{loadingCars ? "Loading brands..." : "Select brand"}</option>
          {cars.map((brand) => <option key={brand.slug} value={brand.name}>{brand.name}</option>)}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Car Model <span className="text-red-600">*</span>
        </label>
        <select name="selectedModel" value={formData.selectedModel} onChange={handleInputChange} className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" required disabled={loadingCars || !formData.selectedBrand}>
          <option value="">{loadingCars ? "Loading models..." : formData.selectedBrand ? "Select model" : "Select brand first"}</option>
          {models.map((model) => <option key={model} value={model}>{model}</option>)}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Car Price (Rs.) <span className="text-red-600">*</span>
        </label>
        <input type="number" name="carPrice" value={formData.carPrice} onChange={handleInputChange} placeholder="0.00" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" required />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Loan Amount (Rs.) <span className="text-red-600">*</span>
        </label>
        <input type="number" name="loanAmount" value={formData.loanAmount} onChange={handleInputChange} placeholder="0.00" className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" required />
      </div>
    </>
  );
}

export function BankBranchSelector({ banks, formData, handleInputChange, loadingBanks, onConfigureBanks }) {
  return (
    <div className="md:col-span-2 bg-blue-50 p-4 rounded-lg border border-blue-200">
      <label className="block text-sm font-semibold text-blue-900 mb-2">
        Select Bank Branch <span className="text-red-600">*</span>
      </label>
      {loadingBanks && !banks.length ? (
        <div className="text-sm text-blue-800 p-3 bg-blue-100 rounded">Loading approved bank branches...</div>
      ) : banks.length === 0 ? (
        <div className="text-sm text-blue-800 p-3 bg-blue-100 rounded">
          <p className="font-medium mb-1">No bank tie-ups configured</p>
          <p className="text-xs">
            Go to{" "}
            <button type="button" onClick={onConfigureBanks} className="font-bold underline">
              Bank Tie-Up Settings
            </button>{" "}
            to add banks
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {banks.map((bank) => (
            <label
              key={bank.ifscCode}
              className="flex items-start gap-3 p-3 border border-blue-300 rounded-lg hover:bg-blue-100 cursor-pointer transition-colors"
            >
              <input
                type="radio"
                name="ifscCode"
                value={bank.ifscCode}
                checked={formData.ifscCode === bank.ifscCode}
                onChange={handleInputChange}
                className="mt-1"
                required
              />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900">{bank.bankName}</p>
                <p className="text-sm text-gray-600">{bank.branchName}</p>
                <p className="text-xs text-gray-500">
                  {bank.ifscCode} - {bank.city}, {bank.state}
                </p>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function SalespersonSelector({ formData, handleInputChange, loadingSalespersons, salespersons }) {
  return (
    <div className="md:col-span-2">
      <label className="block text-sm font-medium text-gray-700 mb-2">
        Assigned Salesperson <span className="text-red-600">*</span>
      </label>
      {loadingSalespersons && !salespersons.length ? (
        <div className="text-sm text-gray-600 p-3 bg-gray-100 rounded">Loading salespersons...</div>
      ) : salespersons.length === 0 ? (
        <div className="text-sm text-gray-600 p-3 bg-gray-100 rounded">No salespersons available. Please create salespersons first.</div>
      ) : (
        <select
          name="salespersonId"
          value={formData.salespersonId}
          onChange={handleInputChange}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          required
        >
          <option value="">Select salesperson</option>
          {salespersons.map((sp) => (
            <option key={sp.id} value={sp.id}>
              {sp.name} {sp.jobId ? `(${sp.jobId})` : ""}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
