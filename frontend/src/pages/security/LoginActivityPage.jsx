import { useEffect, useState } from "react";
import { OperationalTable } from "../../components/OperationalTable.jsx";
import { api } from "../../services/api.js";

function dateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function display(value) {
  return value || "-";
}

export function LoginActivityPage() {
  const [payload, setPayload] = useState({ activities: [], sessions: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api.get("/auth/login-activity")
      .then((response) => { if (active) setPayload(response.data || { activities: [], sessions: [] }); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  if (loading) return <section className="card p-5 text-sm text-slate-500">Loading security activity...</section>;

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Login Activity</h2>
        <p className="mt-1 text-sm text-slate-500">Recent login, password, and session events for this account.</p>
      </div>
      <OperationalTable
        title="Active and Recent Sessions"
        headers={["Login Time", "Device", "Browser", "IP", "Last Active", "Status"]}
        rows={payload.sessions.map((session) => ({ key: session.id, cells: [dateTime(session.loginAt), display(session.device), display(session.browser), display(session.ipAddress), dateTime(session.lastSeenAt), session.revoked ? "Revoked" : "Active"] }))}
        loading={false}
      />
      <OperationalTable
        title="Security Events"
        headers={["Time", "Status", "Reason", "Role", "IP", "User Agent"]}
        rows={payload.activities.map((event) => ({ key: event.id, cells: [dateTime(event.createdAt), display(event.status), display(event.reason), display(event.role), display(event.ipAddress), display(event.userAgent)] }))}
        loading={false}
      />
    </section>
  );
}
