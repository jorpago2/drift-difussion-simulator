import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ProgressIndicator, ProgressStep, SkipToContent } from "@carbon/react";
import { ChartLine, SettingsAdjust } from "@carbon/react/icons";
import {
  ScientificAppShell,
  ScientificHeader,
  ScientificRunControl,
  ScientificStatusBar,
  ScientificTaskPanel,
  ScientificToolRail,
  useScientificShortcut,
} from "@jorpago2/scientific-ui";
import type { SolverState } from "../types";

export function AppHeader({ device, state, onRun, onCancel }: { device: "pn" | "bjt"; state: SolverState; onRun: () => void; onCancel: () => void }) {
  const status = state === "idle" ? "Not solved" : state === "solving" ? "Solving…" : state === "converged" ? "Converged" : "Failed";
  const cancelShortcut = useMemo(() => ({
    id: "device:cancel-calculation",
    shortcut: "Escape",
    displayKeys: ["Esc"],
    description: "Cancel calculation",
    enabled: state === "solving",
    priority: 20,
    handler: onCancel,
  }), [onCancel, state]);
  useScientificShortcut(cancelShortcut);
  return (
    <ScientificHeader
      skipLink={<SkipToContent href="#device-workspace">Skip to device workspace</SkipToContent>}
      aria-label="Semiconductor Devices Lab"
      product="Device Lab"
      compactProduct="Device Lab"
      productIcon="semiconductor-device"
      descriptor="Drift–diffusion"
      href={device === "pn" ? "./index.html" : "./bjt.html"}
      contextLabel="Device"
      context={<nav className="device-switcher" aria-label="Device laboratories">
        <a href="./index.html" aria-current={device === "pn" ? "page" : undefined}><span className="device-label-full">PN diode</span><span className="device-label-short">PN</span></a>
        <a href="./bjt.html" aria-current={device === "bjt" ? "page" : undefined}><span className="device-label-full">NPN transistor</span><span className="device-label-short">NPN</span></a>
      </nav>}
      status={{ state: state === "idle" ? "needs-input" : state === "solving" ? "running" : state === "converged" ? "up-to-date" : "failed", label: state === "converged" ? "Solved · review numerical checks" : status }}
      help={{
        id: "device-help",
        summary: "Set the device and sweep inputs, calculate, then inspect profiles and numerical diagnostics before exporting.",
      }}
      primaryAction={<ScientificRunControl
        size="lg"
        execution={{
          state: state === "idle" ? "ready" : state === "solving" ? "running" : state === "converged" ? "up-to-date" : "failed",
          label: status,
          onRun,
          onStop: onCancel,
          runLabel: device === "pn" ? "Calculate I–V sweep" : "Calculate characteristic grid",
          stopLabel: "Cancel",
        }}
      />}
    />
  );
}

export function LabLayout({ header, controls, children, state, statusMessage, recovery, autosaveStatus }: {
  header: ReactNode;
  controls: ReactNode;
  children: ReactNode;
  state: SolverState;
  statusMessage: string;
  recovery?: ReactNode;
  autosaveStatus?: ReactNode;
}) {
  const desktop = useMediaQuery("(min-width: 66rem)");
  const [controlsOpen, setControlsOpen] = useState(desktop);
  const configureTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => setControlsOpen(desktop), [desktop]);

  const closeControls = useCallback(() => {
    setControlsOpen(false);
    window.requestAnimationFrame(() => configureTriggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!controlsOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") return;
      event.preventDefault();
      closeControls();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [closeControls, controlsOpen]);

  const selectWorkspace = (id: string | null) => {
    const showControls = id === "configure";
    setControlsOpen(showControls);
    if (!showControls) {
      requestAnimationFrame(() => document.getElementById("device-workspace")?.focus());
    }
  };

  return (
    <ScientificAppShell
      className="device-lab-shell"
      header={header}
      recovery={recovery}
      panelOpen={controlsOpen}
      navigation={<ScientificToolRail
        className="lab-tool-rail"
        label="Laboratory tools"
        activeId={controlsOpen ? "configure" : "results"}
        collapsible={false}
        registerItemRef={(id, node) => { if (id === "configure") configureTriggerRef.current = node; }}
        onChange={selectWorkspace}
        items={[
          {
            id: "configure",
            label: "Model",
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
      />}
      panel={<ScientificTaskPanel
        id="configuration-panel"
        className="control-panel"
        title="Device inputs"
        titleId="configuration-panel-title"
        eyebrow="Configuration"
        onClose={closeControls}
        closeLabel="Close"
        bodyClassName="control-panel-content"
        hidden={!controlsOpen}
      >
        {controls}
      </ScientificTaskPanel>}
      statusBar={<ScientificStatusBar
        aria-label="Calculation status"
        status={{
          state: state === "idle" ? "needs-input" : state === "solving" ? "running" : state === "converged" ? "up-to-date" : "failed",
          label: state === "converged" ? `${statusMessage} · review numerical checks` : statusMessage,
        }}
        metadata={autosaveStatus}
      />}
    >
      <section id="device-workspace" className="workspace scientific-stage" tabIndex={-1}>
        <div className="workflow-progress" aria-label="Simulation workflow">
          <ProgressIndicator currentIndex={state === "idle" ? 0 : state === "solving" || state === "failed" ? 1 : 3} spaceEqually>
            <ProgressStep label="Configure" description="Set model and bias" />
            <ProgressStep label="Execute" description="Solve the device" invalid={state === "failed"} />
            <ProgressStep label="Results" description="Inspect curves and fields" />
            <ProgressStep label="Validate" description="Review numerical confidence" />
          </ProgressIndicator>
        </div>
        {children}
      </section>
    </ScientificAppShell>
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
