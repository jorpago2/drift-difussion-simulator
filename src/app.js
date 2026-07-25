import {
  DEFAULT_PN_CONFIG,
  serializePnProfileCsv,
  serializePnSweepCsv,
  shockleyReferenceCurrentDensity,
  solvePnJunction1D,
  validatePnConfig,
} from "./ddm-core.js";
import { createNiceScale, formatChartTick } from "./plot-utils.js";

const LESSONS = Object.freeze({
  equilibrium: {
    biasV: 0,
    kicker: "Thermal equilibrium",
    title: "Predict the junction before solving",
    prediction: "Before solving, predict the direction of the built-in field and which side has the wider depletion region.",
    question: "What establishes equilibrium?",
    detail: "Initial diffusion leaves uncovered charge, creates a built-in field, and bends the bands until the Fermi level is aligned.",
    result: "Verify that the Fermi level is flat, the total current is zero, and the electrostatic drop matches the built-in potential.",
  },
  forward: {
    biasV: 0.6,
    kicker: "Forward bias",
    title: "Observe how the barrier decreases",
    prediction: "Predict how the depletion region changes and which carriers are injected when a positive voltage is applied to the anode.",
    question: "Why does the current increase?",
    detail: "Forward bias lowers the barrier, narrows the depletion region, and exponentially increases minority-carrier injection.",
    result: "Relate the reduced band bending to increased minority carriers, SRH recombination, and current density.",
  },
  reverse: {
    biasV: -0.5,
    kicker: "Reverse bias",
    title: "Explore depletion-region widening",
    prediction: "Predict how the depletion width, peak field, and SRH generation change under reverse bias.",
    question: "What does this model omit?",
    detail: "Reverse bias raises the barrier and widens the depletion region. Avalanche and tunneling are omitted, so breakdown cannot be predicted.",
    result: "Verify the increased field and net generation in the depletion region without interpreting the curve as a breakdown model.",
  },
});

const STAGES = Object.freeze({
  device: ["Step 1 of 4", "Device"],
  solve: ["Step 2 of 4", "Solve"],
  results: ["Step 3 of 4", "Results"],
  validate: ["Step 4 of 4", "Validate"],
});

const dom = Object.fromEntries([
  "globalStatus", "openPanelButton", "closePanelButton", "controlPanel", "stageKicker", "panelTitle",
  "lessonKicker", "workspaceTitle", "biasBadge", "predictionText", "pDopingLabel", "nDopingLabel",
  "depletionZone", "preflightSummary", "resultsArea", "lessonSelect", "acceptorInput", "donorInput",
  "deviceOverview", "deviceAreaInput", "circuitMetrics",
  "biasInput", "lengthInput", "cellsInput", "electronLifetimeInput", "holeLifetimeInput", "predictionTitle",
  "predictionDetail", "preflightDetails", "derivedMetrics", "solveButton", "solverMessage", "resultExplanation",
  "showElectrostaticsButton", "showCarriersButton", "generateJvButton", "jvInlineButton", "sweepMessage",
  "validationBanner", "validationMetrics", "warningList", "exportCsvButton", "exportPngButton", "cursorReadout",
  "potentialCanvas", "fieldCanvas", "chargeCanvas", "carrierCanvas", "bandCanvas", "jvCanvas", "jvEmpty",
  "jvFigure", "electrostaticsView", "carriersView", "jvView",
].map((id) => [id, requireElement(id)]));

const stageButtons = [...document.querySelectorAll("[data-stage]")];
const stagePanels = [...document.querySelectorAll("[data-stage-panel]")];
const viewTabs = [...document.querySelectorAll("[data-view-tab]")];
const dockedPanelMedia = window.matchMedia("(min-width: 1180px)");
const configInputs = [
  dom.acceptorInput,
  dom.donorInput,
  dom.biasInput,
  dom.deviceAreaInput,
  dom.lengthInput,
  dom.cellsInput,
  dom.electronLifetimeInput,
  dom.holeLifetimeInput,
];
const chartRegistry = new Map();

let activeStage = "device";
let activeView = "jv";
let currentResult = null;
let currentSweep = null;
let solving = false;
let desktopPanelDismissed = false;

