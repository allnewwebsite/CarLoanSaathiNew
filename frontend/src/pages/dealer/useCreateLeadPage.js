import { useCallback, useEffect, useState } from "react";
import { api } from "../../services/api.js";
import {
  buildDealerLeadPayload,
  dealerLeadCreateErrorMessage,
  initialDealerLeadForm,
  normalizeBrandRows,
  normalizeModelRows,
  validateDealerLeadForm,
} from "./createLead.helpers.js";

export function useCreateLeadPage({ navigate, user }) {
  const [formData, setFormData] = useState(initialDealerLeadForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [banks, setBanks] = useState([]);
  const [salespersons, setSalespersons] = useState([]);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [loadingSalespersons, setLoadingSalespersons] = useState(false);
  const [cars, setCars] = useState([]);
  const [models, setModels] = useState([]);
  const [loadingCars, setLoadingCars] = useState(true);

  const brandSlugForName = useCallback((brandName) => {
    const match = cars.find((brand) => brand.name === brandName || brand.slug === brandName);
    return match?.slug || "";
  }, [cars]);

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
  }, []);

  const fetchSalespersons = useCallback(async () => {
    try {
      setLoadingSalespersons(true);
      const response = await api.get("/dealer/salespersons");
      setSalespersons(response.data.salespersons || []);
    } catch (err) {
      console.error("Error fetching salespersons:", err);
    } finally {
      setLoadingSalespersons(false);
    }
  }, []);

  const fetchCars = useCallback(async () => {
    try {
      setLoadingCars(true);
      const response = await api.get("/brands");
      setCars(normalizeBrandRows(response.data));
    } catch (err) {
      console.error("Error fetching cars:", err);
    } finally {
      setLoadingCars(false);
    }
  }, []);

  const fetchModelsForBrand = useCallback(async (brand) => {
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
  }, [brandSlugForName]);

  const handleInputChange = (event) => {
    const { name, value } = event.target;
    setFormData((current) => ({ ...current, [name]: value }));
    if (name === "selectedBrand") fetchModelsForBrand(value);
  };

  const handleMobileChange = (event) => {
    setFormData((current) => ({ ...current, mobile: event.target.value.replace(/\D/g, "").slice(0, 10) }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const validationErrors = validateDealerLeadForm(formData);
    if (validationErrors.length > 0) {
      setError(validationErrors[0]);
      return;
    }

    try {
      setLoading(true);
      const payload = buildDealerLeadPayload(formData, banks);
      const response = await api.post("/dealer/leads", payload);
      setSuccess(`Lead created successfully! Case ID: ${response.data.caseId}`);
      window.setTimeout(() => {
        navigate(`/dealer/leads/${response.data.leadId}`);
      }, 2000);
    } catch (err) {
      console.error("Error creating lead:", err);
      setError(dealerLeadCreateErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) {
      navigate("/login");
      return;
    }

    fetchBankTieUps();
    fetchSalespersons();
    fetchCars();
  }, [user, navigate, fetchBankTieUps, fetchSalespersons, fetchCars]);

  return {
    banks,
    cars,
    clearError: () => setError(null),
    error,
    formData,
    handleInputChange,
    handleMobileChange,
    handleSubmit,
    loading,
    loadingBanks,
    loadingCars,
    loadingSalespersons,
    models,
    salespersons,
    success,
  };
}
