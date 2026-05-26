import { cn } from "../../lib/utils.js";

const variants = {
  primary: "bg-[#0d47a1] text-white hover:bg-[#083b86]",
  secondary: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
  ghost: "text-slate-600 hover:bg-slate-50 hover:text-[#0d47a1]",
};

export function Button({ className = "", variant = "primary", ...props }) {
  return (
    <button
      className={cn("inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium transition duration-150 disabled:cursor-not-allowed disabled:opacity-60", variants[variant], className)}
      {...props}
    />
  );
}
