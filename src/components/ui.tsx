import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SolverState } from "../types";

export function AppHeader({ device, state }: { device: "pn" | "bjt"; state: SolverState }) {
  const status = state === "idle" ? "Not solved" : state === "solving" ? "Solving…" : state === "converged" ? "Converged" : "Failed";
  return (
    <header className="app-header">
      <div className="brand-lockup">
        <span className="brand-mark">DD</span>
        <div>
          <span className="eyebrow">Drift–diffusion</span>
          <strong>Semiconductor Devices Lab</strong>
        </div>
      </div>
      <nav className="device-switcher" aria-label="Device laboratories">
        <a href="./index.html" aria-current={device === "pn" ? "page" : undefined}>PN diode</a>
        <a href="./bjt.html" aria-current={device === "bjt" ? "page" : undefined}>NPN transistor</a>
      </nav>
      <output className="status-pill" data-state={state} aria-live="polite"><span />{status}</output>
    </header>
  );
}

export function LabLayout({ controls, children }: { controls: ReactNode; children: ReactNode }) {
  const desktop = useMediaQuery("(min-width: 901px)");
  const [controlsOpen, setControlsOpen] = useState(desktop);
  useEffect(() => setControlsOpen(desktop), [desktop]);
  return (
    <main className="lab-layout">
      <details className="control-panel" open={controlsOpen} onToggle={(event) => setControlsOpen(event.currentTarget.open)}>
        <summary><span>Configuration</span><small>Device, sweep, and numerics</small></summary>
        <div className="control-panel-content">{controls}</div>
      </details>
      <section className="workspace">{children}</section>
    </main>
  );
}

export function MetricGrid({ entries, compact = false }: { entries: Array<[ReactNode, ReactNode]>; compact?: boolean }) {
  return (
    <dl className={`metric-grid${compact ? " metric-grid-compact" : ""}`}>
      {entries.map(([term, value], index) => <div key={index}><dt>{term}</dt><dd>{value}</dd></div>)}
    </dl>
  );
}

export function Field({ label, children, help }: { label: ReactNode; children: ReactNode; help?: string }) {
  return <label className="field"><span>{label}</span>{children}{help && <small>{help}</small>}</label>;
}

export function Disclosure({ eyebrow, title, summary, children, open = false }: {
  eyebrow: string;
  title: string;
  summary: string;
  children: ReactNode;
  open?: boolean;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (open && detailsRef.current) detailsRef.current.open = true;
  }, [open]);
  return (
    <details ref={detailsRef} className="result-disclosure">
      <summary><span className="eyebrow">{eyebrow}</span><strong>{title}</strong><small>{summary}</small></summary>
      <div className="disclosure-content">{children}</div>
    </details>
  );
}

export function Message({ state, children }: { state: "ready" | "warning" | "error" | "idle" | "pass"; children: ReactNode }) {
  return <div className="message" data-state={state}>{children}</div>;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}
