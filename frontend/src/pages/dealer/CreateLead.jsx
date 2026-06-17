import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext.jsx";
import { CreateLeadPageView } from "./CreateLeadPageView.jsx";
import { useCreateLeadPage } from "./useCreateLeadPage.js";

export default function CreateDealerLead() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const page = useCreateLeadPage({ navigate, user });

  return (
    <CreateLeadPageView
      {...page}
      onCancel={() => navigate("/dealer/leads")}
      onConfigureBanks={() => navigate("/dealer/bank-tieups")}
      onMobileChange={page.handleMobileChange}
      onSubmit={page.handleSubmit}
    />
  );
}
