import { CreateLeadForm } from "./CreateLeadForm.jsx";

export function CreateLeadPageView({
  banks,
  cars,
  clearError,
  error,
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
  success,
}) {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Create New Lead</h1>
          <p className="text-gray-600 mt-2">Enter customer details and select a bank branch</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 flex justify-between items-center">
            <span>{error}</span>
            <button onClick={clearError} className="text-red-500 hover:text-red-700" aria-label="Dismiss error">
              x
            </button>
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
            <span>{success}</span>
          </div>
        )}

        {(loadingBanks || loadingSalespersons || loadingCars) && (
          <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm font-medium text-blue-900">
            Refreshing latest bank, salesperson, and vehicle data...
          </div>
        )}

        <CreateLeadForm
          banks={banks}
          cars={cars}
          formData={formData}
          handleInputChange={handleInputChange}
          loading={loading}
          loadingBanks={loadingBanks}
          loadingCars={loadingCars}
          loadingSalespersons={loadingSalespersons}
          models={models}
          onCancel={onCancel}
          onConfigureBanks={onConfigureBanks}
          onMobileChange={onMobileChange}
          onSubmit={onSubmit}
          salespersons={salespersons}
        />
      </div>
    </div>
  );
}
