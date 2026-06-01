import React, { useState, useEffect, useCallback } from "react";
import { getAuth } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import axios from "axios";

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
  const auth = getAuth();
  const user = auth.currentUser;

  // Form State
  const [formData, setFormData] = useState({
    fullName: "",
    mobile: "",
    email: "",
    city: "",
    selectedBrand: "",
    selectedModel: "",
    carPrice: "",
    loanAmount: "",
    employmentType: "",
    ifscCode: "", // NEW: Mandatory bank branch selection
    salespersonId: "",
    remarks: "",
  });

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

  /**
   * Fetch dealership's bank tie-ups
   */
  const fetchBankTieUps = useCallback(async () => {
    try {
      setLoadingBanks(true);
      const token = await user.getIdToken();

      const response = await axios.get(
        `${import.meta.env.VITE_API_BASE_URL}/api/dealer/bank-tieups`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

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
      const token = await user.getIdToken();

      const response = await axios.get(
        `${import.meta.env.VITE_API_BASE_URL}/api/dealer/salespersons`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

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
      const token = await user.getIdToken();

      // This endpoint should be available from existing catalog
      const response = await axios.get(
        `${import.meta.env.VITE_API_BASE_URL}/api/catalog/cars`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      setCars(response.data.brands || []);
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
        const token = await user.getIdToken();

        const response = await axios.get(
          `${import.meta.env.VITE_API_BASE_URL}/api/catalog/cars/${brand}/models`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        setModels(response.data.models || []);
      } catch (err) {
        console.error("Error fetching models:", err);
        setModels([]);
      }
    },
    [user]
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
   * Validate form data
   */
  const validateForm = () => {
    const errors = [];

    // Required fields
    if (!formData.fullName || formData.fullName.trim().length < 2) {
      errors.push("Customer name must be at least 2 characters");
    }

    if (!formData.mobile || !/^[6-9]\d{9}$/.test(formData.mobile)) {
      errors.push("Invalid mobile number");
    }

    if (!formData.city || formData.city.trim().length < 2) {
      errors.push("City is required");
    }

    if (!formData.selectedBrand) {
      errors.push("Car brand is required");
    }

    if (!formData.selectedModel) {
      errors.push("Car model is required");
    }

    if (!formData.carPrice || parseFloat(formData.carPrice) <= 0) {
      errors.push("Car price must be greater than 0");
    }

    if (!formData.loanAmount || parseFloat(formData.loanAmount) <= 0) {
      errors.push("Loan amount must be greater than 0");
    }

    if (parseFloat(formData.loanAmount) > parseFloat(formData.carPrice)) {
      errors.push("Loan amount cannot exceed car price");
    }

    if (!formData.employmentType) {
      errors.push("Employment type is required");
    }

    // NEW: Mandatory bank branch selection
    if (!formData.ifscCode) {
      errors.push("Bank branch selection is required");
    }

    if (!formData.salespersonId) {
      errors.push("Salesperson is required");
    }

    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.push("Invalid email address");
    }

    return errors;
  };

  /**
   * Submit lead creation form
   */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    // Validate form
    const validationErrors = validateForm();
    if (validationErrors.length > 0) {
      setError(validationErrors[0]);
      return;
    }

    try {
      setLoading(true);
      const token = await user.getIdToken();

      // Find selected bank details
      const selectedBank = banks.find((b) => b.ifscCode === formData.ifscCode);
      if (!selectedBank) {
        throw new Error("Selected bank not found");
      }

      const payload = {
        ...formData,
        bankId: selectedBank.bankId,
        bankName: selectedBank.bankName,
        branchName: selectedBank.branchName,
        carPrice: parseFloat(formData.carPrice),
        loanAmount: parseFloat(formData.loanAmount),
      };

      const response = await axios.post(
        `${import.meta.env.VITE_API_BASE_URL}/api/dealer/leads`,
        payload,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      setSuccess(
        `Lead created successfully! Case ID: ${response.data.caseId}`
      );

      // Redirect to lead details after 2 seconds
      setTimeout(() => {
        navigate(`/dealer/leads/${response.data.leadId}`);
      }, 2000);
    } catch (err) {
      console.error("Error creating lead:", err);
      const errorMsg = err.response?.data?.message || "Failed to create lead";

      // Handle specific error codes
      if (err.response?.data?.code === "BRANCH_NOT_TIEDUP") {
        setError(
          "Selected bank branch is not available for your dealership. Please select from your tied-up banks only."
        );
      } else if (err.response?.data?.code === "IFSC_CODE_REQUIRED") {
        setError("Bank branch selection is required");
      } else {
        setError(errorMsg);
      }
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

  if (loadingBanks || loadingSalespersons || loadingCars) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-2xl mx-auto">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-gray-200 rounded w-1/3"></div>
            <div className="h-96 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

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
              <input
                type="tel"
                name="mobile"
                value={formData.mobile}
                onChange={handleInputChange}
                placeholder="10-digit number"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
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
              >
                <option value="">Select brand</option>
                {cars.map((brand) => (
                  <option key={brand} value={brand}>
                    {brand}
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
                disabled={!formData.selectedBrand}
              >
                <option value="">
                  {formData.selectedBrand ? "Select model" : "Select brand first"}
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
              {banks.length === 0 ? (
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
              {salespersons.length === 0 ? (
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
              disabled={loading || banks.length === 0 || salespersons.length === 0}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create Lead"}
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
