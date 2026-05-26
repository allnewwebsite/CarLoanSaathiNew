import { Component } from "react";
import { captureError } from "../services/monitoring.js";

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    captureError(error, { componentStack: info.componentStack });
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
          <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
            <h1 className="text-lg font-semibold text-slate-950">Something went wrong</h1>
            <p className="mt-2 text-sm text-slate-600">Refresh the page to continue.</p>
            <button onClick={() => window.location.reload()} className="mt-5 rounded-md bg-[#0d47a1] px-4 py-2 text-sm font-semibold text-white">
              Refresh
            </button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}