bindEvents();
applyLesson("equilibrium", false);
updatePreflight();
selectStage("device");
syncPanelMode();

function requireElement(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Required element #${id} is missing.`);
  return element;
}

function bindEvents() {
  dom.openPanelButton.addEventListener("click", () => {
    if (dom.controlPanel.open) closePanel(true);
    else openPanel(activeStage);
  });
  dom.closePanelButton.addEventListener("click", () => closePanel(true));
  dom.controlPanel.addEventListener("close", () => {
    document.body.classList.remove("controls-docked");
    dom.openPanelButton.setAttribute("aria-expanded", "false");
    window.scrollTo({ left: 0, top: window.scrollY });
  });
  dom.controlPanel.addEventListener("cancel", () => dom.openPanelButton.setAttribute("aria-expanded", "false"));
  dockedPanelMedia.addEventListener("change", () => {
    desktopPanelDismissed = false;
    if (dom.controlPanel.open) dom.controlPanel.close();
    syncPanelMode();
  });

  for (const button of stageButtons) {
    button.addEventListener("click", () => selectStage(button.dataset.stage));
  }
  for (const button of viewTabs) {
    button.addEventListener("click", () => selectView(button.dataset.viewTab));
  }

  dom.lessonSelect.addEventListener("change", () => applyLesson(dom.lessonSelect.value, true));
  for (const input of configInputs) {
    input.addEventListener("input", () => {
      invalidateResults();
      updatePreflight();
    });
  }
  dom.solveButton.addEventListener("click", solveCurrentConfiguration);
  dom.generateJvButton.addEventListener("click", generateJvSweep);
  dom.jvInlineButton.addEventListener("click", generateJvSweep);
  dom.showElectrostaticsButton.addEventListener("click", () => showResultView("electrostatics"));
  dom.showCarriersButton.addEventListener("click", () => showResultView("carriers"));
  dom.exportCsvButton.addEventListener("click", exportCsv);
  dom.exportPngButton.addEventListener("click", exportPng);

  for (const canvas of [
    dom.potentialCanvas,
    dom.fieldCanvas,
    dom.chargeCanvas,
    dom.carrierCanvas,
    dom.bandCanvas,
    dom.jvCanvas,
  ]) {
    canvas.addEventListener("pointermove", updateCursorReadout);
    canvas.addEventListener("pointerleave", () => {
      dom.cursorReadout.textContent = "Move the pointer over a plot to inspect the profile.";
    });
  }
}

function openPanel(stage) {
  selectStage(stage);
  desktopPanelDismissed = false;
  if (!dom.controlPanel.open) {
    if (dockedPanelMedia.matches) dom.controlPanel.show();
    else dom.controlPanel.showModal();
  }
  document.body.classList.toggle("controls-docked", dockedPanelMedia.matches);
  dom.openPanelButton.setAttribute("aria-expanded", "true");
}

function closePanel(userInitiated) {
  if (userInitiated && dockedPanelMedia.matches) desktopPanelDismissed = true;
  if (dom.controlPanel.open) dom.controlPanel.close();
}

function syncPanelMode() {
  if (dockedPanelMedia.matches && !desktopPanelDismissed) openPanel(activeStage);
  else document.body.classList.remove("controls-docked");
}

function selectStage(stage) {
  if (!STAGES[stage]) return;
  activeStage = stage;
  const [kicker, title] = STAGES[stage];
  dom.stageKicker.textContent = kicker;
  dom.panelTitle.textContent = title;
  for (const button of stageButtons) {
    if (button.dataset.stage === stage) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
  }
  for (const panel of stagePanels) panel.hidden = panel.dataset.stagePanel !== stage;
}

function selectView(view) {
  if (!currentResult?.diagnostics.converged) return;
  activeView = view;
  for (const button of viewTabs) button.setAttribute("aria-selected", String(button.dataset.viewTab === view));
  dom.electrostaticsView.hidden = view !== "electrostatics";
  dom.carriersView.hidden = view !== "carriers";
  dom.jvView.hidden = view !== "jv";
  updateExportState();
}

function showResultView(view) {
  selectView(view);
  if (dom.controlPanel.open && !dockedPanelMedia.matches) closePanel(false);
  dom.resultsArea.scrollIntoView({ behavior: "smooth", block: "start" });
}

