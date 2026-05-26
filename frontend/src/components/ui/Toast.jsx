export function Toast({ message, type = "success" }) {
  if (!message) return null;
  const tones = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    error: "border-rose-200 bg-rose-50 text-rose-800",
    info: "border-blue-200 bg-blue-50 text-blue-800",
  };
  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm font-semibold shadow-sm ${tones[type] || tones.info}`}>
      {message}
    </div>
  );
}
