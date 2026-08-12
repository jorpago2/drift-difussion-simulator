import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@carbon/react";
import {
  DEFAULT_NPN_CONFIG,
  idealNpnTransportCurrentA,
  serializeNpnProfileCsv,
  serializeNpnSweepCsv,
  validateNpnConfig,
} from "../bjt-core.js";
import { Heatmap } from "../components/Heatmap";
import { LineChart, type ChartSeries, type LineChartHandle } from "../components/LineChart";
import { AppHeader, Disclosure, Field, LabLayout, Message, MetricGrid } from "../components/ui";
import { ScientificModelScope, ScientificNumberField, ScientificValidationSummary } from "@jorpago2/scientific-ui";
import { downloadText } from "../lib/download";
import { fixed, linearGrid, nearestIndex, percent, scientific } from "../lib/format";
import { cssToken } from "../lib/theme";
import type { NpnConfig, NpnDerived, NpnFamily, NpnResult, SolverState, Validation } from "../types";

interface Inputs extends NpnConfig {
  minimumVbeV: number;
  maximumVbeV: number;
  basePointCount: number;
  maximumVceV: number;
  collectorPointCount: number;
}

const initialInputs: Inputs = {
  ...(DEFAULT_NPN_CONFIG as NpnConfig),
  minimumVbeV: 0.49,
  maximumVbeV: 0.55,
  basePointCount: 5,
  maximumVceV: 0.8,
  collectorPointCount: 7,
};
const bjtCutaway = new URL("../../assets/device-cutaways/bjt-to92-cutaway-realistic.png", import.meta.url).href;

const analyticalCurrent = idealNpnTransportCurrentA as unknown as (
  config: NpnConfig,
  baseEmitterVoltageV: number,
  collectorEmitterVoltageV: number,
) => number;