function applyLesson(name, invalidate) {
  const lesson = LESSONS[name] ?? LESSONS.equilibrium;
  dom.lessonSelect.value = name;
  dom.biasInput.value = String(lesson.biasV);
  dom.lessonKicker.textContent = lesson.kicker;
  dom.workspaceTitle.textContent = lesson.title;
  dom.predictionText.textContent = lesson.prediction;
  dom.predictionTitle.textContent = lesson.question;
  dom.predictionDetail.textContent = lesson.detail;
  setTeachingExplanation(lesson.result);
  if (invalidate) invalidateResults();
  updatePreflight();
}

function setTeachingExplanation(text) {
  const paragraph = dom.resultExplanation.querySelector("p");
  if (paragraph) paragraph.textContent = text;
}

function readConfig() {
  return {
    ...DEFAULT_PN_CONFIG,
    acceptorCm3: Number(dom.acceptorInput.value),
    donorCm3: Number(dom.donorInput.value),
    biasV: Number(dom.biasInput.value),
    deviceAreaUm2: Number(dom.deviceAreaInput.value),
    lengthUm: Number(dom.lengthInput.value),
    cells: Number(dom.cellsInput.value),
    electronLifetimeS: Number(dom.electronLifetimeInput.value),
    holeLifetimeS: Number(dom.holeLifetimeInput.value),
  };
}

function updatePreflight() {
  const validation = validatePnConfig(readConfig());
  const { config, errors, warnings, derived } = validation;
  dom.biasBadge.textContent = `V_D = ${formatFixed(config.biasV, 3)} V`;
  dom.pDopingLabel.textContent = `N_A = ${formatScientific(config.acceptorCm3)} cm⁻³`;
  dom.nDopingLabel.textContent = `N_D = ${formatScientific(config.donorCm3)} cm⁻³`;

  if (derived) {
    const widthPercent = clamp(100 * derived.depletionWidthM / derived.lengthM, 5, 65);
    dom.depletionZone.style.width = `${widthPercent}%`;
    renderMetricList(dom.derivedMetrics, [
      ["Estimated built-in potential", `${formatFixed(derived.builtInPotentialV, 3)} V`],
      ["Estimated depletion width", `${formatScientific(derived.depletionWidthM * 1e6)} µm`],
      ["Spatial step", `${formatScientific(derived.dxM * 1e9)} nm`],
      ["Shortest Debye length", `${formatScientific(Math.min(derived.acceptorDebyeLengthM, derived.donorDebyeLengthM) * 1e9)} nm`],
    ]);
  } else {
    dom.depletionZone.style.width = "18%";
    dom.derivedMetrics.replaceChildren();
  }

  if (errors.length) {
    setMessage(dom.preflightSummary, errors.join(" "), "error");
    setMessage(dom.preflightDetails, errors.join(" "), "error");
    dom.solveButton.disabled = true;
  } else if (warnings.length) {
    const text = `Valid configuration with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}.`;
    setMessage(dom.preflightSummary, text, "warning");
    setMessage(dom.preflightDetails, `${text} ${warnings.join(" ")}`, "warning");
    dom.solveButton.disabled = solving;
  } else {
    setMessage(dom.preflightSummary, "Valid configuration. Open “Solve” to calculate the physical state.", "ready");
    setMessage(dom.preflightDetails, "Preflight passed: finite parameters, physical ranges, and adequate mesh.", "ready");
    dom.solveButton.disabled = solving;
  }
}

function invalidateResults() {
  currentResult = null;
  currentSweep = null;
  dom.resultsArea.hidden = true;
  dom.deviceOverview.hidden = false;
  dom.generateJvButton.disabled = true;
  dom.jvFigure.hidden = true;
  dom.jvEmpty.hidden = false;
  dom.sweepMessage.textContent = "Solve an operating point first.";
  dom.circuitMetrics.replaceChildren();
  dom.validationMetrics.replaceChildren();
  dom.warningList.replaceChildren();
  setMessage(dom.validationBanner, "No result to validate.", "idle");
  updateGlobalStatus("Not solved", "idle");
  updateExportState();
}

