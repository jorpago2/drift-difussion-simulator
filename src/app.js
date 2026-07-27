import {
  DEFAULT_PN_CONFIG,
  serializePnProfileCsv,
  serializePnSweepCsv,
  shockleyReferenceCurrentDensity,
  solvePnJunction1D,
  validatePnConfig,
} from "./ddm-core.js";
import {
  createNiceScale,
  drawScientificText,
  formatChartTick,
  measureScientificText,
  setScientificText,
} from "./plot-utils.js";

const LESSONS = Object.freeze({
  equilibrium: {
    biasV: 0,
    kicker: "Thermal equilibrium",
    title: "PN junction at equilibrium",
    result: "Verify that the Fermi level is flat, the total current is zero, and the electrostatic drop matches the built-in potential.",
  },
  forward: {
    biasV: 0.6,
    kicker: "Forward bias",
    title: "Forward-biased PN junction",
    result: "Relate the reduced band bending to increased minority carriers, SRH recombination, and current density.",
  },
  reverse: {
    biasV: -0.5,
    kicker: "Reverse bias",
    title: "Reverse-biased PN junction",
    result: "Verify the increased field and net generation in the depletion region without interpreting the curve as a breakdown model.",
  },
});

const dom = Object.fromEntries([
  "globalStatus", "openPanelButton", "panelButtonIcon", "controlPanel",
  "lessonKicker", "workspaceTitle", "biasBadge", "pDopingLabel", "nDopingLabel",
  "depletionZone", "preflightSummary", "resultsArea", "lessonSelect", "acceptorInput", "donorInput",
  "deviceAreaInput", "circuitMetrics", "resultsTitle",
  "biasInput", "lengthInput", "cellsInput", "electronLifetimeInput", "holeLifetimeInput",
  "preflightDetails", "derivedMetrics", "solveButton", "solverMessage", "resultExplanation",
  "generateJvButton", "sweepMessage",
  "validationBanner", "validationMetrics", "warningList", "exportProfileCsvButton", "exportSweepCsvButton", "exportPngButton", "cursorReadout",
  "potentialCanvas", "fieldCanvas", "chargeCanvas", "carrierCanvas", "bandCanvas", "jvCanvas",
].map((id) => [id, requireElement(id)]));

const plotCanvases = [
  dom.potentialCanvas,
  dom.fieldCanvas,
  dom.chargeCanvas,
  dom.carrierCanvas,
  dom.bandCanvas,
  dom.jvCanvas,
];
const dockedPanelMedia = window.matchMedia("(min-width: 981px)");
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
const chartResizeObserver = new ResizeObserver(scheduleChartRedraw);

let currentResult = null;
let currentSweep = null;
let solving = false;
let chartResizeFrame = 0;
let cursorReadoutTimer = 0;

bindEvents();
applyLesson("equilibrium", false);
updatePreflight();
renderEmptyDashboard();
syncPanelMode();

function requireElement(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Required element #${id} is missing.`);
  return element;
}

