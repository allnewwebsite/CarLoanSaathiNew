import { Loader2 } from "lucide-react";
import { BankBranchSelector, CustomerDetailsFields, SalespersonSelector, VehicleLoanFields } from "./CreateLeadFormParts.jsx";

export function CreateLeadForm({
  banks,
  cars,
  formData,
  handleInputChange,
  loading,
  loadingBanks,
  loadingCars,
  loadingSalespersons,
  models,
  onCancel,
  onConfigureBanks,
  onMobileChange,
  onSubmit,
  salespersons,
}) {
  return (
    <>
      <form onSubmit={onSubmit} className="bg-white rounded-lg shadow p-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <CustomerDetailsFields formData={formData} handleInputChange={handleInputChange} onMobileChange={onMobileChange} />
          <VehicleLoanFields cars={cars} formData={formData} handleInputChange={handleInputChange} loadingCars={loadingCars} models={models} />

          <BankBranchSelector
            banks={banks}
            formData={formData}
            handleInputChange={handleInputChange}
            loadingBanks={loadingBanks}
            onConfigureBanks={onConfigureBanks}
          />

          <SalespersonSelector
            formData={formData}
            handleInputChange={handleInputChange}
            loadingSalespersons={loadingSalespersons}
            salespersons={salespersons}
          />

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">Remarks</label>
            <textarea
              name="remarks"
              value={formData.remarks}
              onChange={handleInputChange}
              placeholder="Additional notes about this lead"
              rows="3"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="flex gap-4 justify-end mt-8 pt-6 border-t border-gray-200">
          <button
            type="button"
            onClick={onCancel}
            className="px-6 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || loadingBanks || loadingSalespersons || loadingCars || banks.length === 0 || salespersons.length === 0}
            className="inline-flex min-w-32 items-center justify-center rounded-lg bg-blue-600 px-6 py-2 font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : "Create Lead"}
          </button>
        </div>
      </form>

      <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
        <p className="text-sm text-amber-900">
          <strong>Note:</strong> Bank branch selection is mandatory for lead creation. If no banks are available, configure your bank tie-ups in the settings first.
        </p>
      </div>
    </>
  );
}