async function solveCurrentConfiguration() {
  if (solving) return;
  const validation = validatePnConfig(readConfig());
  if (validation.errors.length) {
    setMessage(dom.solverMessage, validation.errors.join(" "), "error");
    return;
  }

  solving = true;
  dom.solveButton.disabled = true;
  updateGlobalStatus("Solving…", "solving");
  setMessage(dom.solverMessage, "Solving equilibrium, voltage continuation, and residuals…", "warning");
  await nextPaint();

  let generateSweep = false;
  try {
    const result = solvePnJunction1D(validation.config);
    currentResult = result;
    currentSweep = null;
    if (!result.diagnostics.converged) {
      dom.resultsArea.hidden = true;
      updateGlobalStatus("Not converged", "failed");
      setMessage(dom.solverMessage, result.diagnostics.failureReason || "The solver did not converge.", "error");
    } else {
      dom.resultsArea.hidden = false;
      dom.deviceOverview.hidden = true;
      dom.workspaceTitle.textContent = "Self-consistent drift-diffusion solution";
      dom.generateJvButton.disabled = false;
      dom.jvFigure.hidden = true;
      dom.jvEmpty.hidden = false;
      dom.sweepMessage.textContent = "Preparing the I–V characteristic…";
      renderResult(result);
      renderValidation(result);
      renderCircuitMetrics(result, null);
      selectView("jv");
      selectStage("results");
      updateGlobalStatus("Converged", "converged");
      setMessage(
        dom.solverMessage,
        `Converged in ${result.diagnostics.totalIterations} cumulative iterations; current-conservation error ${formatScientific(result.diagnostics.currentContinuityError)}.`,
        "ready",
      );
      generateSweep = true;
    }
  } catch (error) {
    currentResult = null;
    updateGlobalStatus("Error", "failed");
    setMessage(dom.solverMessage, error instanceof Error ? error.message : String(error), "error");
  } finally {
    solving = false;
    updatePreflight();
    updateExportState();
  }
  if (generateSweep) await generateJvSweep();
}

function renderResult(result) {
  const xUm = Float64Array.from(result.xM, (value) => value * 1e6);
  drawLineChart(dom.potentialCanvas, {
    x: xUm,
    xLabel: "x (µm)",
    yLabel: "ψ (V)",
    series: [{ label: "ψ", values: result.potentialV, color: "#087e8b" }],
  });
  drawLineChart(dom.fieldCanvas, {
    x: xUm,
    xLabel: "x (µm)",
    yLabel: "E (MV/m)",
    series: [{ label: "E", values: Float64Array.from(result.fieldVm, (value) => value / 1e6), color: "#744da8" }],
  });
  drawLineChart(dom.chargeCanvas, {
    x: xUm,
    xLabel: "x (µm)",
    yLabel: "ρ (C/m³, symlog)",
    transform: symlogTransform(1),
    series: [{ label: "ρ", values: result.chargeCm3, color: "#b33b50" }],
  });
  drawLineChart(dom.carrierCanvas, {
    x: xUm,
    xLabel: "x (µm)",
    yLabel: "Concentration (cm⁻³)",
    transform: logTransform(),
    series: [
      { label: "n", values: Float64Array.from(result.electronM3, (value) => value / 1e6), color: "#2262a5" },
      { label: "p", values: Float64Array.from(result.holeM3, (value) => value / 1e6), color: "#b12f49" },
      { label: "|doping|", values: Float64Array.from(result.dopingM3, (value) => Math.abs(value) / 1e6), color: "#6a7780", dash: [6, 4] },
    ],
  });
  drawLineChart(dom.bandCanvas, {
    x: xUm,
    xLabel: "x (µm)",
    yLabel: "Relative energy (eV)",
    series: [
      { label: "Ec", values: result.conductionBandEv, color: "#2262a5" },
      { label: "Ei", values: result.intrinsicBandEv, color: "#72858c", dash: [5, 4] },
      { label: "Ev", values: result.valenceBandEv, color: "#b12f49" },
      { label: "Fn", values: result.electronQuasiFermiEv, color: "#0a8876", dash: [8, 3] },
      { label: "Fp", values: result.holeQuasiFermiEv, color: "#ca7b00", dash: [8, 3] },
    ],
  });
  for (const canvas of [dom.potentialCanvas, dom.fieldCanvas, dom.chargeCanvas, dom.carrierCanvas, dom.bandCanvas]) {
    chartRegistry.set(canvas, { type: "profile", x: xUm });
  }
}