function bindEvents() {
  dom.openPanelButton.addEventListener("click", () => {
    dom.controlPanel.open = !dom.controlPanel.open;
    if (dom.controlPanel.open) {
      requestAnimationFrame(() => dom.controlPanel.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  });
  dom.controlPanel.addEventListener("toggle", syncPanelButton);
  dockedPanelMedia.addEventListener("change", syncPanelMode);
  window.addEventListener("resize", scheduleChartRedraw);

  dom.lessonSelect.addEventListener("change", () => applyLesson(dom.lessonSelect.value, true));
  for (const input of configInputs) {
    input.addEventListener("input", () => {
      invalidateResults();
      updatePreflight();
    });
  }
  dom.solveButton.addEventListener("click", solveCurrentConfiguration);
  dom.generateJvButton.addEventListener("click", generateJvSweep);
  dom.exportProfileCsvButton.addEventListener("click", exportProfileCsv);
  dom.exportSweepCsvButton.addEventListener("click", exportSweepCsv);
  dom.exportPngButton.addEventListener("click", exportPng);

  for (const canvas of plotCanvases) {
    chartResizeObserver.observe(canvas);
    canvas.addEventListener("pointermove", updateCursorReadout);
    canvas.addEventListener("click", (event) => {
      updateCursorReadout(event);
      activateCursorReadout();
    });
    canvas.addEventListener("pointerleave", () => {
      if (dom.cursorReadout.dataset.active !== "true") resetCursorReadout();
    });
  }
}

function syncPanelMode() {
  dom.controlPanel.open = dockedPanelMedia.matches;
  syncPanelButton();
}

function syncPanelButton() {
  dom.openPanelButton.setAttribute("aria-expanded", String(dom.controlPanel.open));
  dom.openPanelButton.setAttribute("aria-label", `${dom.controlPanel.open ? "Close" : "Open"} device controls`);
  dom.panelButtonIcon.textContent = dom.controlPanel.open ? "×" : "☰";
}

function scheduleChartRedraw() {
  if (chartResizeFrame || !currentResult?.diagnostics.converged) return;
  chartResizeFrame = requestAnimationFrame(() => {
    chartResizeFrame = 0;
    redrawDashboard();
  });
}

function redrawDashboard() {
  if (!currentResult?.diagnostics.converged) return;
  renderResult(currentResult);
  if (currentSweep?.converged) renderJv(currentSweep);
}

function applyLesson(name, invalidate) {
  const lesson = LESSONS[name] ?? LESSONS.equilibrium;
  dom.lessonSelect.value = name;
  dom.biasInput.value = String(lesson.biasV);
  dom.lessonKicker.textContent = lesson.kicker;
  dom.workspaceTitle.textContent = lesson.title;
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
  setScientificText(dom.biasBadge, `V_D = ${formatFixed(config.biasV, 3)} V`);
  setScientificText(dom.pDopingLabel, `N_A = ${formatScientific(config.acceptorCm3)} cm⁻³`);
  setScientificText(dom.nDopingLabel, `N_D = ${formatScientific(config.donorCm3)} cm⁻³`);

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
    setMessage(dom.preflightSummary, "Configuration ready. Solve the selected operating point.", "ready");
    setMessage(dom.preflightDetails, "Preflight passed: finite parameters, physical ranges, and adequate mesh.", "ready");
    dom.solveButton.disabled = solving;
  }
}

function invalidateResults() {
  currentResult = null;
  currentSweep = null;
  dom.generateJvButton.disabled = true;
  renderEmptyDashboard();
  updateGlobalStatus("Not solved", "idle");
  updateExportState();
}

function renderEmptyDashboard(message = "Awaiting a converged solution") {
  chartRegistry.clear();
  for (const canvas of plotCanvases) {
    const context = canvas.getContext("2d");
    context?.clearRect(0, 0, canvas.width, canvas.height);
    setPlotState(canvas, "empty", message);
  }
  renderMetricList(dom.circuitMetrics, [
    ["Operating region", "—"],
    ["Operating voltage", "—"],
    ["Terminal current", "—"],
    ["Current density", "—"],
    ["Small-signal r_d", "—"],
    ["Defined area", "—"],
  ]);
  renderMetricList(dom.validationMetrics, [
    ["Status", "Not solved"],
    ["Poisson residual", "—"],
    ["Electron residual", "—"],
    ["Hole residual", "—"],
    ["J nonuniformity", "—"],
    ["Absolute J spread", "—"],
    ["Electron R balance", "—"],
    ["Hole R balance", "—"],
    ["Mean J", "—"],
    ["Simulated / expected barrier", "—"],
    ["Mesh", "—"],
  ]);
  replaceList(dom.warningList, [
    "No avalanche or tunneling: reverse bias does not predict breakdown.",
    "Boltzmann statistics and constant mobility: this is not a general TCAD model at high density or field.",
  ]);
  dom.sweepMessage.textContent = "Solve an operating point first.";
  setMessage(dom.validationBanner, "No result to validate.", "idle");
}

function setPlotState(canvas, state, message = "") {
  const figure = canvas.closest("[data-plot-state]");
  if (!figure) return;
  figure.dataset.plotState = state;
  figure.dataset.plotMessage = message;
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
      renderEmptyDashboard("No converged result");
      updateGlobalStatus("Not converged", "failed");
      setMessage(dom.solverMessage, result.diagnostics.failureReason || "The solver did not converge.", "error");
    } else {
      dom.generateJvButton.disabled = false;
      setPlotState(dom.jvCanvas, "loading", "Calculating 67 points…");
      dom.sweepMessage.textContent = "Preparing the I–V characteristic…";
      renderResult(result);
      renderValidation(result);
      renderCircuitMetrics(result, null);
      updateGlobalStatus("Converged", "converged");
      setMessage(
        dom.solverMessage,
        `Converged in ${result.diagnostics.totalIterations} cumulative iterations; current-conservation error ${formatScientific(result.diagnostics.currentContinuityError)}.`,
        "ready",
      );
      revealMobileResults();
      generateSweep = true;
    }
  } catch (error) {
    currentResult = null;
    renderEmptyDashboard("Solver error");
    updateGlobalStatus("Error", "failed");
    setMessage(dom.solverMessage, error instanceof Error ? error.message : String(error), "error");
  } finally {
    solving = false;
    updatePreflight();
    updateExportState();
  }
  if (generateSweep) await generateJvSweep();
}

