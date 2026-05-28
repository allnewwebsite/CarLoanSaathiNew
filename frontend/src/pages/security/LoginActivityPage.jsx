import { useEffect, useState } from "react";
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
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Active and Recent Sessions</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-[0.08em] text-slate-500">
              <tr>{["Login Time", "Device", "Browser", "IP", "Last Active", "Status"].map((header) => <th key={header} className="px-4 py-3 font-medium">{header}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payload.sessions.map((session) => (
                <tr key={session.id}>
                  <td className="px-4 py-3">{dateTime(session.loginAt)}</td>
                  <td className="px-4 py-3">{display(session.device)}</td>
                  <td className="px-4 py-3">{display(session.browser)}</td>
                  <td className="px-4 py-3">{display(session.ipAddress)}</td>
                  <td className="px-4 py-3">{dateTime(session.lastSeenAt)}</td>
                  <td className="px-4 py-3">{session.revoked ? "Revoked" : "Active"}</td>
                </tr>
              ))}
              {!payload.sessions.length ? <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No session records.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-900">Security Events</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-[0.08em] text-slate-500">
              <tr>{["Time", "Status", "Reason", "Role", "IP", "User Agent"].map((header) => <th key={header} className="px-4 py-3 font-medium">{header}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payload.activities.map((event) => (
                <tr key={event.id}>
                  <td className="px-4 py-3">{dateTime(event.createdAt)}</td>
                  <td className="px-4 py-3">{display(event.status)}</td>
                  <td className="px-4 py-3">{display(event.reason)}</td>
                  <td className="px-4 py-3">{display(event.role)}</td>
                  <td className="px-4 py-3">{display(event.ipAddress)}</td>
                  <td className="max-w-xs truncate px-4 py-3">{display(event.userAgent)}</td>
                </tr>
              ))}
              {!payload.activities.length ? <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No login activity.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
