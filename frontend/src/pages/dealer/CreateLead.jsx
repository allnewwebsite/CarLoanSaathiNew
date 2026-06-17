import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { api } from "../../services/api.js";
import { CreateLeadForm } from "./CreateLeadForm.jsx";
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
          onCancel={() => navigate("/dealer/leads")}
          onConfigureBanks={() => navigate("/dealer/bank-tieups")}
          onMobileChange={(event) => setFormData((prev) => ({ ...prev, mobile: event.target.value.replace(/\D/g, "").slice(0, 10) }))}
          onSubmit={handleSubmit}
          salespersons={salespersons}
        />
      </div>
    </div>
  );
}