function revealMobileResults() {
  if (dockedPanelMedia.matches) return;
  requestAnimationFrame(() => {
    dom.resultsArea.scrollIntoView({ behavior: "auto", block: "start" });
    dom.resultsTitle.focus({ preventScroll: true });
  });
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
      { label: "E_c", values: result.conductionBandEv, color: "#2262a5" },
      { label: "E_i", values: result.intrinsicBandEv, color: "#72858c", dash: [5, 4] },
      { label: "E_v", values: result.valenceBandEv, color: "#b12f49" },
      { label: "F_n", values: result.electronQuasiFermiEv, color: "#0a8876", dash: [8, 3] },
      { label: "F_p", values: result.holeQuasiFermiEv, color: "#ca7b00", dash: [8, 3] },
    ],
  });
  for (const canvas of [dom.potentialCanvas, dom.fieldCanvas, dom.chargeCanvas, dom.carrierCanvas, dom.bandCanvas]) {
    chartRegistry.set(canvas, { type: "profile", x: xUm });
    setPlotState(canvas, "ready");
  }
}

async function generateJvSweep() {
  if (solving || !currentResult?.diagnostics.converged) return;
  solving = true;
  dom.generateJvButton.disabled = true;
  setPlotState(dom.jvCanvas, "loading", "Calculating 67 points…");
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
        shockleyCurrentDensityAm2: voltage <= equilibrium.derived.lowInjectionLimitV &&
          equilibrium.derived.finiteBaseReferenceValid
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
    updateGlobalStatus("I–V converged", "converged");
    setMessage(dom.sweepMessage, "67 points converged from −1.00 to 0.65 V.", "ready");
  } catch (error) {
    currentSweep = null;
    setPlotState(dom.jvCanvas, "error", "I–V sweep did not converge");
    updateGlobalStatus("Sweep failed", "failed");
    setMessage(dom.sweepMessage, error instanceof Error ? error.message : String(error), "error");
  } finally {
    solving = false;
    dom.generateJvButton.disabled = !currentResult?.diagnostics.converged;
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
      { label: "Finite-base diode", values: reference, color: "#ca7b00", dash: [7, 4] },
    ],
  });
  chartRegistry.set(dom.jvCanvas, { type: "sweep", x: voltage });
  setPlotState(dom.jvCanvas, "ready");
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
    ["Absolute J spread", `${formatScientific(result.diagnostics.currentContinuityAbsoluteErrorAm2 / 1e4)} A/cm²`],
    ["Electron R balance", formatPercent(result.diagnostics.electronBalanceError)],
    ["Hole R balance", formatPercent(result.diagnostics.holeBalanceError)],
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
    setScientificText(dt, term);
    setScientificText(dd, definition);
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
  const sweepReady = currentSweep?.converged === true;
  dom.exportProfileCsvButton.disabled = !resultReady;
  dom.exportSweepCsvButton.disabled = !sweepReady;
  dom.exportPngButton.disabled = !sweepReady;
}

