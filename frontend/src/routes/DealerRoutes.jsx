/**
 * Dealer Dashboard Routes
 * Contains all routes for finance desk dealership portal
 */

import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import DealerLayout from "../layouts/DealerLayout";

// Pages
import DealerDashboard from "../pages/dealer/Dashboard";
import CreateLead from "../pages/dealer/CreateLead";
import LeadDetails from "../pages/dealer/LeadDetails";
import LeadsList from "../pages/dealer/LeadsList";
import SalespersonsList from "../pages/dealer/SalespersonsList";
import StaffManagement from "../pages/dealer/StaffManagement";
import ProfileSettings from "../pages/dealer/ProfileSettings";
import BankTieUpSettings from "../pages/dashboard/BankTieUpSettings"; // NEW
import Earnings from "../pages/dealer/Earnings";

export default function DealerRoutes() {
  return (
    <Routes>
      <Route element={<DealerLayout />}>
        {/* Dashboard */}
        <Route path="/" element={<DealerDashboard />} />
        <Route path="/dashboard" element={<Navigate to="/" replace />} />

        {/* Leads */}
        <Route path="/leads" element={<LeadsList />} />
        <Route path="/leads/:id" element={<LeadDetails />} />
        <Route path="/create-lead" element={<CreateLead />} />

        {/* Bank Tie-Ups - NEW */}
        <Route path="/bank-tieups" element={<BankTieUpSettings />} />

        {/* Staff Management */}
        <Route path="/salespersons" element={<SalespersonsList />} />
        <Route path="/staff" element={<StaffManagement />} />

        {/* Settings */}
        <Route path="/profile" element={<ProfileSettings />} />
        <Route path="/earnings" element={<Earnings />} />

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