async function generateJvSweep() {
  if (solving || !currentResult?.diagnostics.converged) return;
  solving = true;
  dom.generateJvButton.disabled = true;
  dom.jvInlineButton.disabled = true;
  updateGlobalStatus("I–V sweep…", "solving");
  setMessage(dom.sweepMessage, "Preparing equilibrium for the sweep…", "warning");

  try {
    const baseConfig = { ...readConfig(), biasV: 0 };
    const voltages = Array.from({ length: 67 }, (_, index) => Number((-1 + index * 0.025).toFixed(3)));
    const results = new Map();
    const equilibrium = solvePnJunction1D(baseConfig);
    results.set(0, equilibrium);
    const branches = [
      voltages.filter((value) => value < 0).sort((a, b) => b - a),
      voltages.filter((value) => value > 0),
    ];
    let solved = 1;
    for (const branch of branches) {
      let previous = equilibrium;
      for (const voltage of branch) {
        previous = solvePnJunction1D({ ...baseConfig, biasV: voltage }, previous);
        results.set(voltage, previous);
        solved += 1;
        setMessage(dom.sweepMessage, `Solving I–V: ${solved}/67 points…`, "warning");
        await nextPaint();
        if (!previous.diagnostics.converged) break;
      }
    }

    const points = voltages.map((voltage) => {
      const result = results.get(voltage);
      return {
        voltageV: voltage,
        currentDensityAm2: result?.diagnostics.meanCurrentDensityAm2 ?? NaN,
        shockleyCurrentDensityAm2: voltage <= equilibrium.derived.lowInjectionLimitV
          ? shockleyReferenceCurrentDensity(baseConfig, voltage)
          : null,
        converged: result?.diagnostics.converged ?? false,
      };
    });
    currentSweep = {
      config: baseConfig,
      points,
      converged: points.every((point) => point.converged),
      warnings: currentResult.warnings,
    };
    if (!currentSweep.converged) {
      throw new Error("The sweep stopped because at least one point did not converge.");
    }
    renderJv(currentSweep);
    renderCircuitMetrics(currentResult, currentSweep);
    dom.jvEmpty.hidden = true;
    dom.jvFigure.hidden = false;
    selectView("jv");
    updateGlobalStatus("I–V converged", "converged");
    setMessage(dom.sweepMessage, "67 points converged from −1.00 to 0.65 V.", "ready");
    if (dom.controlPanel.open && !dockedPanelMedia.matches) closePanel(false);
  } catch (error) {
    currentSweep = null;
    updateGlobalStatus("Sweep failed", "failed");
    setMessage(dom.sweepMessage, error instanceof Error ? error.message : String(error), "error");
  } finally {
    solving = false;
    dom.generateJvButton.disabled = !currentResult?.diagnostics.converged;
    dom.jvInlineButton.disabled = false;
    updateExportState();
  }
}

function renderJv(sweep) {
  const voltage = Float64Array.from(sweep.points, (point) => point.voltageV);
  const areaM2 = sweep.config.deviceAreaUm2 * 1e-12;
  const current = Float64Array.from(sweep.points, (point) => point.currentDensityAm2 * areaM2 * 1e3);
  const reference = Float64Array.from(sweep.points, (point) =>
    point.shockleyCurrentDensityAm2 == null ? NaN : point.shockleyCurrentDensityAm2 * areaM2 * 1e3,
  );
  drawLineChart(dom.jvCanvas, {
    x: voltage,
    xLabel: "V_D (V)",
    yLabel: "I_D (mA)",
    includeZero: true,
    series: [
      { label: "DD + SRH", values: current, color: "#087e8b" },
      { label: "Shockley", values: reference, color: "#ca7b00", dash: [7, 4] },
    ],
  });
  chartRegistry.set(dom.jvCanvas, { type: "sweep", x: voltage });
}