function exportProfileCsv() {
  if (!currentResult?.diagnostics.converged) return;
  downloadBlob(serializePnProfileCsv(currentResult), "text/csv;charset=utf-8", "pn-junction-profile.csv");
}

function exportSweepCsv() {
  if (!currentSweep?.converged) return;
  downloadBlob(serializePnSweepCsv(currentSweep), "text/csv;charset=utf-8", "pn-junction-iv.csv");
}

function exportPng() {
  if (!currentSweep?.converged) return;
  dom.jvCanvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, "image/png", "pn-junction-iv.png");
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
  const compact = width < 520;
  const pad = compact
    ? { left: 58, right: 10, top: 44, bottom: 50 }
    : { left: 86, right: 18, top: 48, bottom: 58 };
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

  const xLabelStride = compact ? 2 : 1;
  for (const [index, tick] of xScale.ticks.entries()) {
    const x = mapX(tick);
    context.strokeStyle = tick === 0 ? "#b8c7cb" : "#e8eef0";
    context.lineWidth = tick === 0 ? 1.2 : 1;
    drawLine(context, x, pad.top, x, pad.top + plotHeight);
    context.textAlign = "center";
    if (index % xLabelStride === 0) {
      context.fillText(formatChartTick(tick, xScale.step), x, pad.top + plotHeight + 19);
    }
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
  drawScientificText(context, specification.xLabel, pad.left + plotWidth / 2, height - 8);
  context.save();
  context.translate(17, pad.top + plotHeight / 2);
  context.rotate(-Math.PI / 2);
  drawScientificText(context, specification.yLabel, 0, 0);
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
    drawScientificText(context, series.label, legendX + 28, 24);
    legendX += 42 + measureScientificText(context, series.label);
  }
}

function prepareCanvas(canvas) {
  const fallbackWidth = Number(canvas.dataset.logicalWidth || canvas.getAttribute("width"));
  const fallbackHeight = Number(canvas.dataset.logicalHeight || canvas.getAttribute("height"));
  canvas.dataset.logicalWidth = String(fallbackWidth);
  canvas.dataset.logicalHeight = String(fallbackHeight);
  const logicalWidth = canvas.clientWidth || fallbackWidth;
  const logicalHeight = canvas.clientHeight || fallbackHeight;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
  const backingWidth = Math.round(logicalWidth * pixelRatio);
  const backingHeight = Math.round(logicalHeight * pixelRatio);
  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }
  const context = canvas.getContext("2d");
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
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
      setScientificText(dom.cursorReadout, `V_D=${formatFixed(point.voltageV, 3)} V | I_D=${formatScientific(currentMa)} mA | J=${formatScientific(point.currentDensityAm2 / 1e4)} A/cm²`);
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

function activateCursorReadout() {
  clearTimeout(cursorReadoutTimer);
  dom.cursorReadout.dataset.active = "true";
  cursorReadoutTimer = window.setTimeout(resetCursorReadout, 4500);
}

function resetCursorReadout() {
  delete dom.cursorReadout.dataset.active;
  dom.cursorReadout.textContent = "Tap or move over a plot to inspect the profile.";
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
