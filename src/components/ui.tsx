import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChartLine, SettingsAdjust } from "@carbon/react/icons";
import { ScientificHeader, ScientificTaskPanel, ScientificToolRail } from "@jorpago2/scientific-ui";
import type { SolverState } from "../types";

export function AppHeader({ device, state, onRun, onCancel }: { device: "pn" | "bjt"; state: SolverState; onRun: () => void; onCancel: () => void }) {
  const status = state === "idle" ? "Not solved" : state === "solving" ? "Solving…" : state === "converged" ? "Converged" : "Failed";
  const helpRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        if (state !== "solving") onRun();
      } else if (event.key === "Escape") {
        if (helpRef.current) helpRef.current.open = false;
        if (state === "solving") onCancel();
      } else if (event.key === "?" && !isEditableTarget(event.target)) {
        event.preventDefault();
        if (helpRef.current) helpRef.current.open = !helpRef.current.open;
      }
    };
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, [onCancel, onRun, state]);
  return (
    <>
    <a className="skip-link" href="#device-workspace">Skip to device workspace</a>
    <ScientificHeader
      aria-label="Semiconductor Devices Lab"
      product="Semiconductor Devices Lab"
      productMark="SD"
      descriptor="Drift–diffusion"
      href={device === "pn" ? "./index.html" : "./bjt.html"}
      contextLabel="Device"
      context={<nav className="device-switcher" aria-label="Device laboratories">
        <a href="./index.html" aria-current={device === "pn" ? "page" : undefined}><span className="device-label-full">PN diode</span><span className="device-label-short">PN</span></a>
        <a href="./bjt.html" aria-current={device === "bjt" ? "page" : undefined}><span className="device-label-full">NPN transistor</span><span className="device-label-short">NPN</span></a>
      </nav>}
      status={{ state: state === "idle" ? "needs-input" : state === "solving" ? "running" : state === "converged" ? "validated" : "failed", label: status }}
      secondaryActions={<>
        <details className="app-help" ref={helpRef}>
          <summary aria-keyshortcuts="?">Help</summary>
          <div className="app-help-panel">
            <strong>Quick workflow</strong>
            <p>Set the device and sweep inputs, calculate, then inspect profiles and numerical diagnostics before exporting.</p>
            <dl><div><dt><kbd>Ctrl/⌘</kbd> + <kbd>Enter</kbd></dt><dd>Calculate</dd></div><div><dt><kbd>Esc</kbd></dt><dd>Cancel calculation</dd></div><div><dt><kbd>?</kbd></dt><dd>Toggle this help</dd></div></dl>
          </div>
        </details>
        <a className="suite-link" href="https://jorpago2.github.io/" aria-label="Online Simulators & Tools">All tools</a>
      </>}
    />
    </>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.matches("input, select, textarea") || target.isContentEditable);
}

export function LabLayout({ controls, children }: { controls: ReactNode; children: ReactNode }) {
  const desktop = useMediaQuery("(min-width: 66rem)");
  const [controlsOpen, setControlsOpen] = useState(desktop);
  useEffect(() => setControlsOpen(desktop), [desktop]);

  const selectWorkspace = (id: string | null) => {
    const showControls = id === "configure";
    setControlsOpen(showControls);
    if (!showControls) {
      requestAnimationFrame(() => document.getElementById("device-workspace")?.focus());
    }
  };

  return (
    <main className="lab-layout" data-panel-open={controlsOpen ? "true" : "false"}>
      <ScientificToolRail
        className="lab-tool-rail"
        label="Laboratory tools"
        activeId={controlsOpen ? "configure" : "results"}
        collapsible={false}
        onChange={selectWorkspace}
        items={[
          {
            id: "configure",
            label: "Configure",
            icon: <SettingsAdjust size={20} />,
            controlsId: "configuration-panel",
          },
          {
            id: "results",
            label: "Results",
            icon: <ChartLine size={20} />,
            controlsId: "device-workspace",
          },
        ]}
      />
      <ScientificTaskPanel
        id="configuration-panel"
        className="control-panel"
        title="Configuration"
        titleId="configuration-panel-title"
        eyebrow="Device inputs"
        bodyClassName="control-panel-content"
        hidden={!controlsOpen}
      >
        {controls}
      </ScientificTaskPanel>
      <section id="device-workspace" className="workspace scientific-stage" tabIndex={-1}>{children}</section>
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

export function Disclosure({ title, summary, children, open = false }: {
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
      <summary><strong>{title}</strong><small>{summary}</small></summary>
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
