import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_PN_CONFIG,
  serializePnProfileCsv,
  serializePnSweepCsv,
  validatePnConfig,
} from "../ddm-core.js";
import { LineChart, type ChartSeries, type LineChartHandle } from "../components/LineChart";
import { AppHeader, Disclosure, Field, LabLayout, Message, MetricGrid } from "../components/ui";
import { downloadText } from "../lib/download";
import { fixed, nearestIndex, percent, scientific } from "../lib/format";
import type { PnConfig, PnDerived, PnResult, PnSweep, SolverState, Validation } from "../types";

interface Inputs extends PnConfig {
  minimumV: number;
  maximumV: number;
  pointCount: number;
}

const initialInputs: Inputs = {
  ...(DEFAULT_PN_CONFIG as PnConfig),
  biasV: 0,
  minimumV: -1,
  maximumV: 0.65,
  pointCount: 67,
};
const diodeCutaway = new URL("../../assets/device-cutaways/diode-axial-cutaway-realistic.png", import.meta.url).href;

export function PnLab() {
  const [inputs, setInputs] = useState(initialInputs);
  const [solverState, setSolverState] = useState<SolverState>("idle");
  const [message, setMessage] = useState("Ready to calculate the complete I–V characteristic.");
  const [sweep, setSweep] = useState<PnSweep | null>(null);
  const [result, setResult] = useState<PnResult | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [quantity, setQuantity] = useState<"current" | "density">("current");
  const [scale, setScale] = useState<"linear" | "log">("linear");
  const [showReference, setShowReference] = useState(true);
  const [axis, setAxis] = useState({ xMin: "", xMax: "", yMin: "", yMax: "" });
  const [workerGeneration, setWorkerGeneration] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const selectedIndexRef = useRef(-1);
  const chartRef = useRef<LineChartHandle>(null);

  const config = useMemo<PnConfig>(() => ({
    ...inputs,
    biasV: 0,
  }), [inputs]);
  const validation = useMemo(() => validatePnConfig(config) as Validation<PnConfig, PnDerived>, [config]);
  const sweepErrors = useMemo(() => validateSweep(inputs), [inputs]);
  const errors = [...validation.errors, ...sweepErrors];

  useEffect(() => {
    const worker = new Worker(new URL("../workers/pn.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = ({ data }) => {
      if (data.action === "failed") {
        setSolverState("failed");
        setMessage(data.message);
        setSweep(null);
        setResult(null);
      }
      if (data.action === "swept") {
        const nextSweep = data.result as PnSweep;
        if (!nextSweep.converged) {
          setSolverState("failed");
          setMessage("The sweep contains an unconverged point; no result is presented as valid.");
          return;
        }
        const index = nearestIndex(nextSweep.points, 0, (point) => point.voltageV);
        selectedIndexRef.current = index;
        setSweep(nextSweep);
        setSelectedIndex(index);
        setSolverState("converged");
        setMessage(`${nextSweep.points.length}-point sweep converged in ${fixed(nextSweep.elapsedMs, 0)} ms.`);
        worker.postMessage({ action: "select", index });
      }
      if (data.action === "selected" && data.index === selectedIndexRef.current) setResult(data.result as PnResult);
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [workerGeneration]);

  function update<K extends keyof Inputs>(key: K, value: Inputs[K]) {
    if (solverState === "solving") return;
    setInputs((current) => ({ ...current, [key]: value }));
    setSweep(null);
    setResult(null);
    setSelectedIndex(-1);
    selectedIndexRef.current = -1;
    setSolverState("idle");
    setMessage("Configuration changed. Calculate a new I–V sweep.");
    chartRef.current?.reset();
  }

  function solve() {
    if (errors.length || solverState === "solving") return;
    setSolverState("solving");
    setMessage(`Solving ${inputs.pointCount} bias points by continuation from equilibrium…`);
    setSweep(null);
    setResult(null);
    workerRef.current?.postMessage({
      action: "sweep",
      config: validation.config,
      minimumV: inputs.minimumV,
      maximumV: inputs.maximumV,
      pointCount: inputs.pointCount,
    });
  }

  function cancel() {
    if (solverState !== "solving") return;
    workerRef.current?.terminate();
    workerRef.current = null;
    setWorkerGeneration((current) => current + 1);
    setSolverState("idle");
    setMessage("Calculation cancelled. No partial sweep was kept.");
  }

  function selectPoint(index: number) {
    if (!sweep?.points[index]?.converged) return;
    selectedIndexRef.current = index;
    setSelectedIndex(index);
    setResult(null);
    workerRef.current?.postMessage({ action: "select", index });
  }

  function resetChartView() {
    setAxis({ xMin: "", xMax: "", yMin: "", yMax: "" });
    chartRef.current?.reset();
  }

  const selectedPoint = sweep?.points[selectedIndex] ?? null;
  const areaM2 = sweep?.config.deviceAreaUm2 ? sweep.config.deviceAreaUm2 * 1e-12 : config.deviceAreaUm2 * 1e-12;
  const chartScale = quantity === "density" ? 1e-4 : areaM2 * 1e3;
  const voltage = useMemo(() => Float64Array.from(sweep?.points ?? [], (point) => point.voltageV), [sweep]);
  const numerical = useMemo(() => Float64Array.from(sweep?.points ?? [], (point) => {
    const value = point.currentDensityAm2 * chartScale;
    return scale === "log" ? Math.abs(value) : value;
  }), [chartScale, scale, sweep]);
  const reference = useMemo(() => Float64Array.from(sweep?.points ?? [], (point) => {
    const value = point.shockleyCurrentDensityAm2 == null ? NaN : point.shockleyCurrentDensityAm2 * chartScale;
    return scale === "log" ? Math.abs(value) : value;
  }), [chartScale, scale, sweep]);
  const series = useMemo<ChartSeries[]>(() => {
    const values: ChartSeries[] = [{ label: "DD + SRH", values: numerical, color: "#087e8b", lineWidth: 2.8 }];
    if (showReference) values.push({ label: "Finite-base analytical", values: reference, color: "#c57a00", dash: [7, 4], lineWidth: 2 });
    return values;
  }, [numerical, reference, showReference]);

  const currentA = result ? result.diagnostics.meanCurrentDensityAm2 * result.derived.deviceAreaM2 : NaN;
  const dynamicResistance = result && sweep ? smallSignalResistance(sweep, selectedIndex, result.derived.deviceAreaM2) : NaN;
  const xUm = useMemo(() => Float64Array.from(result?.xM ?? [], (value) => value * 1e6), [result]);
  const plotState = solverState === "failed" ? "error" : solverState === "solving" ? "loading" : sweep ? "ready" : "empty";
  const depletionPercent = Math.min(62, Math.max(5, 100 * (result?.derived.depletionWidthM ?? validation.derived?.depletionWidthM ?? 0) / config.lengthUm / 1e-6));

  return (
    <>
      <AppHeader device="pn" state={solverState} />
      <LabLayout controls={
        <>
          <div className="panel-heading"><span className="eyebrow">Terminal sweep</span><h2>PN diode</h2><p>Sweep the terminal characteristic and inspect the device at any solved bias.</p></div>
          <fieldset className="configuration-fields" disabled={solverState === "solving"}>
          <div className="field-grid two">
            <Field label={<>N<sub>A</sub> (cm⁻³)</>}><input type="number" value={inputs.acceptorCm3} min="1e14" max="1e18" step="1e15" onChange={(event) => update("acceptorCm3", Number(event.target.value))} /></Field>
            <Field label={<>N<sub>D</sub> (cm⁻³)</>}><input type="number" value={inputs.donorCm3} min="1e14" max="1e18" step="1e15" onChange={(event) => update("donorCm3", Number(event.target.value))} /></Field>
          </div>
          <div className="field-grid three">
            <Field label={<>V<sub>D,min</sub> (V)</>}><input type="number" value={inputs.minimumV} min="-1" max="0.8" step="0.025" onChange={(event) => update("minimumV", Number(event.target.value))} /></Field>
            <Field label={<>V<sub>D,max</sub> (V)</>}><input type="number" value={inputs.maximumV} min="-1" max="0.8" step="0.025" onChange={(event) => update("maximumV", Number(event.target.value))} /></Field>
            <Field label="Points"><input type="number" value={inputs.pointCount} min="17" max="201" step="1" onChange={(event) => update("pointCount", Number(event.target.value))} /></Field>
          </div>
          <p className="field-note">V<sub>D</sub> = V<sub>A</sub> − V<sub>C</sub>. Internal continuation steps remain ≤25 mV.</p>
          <details className="advanced-panel">
            <summary>Area, mesh, and lifetimes</summary>
            <div className="field-grid two">
              <Field label="Area (µm²)"><input type="number" value={inputs.deviceAreaUm2} min="1" max="1e8" step="any" onChange={(event) => update("deviceAreaUm2", Number(event.target.value))} /></Field>
              <Field label="Length (µm)"><input type="number" value={inputs.lengthUm} min="1" max="20" step="0.1" onChange={(event) => update("lengthUm", Number(event.target.value))} /></Field>
              <Field label="Mesh nodes"><input type="number" value={inputs.cells} min="101" max="2001" step="2" onChange={(event) => update("cells", Number(event.target.value))} /></Field>
              <Field label={<>τ<sub>n</sub> (s)</>}><input type="number" value={inputs.electronLifetimeS} min="1e-12" max="1e-3" step="any" onChange={(event) => update("electronLifetimeS", Number(event.target.value))} /></Field>
              <Field label={<>τ<sub>p</sub> (s)</>}><input type="number" value={inputs.holeLifetimeS} min="1e-12" max="1e-3" step="any" onChange={(event) => update("holeLifetimeS", Number(event.target.value))} /></Field>
            </div>
            {validation.derived && <MetricGrid compact entries={[
              ["Built-in potential", `${fixed(validation.derived.builtInPotentialV)} V`],
              ["Depletion estimate", `${scientific(validation.derived.depletionWidthM * 1e6)} µm`],
              ["Spatial step", `${scientific(validation.derived.dxM * 1e9)} nm`],
            ]} />}
          </details>
          </fieldset>
          <Message state={errors.length ? "error" : validation.warnings.length ? "warning" : "ready"}>{errors[0] ?? validation.warnings[0] ?? "Configuration and mesh checks passed."}</Message>
          <button className="primary-action" data-action={solverState === "solving" ? "cancel" : undefined} type="button" disabled={solverState !== "solving" && Boolean(errors.length)} onClick={solverState === "solving" ? cancel : solve}>{solverState === "solving" ? "Cancel calculation" : "Calculate I–V sweep"}</button>
          <output className="solver-line" aria-live="polite">{message}</output>
        </>
      }>
        <header className="workspace-heading">
          <div><span className="eyebrow">1D drift–diffusion</span><h1>PN diode I–V characteristic</h1></div>
          <span className="bias-badge">{fixed(inputs.minimumV, 2)} ≤ V<sub>D</sub> ≤ {fixed(inputs.maximumV, 2)} V</span>
        </header>

        <div className="device-strip pn-strip" aria-label="PN junction charge distribution">
          <span className="contact">Anode</span>
          <div className="region region-p"><strong>P</strong><small>N<sub>A</sub> = {scientific(inputs.acceptorCm3)} cm⁻³</small><span className="mobile-charge">h⁺ &nbsp; A⁻ &nbsp; h⁺</span></div>
          <div className="depletion" style={{ width: `${depletionPercent}%` }}><span className="ions ions-p">A⁻ A⁻</span><span className="field-arrow">← E</span><span className="ions ions-n">D⁺ D⁺</span></div>
          <div className="region region-n"><strong>N</strong><small>N<sub>D</sub> = {scientific(inputs.donorCm3)} cm⁻³</small><span className="mobile-charge">e⁻ &nbsp; D⁺ &nbsp; e⁻</span></div>
          <span className="contact">Cathode</span>
        </div>
        <details className="device-context">
          <summary>Real-device context</summary>
          <div><img src={diodeCutaway} alt="Cutaway of an axial silicon diode showing the semiconductor die, contacts, bond connection, and encapsulation" /><p>The simulated 1D junction represents the active silicon die. Package leads, metallization, contact resistance, edge fields, and thermal effects are outside this model.</p></div>
        </details>

        <section className="primary-dashboard" aria-labelledby="pn-result-title">
          <div className="main-chart">
            <LineChart
              ref={chartRef}
              x={voltage}
              series={series}
              xLabel="V<sub>D</sub> (V)"
              yLabel={quantity === "density" ? (scale === "log" ? "|J<sub>D</sub>| (A/cm²)" : "J<sub>D</sub> (A/cm²)") : (scale === "log" ? "|I<sub>D</sub>| (mA)" : "I<sub>D</sub> (mA)")}
              markerX={selectedPoint?.voltageV}
              includeZero={scale === "linear"}
              scale={scale}
              height={430}
              state={plotState}
              message={solverState === "solving" ? `Calculating ${inputs.pointCount} bias points` : "Awaiting an I–V sweep"}
              interactive
              onSelectX={(value) => sweep && selectPoint(nearestIndex(sweep.points, value, (point) => point.voltageV))}
            />
          </div>
          <aside className="result-inspector">
            <div><span className="eyebrow">Terminal characteristic</span><h2 id="pn-result-title">Diode I–V curve</h2></div>
            <MetricGrid compact entries={[
              [<>V<sub>D</sub></>, result ? `${fixed(result.config.biasV)} V` : "—"],
              [<>I<sub>D</sub></>, result ? `${scientific(currentA * 1e3)} mA` : "—"],
              [<>J<sub>D</sub></>, result ? `${scientific(result.diagnostics.meanCurrentDensityAm2 / 1e4)} A/cm²` : "—"],
              [<>r<sub>d</sub></>, Number.isFinite(dynamicResistance) ? `${scientific(dynamicResistance)} Ω` : "—"],
            ]} />
            <div className="control-row">
              <Field label="Quantity"><select value={quantity} onChange={(event) => { setQuantity(event.target.value as typeof quantity); resetChartView(); }}><option value="current">Terminal current</option><option value="density">Current density</option></select></Field>
              <Field label="Y scale"><select value={scale} onChange={(event) => { setScale(event.target.value as typeof scale); resetChartView(); }}><option value="linear">Linear</option><option value="log">Log magnitude</option></select></Field>
            </div>
            <label className="check"><input type="checkbox" checked={showReference} onChange={(event) => setShowReference(event.target.checked)} /> Analytical reference</label>
            <details className="axis-controls">
              <summary>Axis limits</summary>
              <div className="field-grid two">
                {(["xMin", "xMax", "yMin", "yMax"] as const).map((key) => <Field key={key} label={key.replace("Min", " min").replace("Max", " max").toUpperCase()}><input type="number" step="any" placeholder="Auto" value={axis[key]} onChange={(event) => setAxis((current) => ({ ...current, [key]: event.target.value }))} /></Field>)}
              </div>
              <div className="button-row"><button type="button" disabled={Object.values(axis).some((value) => value.trim() === "")} onClick={() => chartRef.current?.setDomain({ xMin: Number(axis.xMin), xMax: Number(axis.xMax), yMin: Number(axis.yMin), yMax: Number(axis.yMax) })}>Apply</button><button type="button" onClick={resetChartView}>Auto</button></div>
            </details>
            <Field label={<>Inspect profiles at V<sub>D</sub> = {selectedPoint ? fixed(selectedPoint.voltageV) : "—"} V</>}><input type="range" min="0" max={Math.max(0, (sweep?.points.length ?? 1) - 1)} step="1" value={Math.max(0, selectedIndex)} disabled={!sweep} onChange={(event) => selectPoint(Number(event.target.value))} /></Field>
            <p className="interaction-note">Wheel to zoom · drag to pan · double-click or Home to reset.</p>
          </aside>
        </section>

        <Disclosure eyebrow="Optional analysis" title="Internal device profiles" summary="Potential, field, charge, carriers, and energy bands">
          <div className="profile-grid">
            <Profile title="Electrostatic potential ψ(x)"><LineChart x={xUm} series={[{ label: "ψ", values: result?.potentialV ?? [], color: "#087e8b" }]} xLabel="x (µm)" yLabel="ψ (V)" height={260} state={result ? "ready" : "empty"} /></Profile>
            <Profile title="Electric field E(x)"><LineChart x={xUm} series={[{ label: "E", values: Float64Array.from(result?.fieldVm ?? [], (value) => value / 1e6), color: "#704aa1" }]} xLabel="x (µm)" yLabel="E (MV/m)" height={260} state={result ? "ready" : "empty"} /></Profile>
            <Profile title="Space charge ρ(x)"><LineChart x={xUm} series={[{ label: "ρ", values: result?.chargeCm3 ?? [], color: "#b63b52" }]} xLabel="x (µm)" yLabel="ρ (C/m³)" scale="symlog" height={260} state={result ? "ready" : "empty"} /></Profile>
            <Profile title="Carrier concentrations"><LineChart x={xUm} series={carrierSeries(result)} xLabel="x (µm)" yLabel="Concentration (cm⁻³)" scale="log" height={260} state={result ? "ready" : "empty"} /></Profile>
            <Profile title="Bands and quasi-Fermi levels" wide><LineChart x={xUm} series={bandSeries(result)} xLabel="x (µm)" yLabel="Relative energy (eV)" height={280} state={result ? "ready" : "empty"} /></Profile>
          </div>
        </Disclosure>

        <Disclosure eyebrow="Optional diagnostics" title="Numerical confidence" summary="Residuals, conservation, mesh, and model limits">
          {result ? <>
            <Message state="pass">PASS — all coupled residual and conservation thresholds are satisfied.</Message>
            <MetricGrid entries={[
              ["Scaled residuals (ψ / n / p)", `${scientific(result.diagnostics.poissonResidual)} / ${scientific(result.diagnostics.electronResidual)} / ${scientific(result.diagnostics.holeResidual)}`],
              ["Current uniformity", percent(result.diagnostics.currentContinuityError)],
              ["Carrier balance (n / p)", `${percent(result.diagnostics.electronBalanceError)} / ${percent(result.diagnostics.holeBalanceError)}`],
              ["Mesh", `${result.config.cells} nodes · Δx ${scientific(result.derived.dxM * 1e9)} nm`],
            ]} />
            <WarningList warnings={result.warnings} />
          </> : <Message state="idle">Calculate the sweep before interpreting numerical confidence.</Message>}
        </Disclosure>

        <details className="export-panel"><summary>Export converged results</summary><div className="button-row"><button disabled={!result} onClick={() => { if (!result) return; downloadText(serializePnProfileCsv(result), "pn-profile.csv"); setMessage("Profile exported as pn-profile.csv."); }}>Profile CSV</button><button disabled={!sweep} onClick={() => { if (!sweep) return; downloadText(serializePnSweepCsv(sweep), "pn-iv.csv"); setMessage("Sweep exported as pn-iv.csv."); }}>Sweep CSV</button><button disabled={!sweep} onClick={() => { chartRef.current?.downloadPng("pn-iv.png"); setMessage("Plot exported as pn-iv.png."); }}>Plot PNG</button></div></details>
        <p className="model-boundary"><strong>Model boundary:</strong> homogeneous silicon, Boltzmann statistics, constant mobility, ohmic contacts, and midgap SRH. Breakdown, tunneling, degeneracy, self-heating, and high-field mobility are excluded.</p>
      </LabLayout>
    </>
  );
}

function validateSweep(input: Inputs): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(input.minimumV) || input.minimumV < -1 || input.minimumV > 0.8) errors.push("Minimum diode voltage must be between −1 and 0.8 V.");
  if (!Number.isFinite(input.maximumV) || input.maximumV < -1 || input.maximumV > 0.8) errors.push("Maximum diode voltage must be between −1 and 0.8 V.");
  if (input.minimumV >= input.maximumV) errors.push("Minimum diode voltage must be smaller than maximum diode voltage.");
  if (!Number.isInteger(input.pointCount) || input.pointCount < 17 || input.pointCount > 201) errors.push("Sweep points must be an integer between 17 and 201.");
  return errors;
}

function smallSignalResistance(sweep: PnSweep, index: number, areaM2: number): number {
  if (index < 0) return NaN;
  const left = sweep.points[Math.max(0, index - 1)]!;
  const right = sweep.points[Math.min(sweep.points.length - 1, index + 1)]!;
  const currentChange = (right.currentDensityAm2 - left.currentDensityAm2) * areaM2;
  return currentChange === 0 ? NaN : (right.voltageV - left.voltageV) / currentChange;
}

function carrierSeries(result: PnResult | null): ChartSeries[] {
  if (!result) return [];
  return [
    { label: "n", values: Float64Array.from(result.electronM3, (value) => value / 1e6), color: "#2162a7" },
    { label: "p", values: Float64Array.from(result.holeM3, (value) => value / 1e6), color: "#b6314b" },
    { label: "|doping|", values: Float64Array.from(result.dopingM3, (value) => Math.abs(value) / 1e6), color: "#6a787e", dash: [6, 4] },
  ];
}

function bandSeries(result: PnResult | null): ChartSeries[] {
  if (!result) return [];
  return [
    { label: "E<sub>c</sub>", values: result.conductionBandEv, color: "#2162a7" },
    { label: "E<sub>i</sub>", values: result.intrinsicBandEv, color: "#6a787e", dash: [5, 4] },
    { label: "E<sub>v</sub>", values: result.valenceBandEv, color: "#b6314b" },
    { label: "F<sub>n</sub>", values: result.electronQuasiFermiEv, color: "#0a8876", dash: [8, 3] },
    { label: "F<sub>p</sub>", values: result.holeQuasiFermiEv, color: "#c57a00", dash: [8, 3] },
  ];
}

function Profile({ title, children, wide = false }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return <figure className={`profile-card${wide ? " profile-wide" : ""}`}><figcaption>{title}</figcaption>{children}</figure>;
}

function WarningList({ warnings }: { warnings: string[] }) {
  return warnings.length ? <ul className="warning-list">{[...new Set(warnings)].map((warning) => <li key={warning}>{warning}</li>)}</ul> : null;
}