function renderCircuitMetrics(result, sweep) {
  const currentA = result.diagnostics.meanCurrentDensityAm2 * result.derived.deviceAreaM2;
  const biasV = result.config.biasV;
  const region = biasV > 1e-12 ? "Forward bias" : biasV < -1e-12 ? "Reverse bias" : "Equilibrium";
  let dynamicResistance = "Available after I–V sweep";
  if (sweep?.converged) {
    let index = 0;
    for (let i = 1; i < sweep.points.length; i += 1) {
      if (Math.abs(sweep.points[i].voltageV - biasV) < Math.abs(sweep.points[index].voltageV - biasV)) index = i;
    }
    if (Math.abs(sweep.points[index].voltageV - biasV) <= 0.0126) {
      const left = sweep.points[Math.max(0, index - 1)];
      const right = sweep.points[Math.min(sweep.points.length - 1, index + 1)];
      const deltaCurrentA = (right.currentDensityAm2 - left.currentDensityAm2) * result.derived.deviceAreaM2;
      const resistanceOhm = (right.voltageV - left.voltageV) / deltaCurrentA;
      if (Number.isFinite(resistanceOhm) && resistanceOhm > 0) dynamicResistance = `${formatScientific(resistanceOhm)} Ω`;
    } else {
      dynamicResistance = "Outside plotted range";
    }
  }
  renderMetricList(dom.circuitMetrics, [
    ["Operating region", region],
    ["Operating voltage", `${formatFixed(biasV, 3)} V`],
    ["Terminal current", formatNearZero(currentA * 1e3, 1e-12, "mA")],
    ["Current density", formatNearZero(result.diagnostics.meanCurrentDensityAm2 / 1e4, 1e-15, "A/cm²")],
    ["Small-signal r_d", dynamicResistance],
    ["Defined area", `${formatScientific(result.config.deviceAreaUm2)} µm²`],
  ]);
}

function renderValidation(result) {
  const potentialBarrierV = result.potentialV.at(-1) - result.potentialV[0];
  const expectedBarrierV = result.derived.builtInPotentialV - result.config.biasV;
  renderMetricList(dom.validationMetrics, [
    ["Status", result.diagnostics.converged ? "Converged" : "Not converged"],
    ["Poisson residual", formatScientific(result.diagnostics.poissonResidual)],
    ["Electron residual", formatScientific(result.diagnostics.electronResidual)],
    ["Hole residual", formatScientific(result.diagnostics.holeResidual)],
    ["J nonuniformity", formatPercent(result.diagnostics.currentContinuityError)],
    ["Mean J", `${formatScientific(result.diagnostics.meanCurrentDensityAm2 / 1e4)} A/cm²`],
    ["Simulated / expected barrier", `${formatFixed(potentialBarrierV, 4)} / ${formatFixed(expectedBarrierV, 4)} V`],
    ["Mesh", `${result.config.cells} nodes; Δx = ${formatScientific(result.derived.dxM * 1e9)} nm`],
  ]);
  setMessage(
    dom.validationBanner,
    result.diagnostics.converged
      ? "PASS: equations, positivity, and conservation satisfy the v1 thresholds."
      : "FAIL: do not use this result as a physical solution.",
    result.diagnostics.converged ? "pass" : "error",
  );
  const limitations = [
    ...result.warnings,
    "No avalanche or tunneling: reverse bias does not predict breakdown.",
    "Boltzmann statistics and constant mobility: this is not a general TCAD model at high density or field.",
  ];
  replaceList(dom.warningList, [...new Set(limitations)]);
}

function renderMetricList(container, entries) {
  const fragment = document.createDocumentFragment();
  for (const [term, definition] of entries) {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = term;
    dd.textContent = definition;
    row.append(dt, dd);
    fragment.append(row);
  }
  container.replaceChildren(fragment);
}

function replaceList(container, items) {
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    fragment.append(li);
  }
  container.replaceChildren(fragment);
}

function setMessage(element, text, state) {
  element.textContent = text;
  element.dataset.state = state;
}

function updateGlobalStatus(text, state) {
  dom.globalStatus.textContent = text;
  dom.globalStatus.dataset.state = state;
}

function updateExportState() {
  const resultReady = currentResult?.diagnostics.converged === true;
  const sweepRequired = activeView === "jv";
  dom.exportCsvButton.disabled = !resultReady || (sweepRequired && !currentSweep?.converged);
  dom.exportPngButton.disabled = !resultReady || (sweepRequired && !currentSweep?.converged);
}