export function BjtLab() {
  const [inputs, setInputs] = useState(initialInputs);
  const [solverState, setSolverState] = useState<SolverState>("idle");
  const [message, setMessage] = useState("Ready to calculate the base–emitter × collector–emitter voltage grid.");
  const [family, setFamily] = useState<NpnFamily | null>(null);
  const [result, setResult] = useState<NpnResult | null>(null);
  const [curveIndex, setCurveIndex] = useState(-1);
  const [pointIndex, setPointIndex] = useState(-1);
  const [showReference, setShowReference] = useState(true);
  const [progress, setProgress] = useState({ completed: 0, total: initialInputs.basePointCount * initialInputs.collectorPointCount });
  const [cancelPending, setCancelPending] = useState(false);
  const curveColors = useMemo(() => [
    cssToken("--color-plot-violet"),
    cssToken("--color-plot-blue"),
    cssToken("--color-plot-teal"),
    cssToken("--color-plot-green"),
    cssToken("--color-plot-gold"),
    cssToken("--color-plot-red"),
    cssToken("--color-plot-magenta"),
    cssToken("--color-plot-slate"),
    cssToken("--color-plot-ochre"),
  ], []);
  const workerRef = useRef<Worker | null>(null);
  const selectionRef = useRef({ curve: -1, point: -1 });
  const outputChartRef = useRef<LineChartHandle>(null);

  const config = useMemo<NpnConfig>(() => ({
    ...inputs,
    baseEmitterVoltageV: inputs.maximumVbeV,
    collectorEmitterVoltageV: inputs.maximumVceV,
  }), [inputs]);
  const validation = useMemo(() => validateNpnConfig(config) as Validation<NpnConfig, NpnDerived>, [config]);
  const sweepErrors = useMemo(() => validateSweep(inputs), [inputs]);
  const errors = [...validation.errors, ...sweepErrors];

  useEffect(() => {
    const worker = new Worker(new URL("../workers/bjt.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = ({ data }) => {
      if (data.action === "failed") {
        setSolverState("failed");
        setCancelPending(false);
        setMessage(data.message);
        setFamily(null);
        setResult(null);
      }
      if (data.action === "progress") {
        setProgress({ completed: data.completed, total: data.total });
        const bias = Number.isFinite(data.baseEmitterVoltageV) && Number.isFinite(data.collectorEmitterVoltageV)
          ? ` at base–emitter bias ${fixed(data.baseEmitterVoltageV)} V and collector–emitter bias ${fixed(data.collectorEmitterVoltageV)} V`
          : "";
        setMessage(`${data.completed} of ${data.total} bias points converged${bias}.`);
      }
      if (data.action === "cancelled") {
        setSolverState("idle");
        setCancelPending(false);
        setProgress({ completed: data.completed, total: data.total });
        setMessage(`Calculation cancelled after ${data.completed} of ${data.total} bias points. Partial data were not presented as a valid family.`);
      }
      if (data.action === "swept") {
        const nextFamily = data.result as NpnFamily;
        setCancelPending(false);
        if (!nextFamily.converged) {
          setSolverState("failed");
          setMessage("The characteristic grid contains an unconverged point.");
          return;
        }
        const nextCurve = nextFamily.curves.length - 1;
        const nextPoint = (nextFamily.curves[0]?.points.length ?? 1) - 1;
        setFamily(nextFamily);
        setCurveIndex(nextCurve);
        setPointIndex(nextPoint);
        setSolverState("converged");
        const pointCount = nextFamily.curves.length * (nextFamily.curves[0]?.points.length ?? 0);
        setProgress({ completed: pointCount, total: pointCount });
        setMessage(data.cached
          ? `${pointCount} bias points restored from the in-memory cache.`
          : `${pointCount} bias points converged with ${nextFamily.backend} (${fixed(nextFamily.elapsedMs, 0)} ms kernel time).`);
        requestPoint(nextCurve, nextPoint, worker);
      }
      if (data.action === "selected" && data.curveIndex === selectionRef.current.curve && data.pointIndex === selectionRef.current.point) {
        setResult(data.result as NpnResult);
      }
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  function update<K extends keyof Inputs>(key: K, value: Inputs[K]) {
    if (solverState === "solving") return;
    const nextInputs = { ...inputs, [key]: value };
    setInputs(nextInputs);
    setFamily(null);
    setResult(null);
    setCurveIndex(-1);
    setPointIndex(-1);
    selectionRef.current = { curve: -1, point: -1 };
    setSolverState("idle");
    setProgress({ completed: 0, total: nextInputs.basePointCount * nextInputs.collectorPointCount });
    setMessage("Configuration changed. Calculate a new characteristic grid.");
  }

  function solve() {
    if (errors.length || solverState === "solving") return;
    setSolverState("solving");
    setCancelPending(false);
    setProgress({ completed: 0, total: inputs.basePointCount * inputs.collectorPointCount });
    setMessage(`Solving ${inputs.basePointCount} × ${inputs.collectorPointCount} coupled bias points…`);
    setFamily(null);
    setResult(null);
    workerRef.current?.postMessage({
      action: "sweep",
      config: validation.config,
      baseVoltages: linearGrid(inputs.minimumVbeV, inputs.maximumVbeV, inputs.basePointCount),
      collectorVoltages: linearGrid(0, inputs.maximumVceV, inputs.collectorPointCount),
    });
  }

  function cancel() {
    if (solverState !== "solving" || cancelPending) return;
    setCancelPending(true);
    setMessage("Cancellation requested. The current nonlinear bias point will finish before the sweep stops.");
    workerRef.current?.postMessage({ action: "cancel" });
  }

  function requestPoint(nextCurve: number, nextPoint: number, worker = workerRef.current) {
    const point = family?.curves[nextCurve]?.points[nextPoint];
    if (family && !point?.converged) return;
    selectionRef.current = { curve: nextCurve, point: nextPoint };
    setCurveIndex(nextCurve);
    setPointIndex(nextPoint);
    setResult(null);
    worker?.postMessage({ action: "select", curveIndex: nextCurve, pointIndex: nextPoint });
  }

  const selectedCurve = family?.curves[curveIndex] ?? null;
  const selectedPoint = selectedCurve?.points[pointIndex] ?? null;
  const outputX = useMemo(() => Float64Array.from(family?.curves[0]?.points ?? [], (point) => point.collectorEmitterVoltageV), [family]);
  const outputSeries = useMemo<ChartSeries[]>(() => {
    if (!family) return [];
    return family.curves.flatMap((curve, index) => {
      const color = curveColors[index % curveColors.length]!;
      const numerical: ChartSeries = {
        label: `V<sub>BE</sub> = ${fixed(curve.baseEmitterVoltageV)} V`,
        values: Float64Array.from(curve.points, (point) => point.collectorCurrentA * 1e3),
        color,
        lineWidth: index === curveIndex ? 3.2 : 2,
      };
      if (!showReference) return [numerical];
      return [numerical, {
        label: `1D, V<sub>BE</sub> = ${fixed(curve.baseEmitterVoltageV)} V`,
        values: Float64Array.from(curve.points, (point) => analyticalCurrent(family.config, curve.baseEmitterVoltageV, point.collectorEmitterVoltageV) * 1e3),
        color,
        dash: [7, 4],
        lineWidth: 1.5,
        showInLegend: false,
      }];
    });
  }, [curveColors, curveIndex, family, showReference]);
  const transferX = useMemo(() => Float64Array.from(family?.curves ?? [], (curve) => curve.baseEmitterVoltageV), [family]);
  const transferSeries = useMemo<ChartSeries[]>(() => {
    if (!family || pointIndex < 0) return [];
    const selectedVce = family.curves[0]?.points[pointIndex]?.collectorEmitterVoltageV ?? 0;
    const values: ChartSeries[] = [{
      label: "2D DD",
      values: Float64Array.from(family.curves, (curve) => curve.points[pointIndex]!.collectorCurrentA * 1e3),
      color: cssToken("--color-plot-teal"),
      lineWidth: 2.6,
    }];
    if (showReference) values.push({
      label: "Ideal 1D",
      values: Float64Array.from(family.curves, (curve) => analyticalCurrent(family.config, curve.baseEmitterVoltageV, selectedVce) * 1e3),
      color: cssToken("--color-plot-gold"),
      dash: [6, 4],
      lineWidth: 1.7,
    });
    return values;
  }, [family, pointIndex, showReference]);

  const plotState = solverState === "failed" ? "error" : solverState === "solving" ? "loading" : family ? "ready" : "empty";
  const collector = result?.terminalCurrents.collector.currentIntoDeviceA ?? NaN;
  const base = result?.terminalCurrents.base.currentIntoDeviceA ?? NaN;
  const emitter = result?.terminalCurrents.emitter.currentIntoDeviceA ?? NaN;
  const beta = base > 0 ? collector / base : NaN;
  return (
      <LabLayout
        header={<AppHeader device="bjt" state={solverState} onRun={solve} onCancel={cancel} />}
        state={solverState}
        statusMessage={message}
        controls={
        <>
          <div className="panel-heading"><h2>Lateral NPN</h2><p>Sweep output and transfer characteristics on one reusable bias grid.</p></div>
          <fieldset className="configuration-fields" disabled={solverState === "solving"}>
          <div className="field-grid two">
            <Field label={<>V<sub>BE,min</sub> (V)</>}><input type="number" value={inputs.minimumVbeV} min="-0.2" max="0.75" step="0.01" onChange={(event) => update("minimumVbeV", Number(event.target.value))} /></Field>
            <Field label={<>V<sub>BE,max</sub> (V)</>}><input type="number" value={inputs.maximumVbeV} min="-0.2" max="0.75" step="0.01" onChange={(event) => update("maximumVbeV", Number(event.target.value))} /></Field>
          </div>
          <div className="field-grid three">
            <Field label={<>V<sub>BE</sub> curves</>}><input type="number" value={inputs.basePointCount} min="3" max="9" step="1" onChange={(event) => update("basePointCount", Number(event.target.value))} /></Field>
            <Field label={<>V<sub>CE,max</sub> (V)</>}><input type="number" value={inputs.maximumVceV} min="0.1" max="5" step="0.05" onChange={(event) => update("maximumVceV", Number(event.target.value))} /></Field>
            <Field label={<>V<sub>CE</sub> points</>}><input type="number" value={inputs.collectorPointCount} min="5" max="21" step="1" onChange={(event) => update("collectorPointCount", Number(event.target.value))} /></Field>
          </div>
          <p className="field-note">Each curve holds V<sub>BE</sub> constant. This is not a constant-I<sub>B</sub> family.</p>
          <details className="advanced-panel">
            <summary>Doping, geometry, and numerics</summary>
            <div className="field-grid two">
              <ScientificNumberField id="emitter-doping" labelText={<>Emitter N<sub>D</sub></>} unit="cm⁻³" value={inputs.emitterDopingCm3} min={1e14} max={5e17} onValueChange={(value) => { if (value !== null) update("emitterDopingCm3", value); }} />
              <ScientificNumberField id="base-doping" labelText={<>Base N<sub>A</sub></>} unit="cm⁻³" value={inputs.baseDopingCm3} min={1e14} max={5e17} onValueChange={(value) => { if (value !== null) update("baseDopingCm3", value); }} />
              <ScientificNumberField id="collector-doping" labelText={<>Collector N<sub>D</sub></>} unit="cm⁻³" value={inputs.collectorDopingCm3} min={1e14} max={5e17} onValueChange={(value) => { if (value !== null) update("collectorDopingCm3", value); }} />
              <Field label="Length (µm)"><input type="number" value={inputs.lengthUm} min="1.5" max="10" step="0.1" onChange={(event) => update("lengthUm", Number(event.target.value))} /></Field>
              <Field label="Height (µm)"><input type="number" value={inputs.heightUm} min="0.2" max="3" step="0.05" onChange={(event) => update("heightUm", Number(event.target.value))} /></Field>
              <Field label="Device depth (µm)"><input type="number" value={inputs.deviceDepthUm} min="1" max="1e5" step="any" onChange={(event) => update("deviceDepthUm", Number(event.target.value))} /></Field>
              <Field label="Emitter width (µm)"><input type="number" value={inputs.emitterWidthUm} min="0.2" max="4" step="0.05" onChange={(event) => update("emitterWidthUm", Number(event.target.value))} /></Field>
              <Field label="Base width (µm)"><input type="number" value={inputs.baseWidthUm} min="0.1" max="2" step="0.05" onChange={(event) => update("baseWidthUm", Number(event.target.value))} /></Field>
              <Field label="x nodes"><input type="number" value={inputs.nx} min="41" max="501" step="2" onChange={(event) => update("nx", Number(event.target.value))} /></Field>
              <Field label="y nodes"><input type="number" value={inputs.ny} min="9" max="121" step="2" onChange={(event) => update("ny", Number(event.target.value))} /></Field>
              <ScientificNumberField id="bjt-electron-lifetime" labelText={<>τ<sub>n</sub></>} unit="s" value={inputs.electronLifetimeS} min={1e-12} max={1e-3} onValueChange={(value) => { if (value !== null) update("electronLifetimeS", value); }} />
              <ScientificNumberField id="bjt-hole-lifetime" labelText={<>τ<sub>p</sub></>} unit="s" value={inputs.holeLifetimeS} min={1e-12} max={1e-3} onValueChange={(value) => { if (value !== null) update("holeLifetimeS", value); }} />
            </div>
          </details>
          </fieldset>
          <Message state={errors.length ? "error" : validation.warnings.length ? "warning" : "ready"}>{errors[0] ?? validation.warnings[0] ?? "Configuration and mesh checks passed."}</Message>
          <div className="solver-progress"><progress max={Math.max(1, progress.total)} value={progress.completed} aria-label="Characteristic grid progress" /><span>{progress.completed} / {progress.total} bias points</span></div>
          <output className="solver-line" aria-live="polite">{message}</output>
        </>
      }>
        <header className="workspace-heading grid items-end gap-2 pb-3">
          <div><h1>Lateral NPN characteristics</h1><p>Two-dimensional drift–diffusion with SRH recombination</p></div>
          <span className="bias-badge">{fixed(inputs.minimumVbeV, 2)} ≤ V<sub>BE</sub> ≤ {fixed(inputs.maximumVbeV, 2)} V · 0 ≤ V<sub>CE</sub> ≤ {fixed(inputs.maximumVceV, 2)} V</span>
        </header>

        <div className="device-strip bjt-strip" aria-label="Lateral NPN transistor geometry">
          <span className="contact">Emitter</span><div className="region region-n"><strong>N</strong><small>Emitter</small></div><div className="region region-p"><span className="base-contact">Base</span><strong>P</strong><small>Base</small></div><div className="region region-n"><strong>N</strong><small>Collector</small></div><span className="contact">Collector</span>
        </div>
        <details className="device-context">
          <summary>Real-device context</summary>
          <div><img src={bjtCutaway} width="1536" height="1024" loading="lazy" alt="Cutaway of a TO-92 bipolar transistor showing its silicon die, bond wires, lead frame, and encapsulation" /><p>The solver uses a lateral NPN cross-section to expose 2D transport. A commercial discrete BJT commonly uses a vertical die, so geometry-dependent gain and current crowding are not claimed to match the package illustration.</p></div>
        </details>

        <section className="primary-dashboard bjt-dashboard" aria-labelledby="bjt-result-title">
          <div className="main-chart">
            <LineChart
              ref={outputChartRef}
              x={outputX}
              series={outputSeries}
              xLabel="V<sub>CE</sub> (V)"
              yLabel="I<sub>C</sub> (mA)"
              markerX={selectedPoint?.collectorEmitterVoltageV}
              includeZero
              height={430}
              state={plotState}
              message={solverState === "solving" ? "Calculating the characteristic grid" : "Awaiting a base–emitter × collector–emitter voltage grid"}
              interactive
              onSelectX={(value) => selectedCurve && requestPoint(curveIndex, nearestIndex(selectedCurve.points, value, (point) => point.collectorEmitterVoltageV))}
            />
          </div>
          <aside className="result-inspector bjt-inspector">
            <div><h2 id="bjt-result-title">NPN characteristics</h2></div>
            <LineChart
              x={transferX}
              series={transferSeries}
              xLabel="V<sub>BE</sub> (V)"
              yLabel="I<sub>C</sub> (mA)"
              markerX={selectedCurve?.baseEmitterVoltageV}
              includeZero
              height={155}
              state={plotState}
              message="Awaiting characteristic grid"
              interactive
              onSelectX={(value) => family && requestPoint(nearestIndex(family.curves, value, (curve) => curve.baseEmitterVoltageV), pointIndex)}
            />
            <div className="control-row">
              <Field label={<>V<sub>BE</sub> curve</>}><select disabled={!family} value={Math.max(0, curveIndex)} onChange={(event) => requestPoint(Number(event.target.value), pointIndex)}>{family?.curves.map((curve, index) => <option key={curve.baseEmitterVoltageV} value={index}>{fixed(curve.baseEmitterVoltageV)} V</option>)}</select></Field>
              <Field label={<>Inspect V<sub>CE</sub> = {selectedPoint ? fixed(selectedPoint.collectorEmitterVoltageV) : "—"} V</>}><input type="range" min="0" max={Math.max(0, (selectedCurve?.points.length ?? 1) - 1)} step="1" value={Math.max(0, pointIndex)} disabled={!family} onChange={(event) => requestPoint(curveIndex, Number(event.target.value))} /></Field>
            </div>
            <label className="check"><input type="checkbox" checked={showReference} onChange={(event) => setShowReference(event.target.checked)} /> Low-injection analytical reference</label>
            <MetricGrid compact entries={[
              ["Region", result ? classifyRegion(result.config.baseEmitterVoltageV, result.config.collectorEmitterVoltageV) : "—"],
              [<>V<sub>BE</sub> / V<sub>CE</sub></>, result ? `${fixed(result.config.baseEmitterVoltageV)} / ${fixed(result.config.collectorEmitterVoltageV)} V` : "—"],
              [<>I<sub>C</sub></>, result ? `${scientific(collector * 1e3)} mA` : "—"],
              [<>I<sub>B</sub></>, result ? `${scientific(base * 1e6)} µA` : "—"],
              [<>I<sub>E</sub></>, result ? `${scientific(-emitter * 1e3)} mA` : "—"],
              [<>β = I<sub>C</sub>/I<sub>B</sub></>, Number.isFinite(beta) ? fixed(beta, 2) : "—"],
            ]} />
          </aside>
        </section>

        <Disclosure title="Internal 2D fields" summary="Potential, carriers, current density, and SRH recombination">
          <div className="heatmap-grid">
            <Map title="Electrostatic potential ψ(x,y)"><Heatmap values={result?.potentialV} nx={result?.nx} ny={result?.ny} lengthUm={result?.derived.lengthM ? result.derived.lengthM * 1e6 : 1} heightUm={result?.derived.heightM ? result.derived.heightM * 1e6 : 1} label="ψ (V)" /></Map>
            <Map title="Electron density n(x,y)"><Heatmap values={result?.electronM3} nx={result?.nx} ny={result?.ny} lengthUm={result?.derived.lengthM ? result.derived.lengthM * 1e6 : 1} heightUm={result?.derived.heightM ? result.derived.heightM * 1e6 : 1} label="log₁₀ n (cm⁻³)" transform={(value) => Math.log10(value / 1e6)} /></Map>
            <Map title="Total current-density magnitude"><Heatmap values={result?.totalCurrentDensityXAm2} nx={result?.nx} ny={result?.ny} lengthUm={result?.derived.lengthM ? result.derived.lengthM * 1e6 : 1} heightUm={result?.derived.heightM ? result.derived.heightM * 1e6 : 1} label="log₁₀ |J| (A/m²)" transform={(value, index) => Math.log10(Math.max(1e-30, Math.hypot(value, Number(result?.totalCurrentDensityYAm2[index]))))} /></Map>
            <Map title="Signed SRH recombination"><Heatmap values={result?.recombinationM3s} nx={result?.nx} ny={result?.ny} lengthUm={result?.derived.lengthM ? result.derived.lengthM * 1e6 : 1} heightUm={result?.derived.heightM ? result.derived.heightM * 1e6 : 1} label="signed R" diverging transform={(value) => Math.sign(value) * Math.log10(1 + Math.abs(value))} /></Map>
          </div>
        </Disclosure>

        <Disclosure title="Numerical confidence" summary="Residuals, terminal balance, mesh, and model limits">
          {result ? <>
            <ScientificValidationSummary
              status={{ state: result.warnings.length ? "warning" : "validated", label: result.warnings.length ? "Converged with warnings" : "Numerically validated" }}
              checks={[
                { id: "solver", label: "Nonlinear solve", state: "passed", value: `${result.diagnostics.totalIterations} iterations`, detail: result.diagnostics.backend },
                { id: "residuals", label: "Coupled residuals", state: "passed", value: `${scientific(result.diagnostics.poissonResidual)} / ${scientific(result.diagnostics.electronResidual)} / ${scientific(result.diagnostics.holeResidual)}`, detail: "Poisson / electron / hole" },
                { id: "kcl", label: "Terminal KCL", state: "passed", value: percent(result.diagnostics.terminalKclError) },
                { id: "carriers", label: "Carrier balance", state: "passed", value: `${percent(result.diagnostics.electronBalanceError)} / ${percent(result.diagnostics.holeBalanceError)}`, detail: "Electron / hole" },
                { id: "mesh", label: "Mesh", state: "passed", value: `${result.nx} × ${result.ny} nodes` },
              ]}
            />
            <WarningList warnings={result.warnings} />
          </> : <Message state="idle">Calculate the characteristic grid before interpreting numerical confidence.</Message>}
        </Disclosure>

        <details className="export-panel"><summary>Export converged results</summary><div className="button-row"><Button kind="tertiary" size="sm" disabled={!result} onClick={() => { if (!result) return; downloadText(serializeNpnProfileCsv(result), "npn-selected-2d.csv"); setMessage("Selected profile exported as npn-selected-2d.csv."); }}>Selected 2D CSV</Button><Button kind="tertiary" size="sm" disabled={!selectedCurve || !family} onClick={() => { if (!selectedCurve || !family) return; downloadText(serializeNpnSweepCsv({ ...selectedCurve, config: { ...family.config, baseEmitterVoltageV: selectedCurve.baseEmitterVoltageV } }), "npn-output-curve.csv"); setMessage("Output curve exported as npn-output-curve.csv."); }}>Selected curve CSV</Button><Button kind="tertiary" size="sm" disabled={!family} onClick={() => { outputChartRef.current?.downloadSvg("npn-output-characteristics.svg"); setMessage("Plot exported as npn-output-characteristics.svg."); }}>Plot SVG</Button></div></details>
        <ScientificModelScope
          model="Two-dimensional stationary lateral NPN drift–diffusion model."
          assumptions={["Homogeneous silicon", "Boltzmann statistics", "Constant mobility", "Ohmic contacts", "Midgap SRH recombination"]}
          limits={["No breakdown or tunneling", "No high-field mobility", "No contact resistance", "No self-heating"]}
        />
      </LabLayout>
  );
}

function validateSweep(input: Inputs): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(input.minimumVbeV) || input.minimumVbeV < -0.2 || input.minimumVbeV > 0.75) errors.push("Minimum base–emitter voltage must be between −0.2 and 0.75 V.");
  if (!Number.isFinite(input.maximumVbeV) || input.maximumVbeV < -0.2 || input.maximumVbeV > 0.75) errors.push("Maximum base–emitter voltage must be between −0.2 and 0.75 V.");
  if (input.minimumVbeV >= input.maximumVbeV) errors.push("Minimum base–emitter voltage must be smaller than maximum base–emitter voltage.");
  if (!Number.isInteger(input.basePointCount) || input.basePointCount < 3 || input.basePointCount > 9) errors.push("The number of base–emitter curves must be an integer between 3 and 9.");
  if (!Number.isFinite(input.maximumVceV) || input.maximumVceV < 0.1 || input.maximumVceV > 5) errors.push("Maximum collector–emitter voltage must be between 0.1 and 5 V.");
  if (!Number.isInteger(input.collectorPointCount) || input.collectorPointCount < 5 || input.collectorPointCount > 21) errors.push("The number of collector–emitter points must be an integer between 5 and 21.");
  return errors;
}

function classifyRegion(vbe: number, vce: number) {
  if (vbe < 0.3) return "Cutoff";
  return vce <= vbe ? "Saturation" : "Forward active";
}

function Map({ title, children }: { title: string; children: React.ReactNode }) {
  return <figure className="profile-card"><figcaption>{title}</figcaption>{children}</figure>;
}

function WarningList({ warnings }: { warnings: string[] }) {
  return warnings.length ? <ul className="warning-list">{[...new Set(warnings)].map((warning) => <li key={warning}>{warning}</li>)}</ul> : null;
}
