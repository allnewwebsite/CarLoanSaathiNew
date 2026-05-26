import { Link } from "react-router-dom";

const variants = {
  primary: "bg-[#0d47a1] text-white hover:bg-[#083b86]",
  brand: "bg-[#0d47a1] text-white hover:bg-[#083b86]",
  ghost: "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 hover:text-[#0d47a1]",
  subtle: "bg-slate-50 text-slate-800 hover:bg-white hover:ring-1 hover:ring-slate-200",
};

export function Button({ children, to, className = "", variant = "primary", ...props }) {
  const classes = `inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium transition ${variants[variant]} ${className}`;
  if (to) return <Link className={classes} to={to}>{children}</Link>;
  return <button className={classes} {...props}>{children}</button>;
}