function exportCsv() {
  if (!currentResult?.diagnostics.converged) return;
  const isSweep = activeView === "jv";
  const csv = isSweep ? serializePnSweepCsv(currentSweep) : serializePnProfileCsv(currentResult);
  downloadBlob(csv, "text/csv;charset=utf-8", isSweep ? "pn-junction-iv.csv" : "pn-junction-profile.csv");
}

function exportPng() {
  if (!currentResult?.diagnostics.converged) return;
  const canvas = activeView === "jv" ? dom.jvCanvas :
    (activeView === "carriers" ? dom.carrierCanvas : dom.potentialCanvas);
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, "image/png", `pn-junction-${activeView}.png`);
  }, "image/png");
}

function downloadBlob(content, type, filename) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function drawLineChart(canvas, specification) {
  const { context, width, height } = prepareCanvas(canvas);
  const pad = { left: 86, right: 18, top: 48, bottom: 58 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const transform = specification.transform ?? linearTransform();
  const xValues = [...specification.x].filter(Number.isFinite);
  const yValues = [];
  for (const series of specification.series) {
    for (const value of series.values) if (Number.isFinite(value) && transform.valid(value)) yValues.push(transform.forward(value));
  }
  const xScale = createNiceScale(xValues, 8);
  const yScale = createNiceScale(yValues, 7, specification.includeZero);
  const mapX = (value) => pad.left + ((value - xScale.min) / (xScale.max - xScale.min)) * plotWidth;
  const mapY = (value) => pad.top + plotHeight - ((value - yScale.min) / (yScale.max - yScale.min)) * plotHeight;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.font = "600 11px Inter, system-ui, sans-serif";
  context.fillStyle = "#52676e";

  for (const tick of xScale.ticks) {
    const x = mapX(tick);
    context.strokeStyle = tick === 0 ? "#b8c7cb" : "#e8eef0";
    context.lineWidth = tick === 0 ? 1.2 : 1;
    drawLine(context, x, pad.top, x, pad.top + plotHeight);
    context.textAlign = "center";
    context.fillText(formatChartTick(tick, xScale.step), x, pad.top + plotHeight + 21);
  }
  for (const tick of yScale.ticks) {
    const y = mapY(tick);
    context.strokeStyle = tick === 0 ? "#b8c7cb" : "#e8eef0";
    context.lineWidth = tick === 0 ? 1.2 : 1;
    drawLine(context, pad.left, y, pad.left + plotWidth, y);
    context.textAlign = "right";
    const labelStep = transform.kind === "linear" ? yScale.step : 0;
    context.fillText(formatChartTick(transform.inverse(tick), labelStep), pad.left - 11, y + 4);
  }

  context.strokeStyle = "#334a51";
  context.lineWidth = 1.25;
  drawLine(context, pad.left, pad.top + plotHeight, pad.left + plotWidth, pad.top + plotHeight);
  drawLine(context, pad.left, pad.top, pad.left, pad.top + plotHeight);

  context.save();
  context.beginPath();
  context.rect(pad.left, pad.top, plotWidth, plotHeight);
  context.clip();
  context.lineJoin = "round";
  context.lineCap = "round";
  for (const series of specification.series) {
    context.strokeStyle = series.color;
    context.lineWidth = 2.6;
    context.setLineDash(series.dash ?? []);
    context.beginPath();
    let drawing = false;
    for (let i = 0; i < specification.x.length; i += 1) {
      const xValue = specification.x[i];
      const yValue = series.values[i];
      if (!Number.isFinite(xValue) || !Number.isFinite(yValue) || !transform.valid(yValue)) {
        drawing = false;
        continue;
      }
      const x = mapX(xValue);
      const transformedY = transform.forward(yValue);
      const y = mapY(transformedY);
      if (!drawing) context.moveTo(x, y);
      else context.lineTo(x, y);
      drawing = true;
    }
    context.stroke();
  }
  context.restore();
  context.setLineDash([]);

  context.textAlign = "center";
  context.fillStyle = "#20343b";
  context.font = "700 12px Inter, system-ui, sans-serif";
  context.fillText(specification.xLabel, pad.left + plotWidth / 2, height - 10);
  context.save();
  context.translate(17, pad.top + plotHeight / 2);
  context.rotate(-Math.PI / 2);
  context.fillText(specification.yLabel, 0, 0);
  context.restore();

  let legendX = pad.left;
  context.textAlign = "left";
  context.font = "700 11px Inter, system-ui, sans-serif";
  for (const series of specification.series) {
    context.strokeStyle = series.color;
    context.lineWidth = 3;
    context.setLineDash(series.dash ?? []);
    drawLine(context, legendX, 20, legendX + 22, 20);
    context.setLineDash([]);
    context.fillStyle = "#40555c";
    context.fillText(series.label, legendX + 28, 24);
    legendX += 42 + context.measureText(series.label).width;
  }
}

function prepareCanvas(canvas) {
  const logicalWidth = Number(canvas.dataset.logicalWidth || canvas.getAttribute("width"));
  const logicalHeight = Number(canvas.dataset.logicalHeight || canvas.getAttribute("height"));
  canvas.dataset.logicalWidth = String(logicalWidth);
  canvas.dataset.logicalHeight = String(logicalHeight);
  const displayScale = canvas.clientWidth > 0 ? canvas.clientWidth / logicalWidth : 1;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
  const backingScale = Math.max(pixelRatio, displayScale * pixelRatio);
  const backingWidth = Math.round(logicalWidth * backingScale);
  const backingHeight = Math.round(logicalHeight * backingScale);
  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }
  const context = canvas.getContext("2d");
  context.setTransform(backingScale, 0, 0, backingScale, 0, 0);
  return { context, width: logicalWidth, height: logicalHeight };
}

