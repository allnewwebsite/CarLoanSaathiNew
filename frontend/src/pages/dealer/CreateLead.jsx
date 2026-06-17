import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../services/api.js";
import {
  buildDealerLeadPayload,
  dealerLeadCreateErrorMessage,
  initialDealerLeadForm,
  normalizeBrandRows,
  normalizeModelRows,
  validateDealerLeadForm,
} from "./createLead.helpers.js";

/**
 * Lead Creation Component with Dynamic Bank Branch Selection
 * 
 * Features:
 * - Form validation with Zod schema
 * - Mandatory bank branch selection from dealership tie-ups
 * - Real-time branch availability
 * - Salesperson selection
 * - Document upload support
 * - Comprehensive error handling
 */
export default function CreateDealerLead() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Form State
  const [formData, setFormData] = useState(initialDealerLeadForm);

  // UI State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [banks, setBanks] = useState([]);
  const [salespersons, setSalespersons] = useState([]);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [loadingSalespersons, setLoadingSalespersons] = useState(false);

  // Additional UI State
  const [cars, setCars] = useState([]);
  const [models, setModels] = useState([]);
  const [loadingCars, setLoadingCars] = useState(true);
  const [documents, setDocuments] = useState([]);

  const brandSlugForName = useCallback((brandName) => {
    const match = cars.find((brand) => brand.name === brandName || brand.slug === brandName);
    return match?.slug || "";
  }, [cars]);

  /**
   * Fetch dealership's bank tie-ups
   */
  const fetchBankTieUps = useCallback(async () => {
    try {
      setLoadingBanks(true);
      const response = await api.get("/dealer/bank-tieups");

      setBanks(response.data.currentTieUps || []);
    } catch (err) {
      console.error("Error fetching banks:", err);
      setError("Failed to load available banks");
    } finally {
      setLoadingBanks(false);
    }
  }, [user]);

  /**
   * Fetch dealership's salespersons
   */
  const fetchSalespersons = useCallback(async () => {
    try {
      setLoadingSalespersons(true);
      const response = await api.get("/dealer/salespersons");

      setSalespersons(response.data.salespersons || []);
    } catch (err) {
      console.error("Error fetching salespersons:", err);
      // Don't show error for this - salespersons might not exist
    } finally {
      setLoadingSalespersons(false);
    }
  }, [user]);

  /**
   * Fetch available car brands and models
   */
  const fetchCars = useCallback(async () => {
    try {
      setLoadingCars(true);
      const response = await api.get("/brands");
      setCars(normalizeBrandRows(response.data));
    } catch (err) {
      console.error("Error fetching cars:", err);
      // Fall back to empty list
    } finally {
      setLoadingCars(false);
    }
  }, [user]);

  /**
   * Fetch models for selected brand
   */
  const fetchModelsForBrand = useCallback(
    async (brand) => {
      if (!brand) {
        setModels([]);
        return;
      }

      try {
        const brandSlug = brandSlugForName(brand);
        if (!brandSlug) {
          setModels([]);
          return;
        }
        const response = await api.get(`/cars/${brandSlug}`);
        setModels(normalizeModelRows(response.data));
      } catch (err) {
        console.error("Error fetching models:", err);
        setModels([]);
      }
    },
    [brandSlugForName]
  );

  /**
   * Handle form input change
   */
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));

    // Fetch models when brand changes
    if (name === "selectedBrand") {
      fetchModelsForBrand(value);
    }
  };

  /**
   * Submit lead creation form
   */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    // Validate form
    const validationErrors = validateDealerLeadForm(formData);
    if (validationErrors.length > 0) {
      setError(validationErrors[0]);
      return;
    }

    try {
      setLoading(true);

      const payload = buildDealerLeadPayload(formData, banks);

      const response = await api.post("/dealer/leads", payload);

      setSuccess(
        `Lead created successfully! Case ID: ${response.data.caseId}`
      );

      // Redirect to lead details after 2 seconds
      setTimeout(() => {
        navigate(`/dealer/leads/${response.data.leadId}`);
      }, 2000);
    } catch (err) {
      console.error("Error creating lead:", err);
      setError(dealerLeadCreateErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // Load initial data
  useEffect(() => {
    if (!user) {
      navigate("/login");
      return;
    }

    fetchBankTieUps();
    fetchSalespersons();
    fetchCars();
  }, [user, navigate, fetchBankTieUps, fetchSalespersons, fetchCars]);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Create New Lead</h1>
          <p className="text-gray-600 mt-2">
            Enter customer details and select a bank branch
          </p>
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
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
            <span>{success}</span>
          </div>
        )}

        {(loadingBanks || loadingSalespersons || loadingCars) && (
          <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm font-medium text-blue-900">
            Refreshing latest bank, salesperson, and vehicle data...
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Customer Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Customer Name <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                name="fullName"
                value={formData.fullName}
                onChange={handleInputChange}
                placeholder="Full name"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            {/* Mobile */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Mobile Number <span className="text-red-600">*</span>
              </label>
              <div className="flex overflow-hidden rounded-lg border border-gray-300 bg-white focus-within:ring-2 focus-within:ring-blue-500">
                <span className="inline-flex items-center border-r border-gray-300 bg-gray-50 px-3 text-sm font-semibold text-gray-700">+91</span>
                <input
                  type="tel"
                  name="mobile"
                  value={formData.mobile}
                  onChange={(event) => setFormData((prev) => ({ ...prev, mobile: event.target.value.replace(/\D/g, "").slice(0, 10) }))}
                  placeholder="10-digit number"
                  maxLength={10}
                  inputMode="numeric"
                  className="w-full px-4 py-2 focus:outline-none"
                  required
                />
              </div>
            </div>

            {/* Email */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email
              </label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                placeholder="Email address (optional)"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* City */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                City <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                name="city"
                value={formData.city}
                onChange={handleInputChange}
                placeholder="City name"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            {/* Employment Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Employment Type <span className="text-red-600">*</span>
              </label>
              <select
                name="employmentType"
                value={formData.employmentType}
                onChange={handleInputChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="">Select employment type</option>
                <option value="Salaried">Salaried</option>
                <option value="Self-Employed">Self-Employed</option>
                <option value="Freelancer">Freelancer</option>
                <option value="Business">Business</option>
              </select>
            </div>

            {/* Car Brand */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Car Brand <span className="text-red-600">*</span>
              </label>
              <select
                name="selectedBrand"
                value={formData.selectedBrand}
                onChange={handleInputChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
                disabled={loadingCars}
              >
                <option value="">{loadingCars ? "Loading brands..." : "Select brand"}</option>
                {cars.map((brand) => (
                  <option key={brand.slug} value={brand.name}>
                    {brand.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Car Model */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Car Model <span className="text-red-600">*</span>
              </label>
              <select
                name="selectedModel"
                value={formData.selectedModel}
                onChange={handleInputChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
                disabled={loadingCars || !formData.selectedBrand}
              >
                <option value="">
                  {loadingCars ? "Loading models..." : formData.selectedBrand ? "Select model" : "Select brand first"}
                </option>
                {models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </div>

            {/* Car Price */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Car Price (₹) <span className="text-red-600">*</span>
              </label>
              <input
                type="number"
                name="carPrice"
                value={formData.carPrice}
                onChange={handleInputChange}
                placeholder="0.00"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            {/* Loan Amount */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Loan Amount (₹) <span className="text-red-600">*</span>
              </label>
              <input
                type="number"
                name="loanAmount"
                value={formData.loanAmount}
                onChange={handleInputChange}
                placeholder="0.00"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>

            {/* Bank Branch Selection - NEW REQUIRED FIELD */}
            <div className="md:col-span-2 bg-blue-50 p-4 rounded-lg border border-blue-200">
              <label className="block text-sm font-semibold text-blue-900 mb-2">
                Select Bank Branch <span className="text-red-600">*</span>
              </label>
              {loadingBanks && !banks.length ? (
                <div className="text-sm text-blue-800 p-3 bg-blue-100 rounded">
                  Loading approved bank branches...
                </div>
              ) : banks.length === 0 ? (
                <div className="text-sm text-blue-800 p-3 bg-blue-100 rounded">
                  <p className="font-medium mb-1">No bank tie-ups configured</p>
                  <p className="text-xs">
                    Go to{" "}
                    <button
                      type="button"
                      onClick={() => navigate("/dealer/bank-tieups")}
                      className="font-bold underline"
                    >
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
                        <p className="font-medium text-gray-900">
                          {bank.bankName}
                        </p>
                        <p className="text-sm text-gray-600">{bank.branchName}</p>
                        <p className="text-xs text-gray-500">
                          {bank.ifscCode} • {bank.city}, {bank.state}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Salesperson */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Assigned Salesperson <span className="text-red-600">*</span>
              </label>
              {loadingSalespersons && !salespersons.length ? (
                <div className="text-sm text-gray-600 p-3 bg-gray-100 rounded">
                  Loading salespersons...
                </div>
              ) : salespersons.length === 0 ? (
                <div className="text-sm text-gray-600 p-3 bg-gray-100 rounded">
                  No salespersons available. Please create salespersons first.
                </div>
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

            {/* Remarks */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Remarks
              </label>
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

          {/* Buttons */}
          <div className="flex gap-4 justify-end mt-8 pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={() => navigate("/dealer/leads")}
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

        {/* Info Box */}
        <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-sm text-amber-900">
            <strong>Note:</strong> Bank branch selection is mandatory for lead creation.
            If no banks are available, configure your bank tie-ups in the settings first.
          </p>
        </div>
      </div>
    </div>
  );
}