function updateCursorReadout(event) {
  if (!currentResult) return;
  const canvas = event.currentTarget;
  const chart = chartRegistry.get(canvas);
  if (!chart) return;
  const rect = canvas.getBoundingClientRect();
  const fraction = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  const index = Math.round(fraction * (chart.x.length - 1));
  if (chart.type === "sweep") {
    const point = currentSweep?.points[index];
    if (point) {
      const currentMa = point.currentDensityAm2 * currentSweep.config.deviceAreaUm2 * 1e-9;
      dom.cursorReadout.textContent = `V_D=${formatFixed(point.voltageV, 3)} V | I_D=${formatScientific(currentMa)} mA | J=${formatScientific(point.currentDensityAm2 / 1e4)} A/cm²`;
    }
    return;
  }
  dom.cursorReadout.textContent = [
    `x=${formatFixed(currentResult.xM[index] * 1e6, 3)} µm`,
    `ψ=${formatFixed(currentResult.potentialV[index], 4)} V`,
    `E=${formatScientific(currentResult.fieldVm[index])} V/m`,
    `n=${formatScientific(currentResult.electronM3[index] / 1e6)} cm⁻³`,
    `p=${formatScientific(currentResult.holeM3[index] / 1e6)} cm⁻³`,
  ].join(" | ");
}

function linearTransform() {
  return { kind: "linear", forward: (value) => value, inverse: (value) => value, valid: Number.isFinite };
}

function logTransform() {
  return {
    kind: "log",
    forward: (value) => Math.log10(value),
    inverse: (value) => 10 ** value,
    valid: (value) => Number.isFinite(value) && value > 0,
  };
}

function symlogTransform(linear) {
  return {
    kind: "symlog",
    forward: (value) => Math.sign(value) * Math.log10(1 + Math.abs(value) / linear),
    inverse: (value) => Math.sign(value) * linear * (10 ** Math.abs(value) - 1),
    valid: Number.isFinite,
  };
}

function drawLine(context, x1, y1, x2, y2) {
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
}

function formatScientific(value) {
  if (!Number.isFinite(value)) return "–";
  if (value === 0) return "0";
  return value.toExponential(2).replace("e+", "e");
}

function formatNearZero(value, threshold, unit) {
  return `${Math.abs(value) < threshold ? "≈ 0" : formatScientific(value)} ${unit}`;
}

function formatFixed(value, decimals) {
  return Number.isFinite(value) ? value.toFixed(decimals).replace("-0.000", "0.000") : "–";
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${(value * 100).toExponential(2)} %` : "–";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}
