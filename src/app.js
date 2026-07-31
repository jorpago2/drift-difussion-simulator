import {
  DEFAULT_PN_CONFIG,
  createPnVoltageGrid,
  serializePnProfileCsv,
  serializePnSweepCsv,
  shockleyReferenceCurrentDensity,
  solvePnJunction1D,
  validatePnConfig,
} from "./ddm-core.js";
import {
  createBoundedScale,
  createNiceScale,
  drawScientificText,
  formatChartTick,
  measureScientificText,
  setScientificText,
} from "./plot-utils.js";

const dom = Object.fromEntries([
  "globalStatus", "openPanelButton", "panelButtonIcon", "controlPanel",
  "biasBadge", "pDopingLabel", "nDopingLabel", "depletionZone", "preflightSummary", "resultsArea",
  "acceptorInput", "donorInput", "minimumBiasInput", "maximumBiasInput", "jvPointCountInput",
  "deviceAreaInput", "circuitMetrics", "jvSectionTitle", "lengthInput", "cellsInput", "electronLifetimeInput", "holeLifetimeInput",
  "preflightDetails", "derivedMetrics", "solveButton", "solverMessage",
  "sweepMessage", "jvQuantitySelect", "jvScaleSelect", "jvReferenceInput", "profilePointInput", "profileVoltageOutput",
  "xAxisMinInput", "xAxisMaxInput", "yAxisMinInput", "yAxisMaxInput", "resetPlotViewButton", "plotViewportMessage",
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
  dom.minimumBiasInput,
  dom.maximumBiasInput,
  dom.jvPointCountInput,
  dom.deviceAreaInput,
  dom.lengthInput,
  dom.cellsInput,
  dom.electronLifetimeInput,
  dom.holeLifetimeInput,
];
const chartRegistry = new Map();
const chartResizeObserver = new ResizeObserver(scheduleChartRedraw);
const axisLimitInputs = [dom.xAxisMinInput, dom.xAxisMaxInput, dom.yAxisMinInput, dom.yAxisMaxInput];

let currentResult = null;
let currentSweep = null;
let selectedSweepIndex = -1;
let jvViewport = emptyJvViewport();
let jvPan = null;
let suppressJvClick = false;
let solving = false;
let chartResizeFrame = 0;
let cursorReadoutTimer = 0;

bindEvents();
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

  for (const input of configInputs) {
    input.addEventListener("input", () => {
      invalidateResults();
      updatePreflight();
    });
  }
  dom.solveButton.addEventListener("click", solveVoltageSweep);
  for (const control of [dom.jvQuantitySelect, dom.jvScaleSelect]) {
    control.addEventListener("change", () => {
      resetJvViewport(false);
      if (currentSweep?.converged) renderJv(currentSweep);
    });
  }
  dom.jvReferenceInput.addEventListener("change", () => {
    if (currentSweep?.converged) renderJv(currentSweep);
  });
  for (const input of axisLimitInputs) input.addEventListener("input", applyAxisLimits);
  dom.resetPlotViewButton.addEventListener("click", () => resetJvViewport(true));
  dom.profilePointInput.addEventListener("input", () => {
    selectSweepPoint(Number(dom.profilePointInput.value));
  });
  dom.exportProfileCsvButton.addEventListener("click", exportProfileCsv);
  dom.exportSweepCsvButton.addEventListener("click", exportSweepCsv);
  dom.exportPngButton.addEventListener("click", exportPng);

  for (const canvas of plotCanvases) {
    chartResizeObserver.observe(canvas);
    canvas.addEventListener("pointermove", updateCursorReadout);
    canvas.addEventListener("click", (event) => {
      if (canvas === dom.jvCanvas && suppressJvClick) {
        suppressJvClick = false;
        return;
      }
      updateCursorReadout(event);
      if (canvas === dom.jvCanvas) selectSweepPoint(chartIndexFromEvent(event, chartRegistry.get(canvas)));
      activateCursorReadout();
    });
    canvas.addEventListener("pointerleave", () => {
      if (dom.cursorReadout.dataset.active !== "true") resetCursorReadout();
    });
  }
  dom.jvCanvas.addEventListener("wheel", zoomJvPlot, { passive: false });
  dom.jvCanvas.addEventListener("pointerdown", startJvPan);
  dom.jvCanvas.addEventListener("pointermove", moveJvPan);
  dom.jvCanvas.addEventListener("pointerup", endJvPan);
  dom.jvCanvas.addEventListener("pointercancel", endJvPan);
  dom.jvCanvas.addEventListener("keydown", navigateJvPlot);
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

function readConfig() {
  return {
    ...DEFAULT_PN_CONFIG,
    acceptorCm3: Number(dom.acceptorInput.value),
    donorCm3: Number(dom.donorInput.value),
    biasV: 0,
    deviceAreaUm2: Number(dom.deviceAreaInput.value),
    lengthUm: Number(dom.lengthInput.value),
    cells: Number(dom.cellsInput.value),
    electronLifetimeS: Number(dom.electronLifetimeInput.value),
    holeLifetimeS: Number(dom.holeLifetimeInput.value),
  };
}

function readSweepDefinition() {
  return {
    minimumV: Number(dom.minimumBiasInput.value),
    maximumV: Number(dom.maximumBiasInput.value),
    pointCount: Number(dom.jvPointCountInput.value),
  };
}

function validateSweepDefinition() {
  const sweep = readSweepDefinition();
  const errors = [];
  if (!Number.isFinite(sweep.minimumV) || sweep.minimumV < -1 || sweep.minimumV > 0.8) {
    errors.push("V_D,min must be between −1 and 0.8 V.");
  }
  if (!Number.isFinite(sweep.maximumV) || sweep.maximumV < -1 || sweep.maximumV > 0.8) {
    errors.push("V_D,max must be between −1 and 0.8 V.");
  }
  if (Number.isFinite(sweep.minimumV) && Number.isFinite(sweep.maximumV) && sweep.minimumV >= sweep.maximumV) {
    errors.push("V_D,min must be smaller than V_D,max.");
  }
  if (!Number.isInteger(sweep.pointCount) || sweep.pointCount < 17 || sweep.pointCount > 201) {
    errors.push("Sweep points must be an integer between 17 and 201.");
  }
  return { ...sweep, errors };
}

function updatePreflight() {
  const validation = validatePnConfig(readConfig());
  const sweep = validateSweepDefinition();
  const { config, errors, warnings, derived } = validation;
  setScientificText(dom.biasBadge, `${formatFixed(sweep.minimumV, 2)} ≤ V_D ≤ ${formatFixed(sweep.maximumV, 2)} V`);
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

  const allErrors = errors.concat(sweep.errors);
  if (allErrors.length) {
    setMessage(dom.preflightSummary, allErrors.join(" "), "error");
    setMessage(dom.preflightDetails, allErrors.join(" "), "error");
    dom.solveButton.disabled = true;
  } else if (warnings.length) {
    const text = `Valid configuration with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}.`;
    setMessage(dom.preflightSummary, text, "warning");
    setMessage(dom.preflightDetails, `${text} ${warnings.join(" ")}`, "warning");
    dom.solveButton.disabled = solving;
  } else {
    setMessage(dom.preflightSummary, "Configuration ready. Calculate the I–V sweep.", "ready");
    setMessage(dom.preflightDetails, "Preflight passed: finite parameters, physical ranges, and adequate mesh.", "ready");
    dom.solveButton.disabled = solving;
  }
}

function invalidateResults() {
  currentResult = null;
  currentSweep = null;
  selectedSweepIndex = -1;
  resetJvViewport(false);
  dom.profilePointInput.disabled = true;
  dom.profileVoltageOutput.textContent = "—";
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
    ["V_D", "—"],
    ["I_D", "—"],
    ["J_D", "—"],
    ["Small-signal r_d", "—"],
  ]);
  renderMetricList(dom.validationMetrics, [
    ["Status", "Not solved"],
    ["Mean J", "—"],
    ["Scaled residuals (ψ / n / p)", "— / — / —"],
    ["Current uniformity", "—"],
    ["Carrier balance (n / p)", "— / —"],
    ["Barrier: simulated / expected", "— / — V"],
    ["Mesh", "—"],
  ]);
  replaceList(dom.warningList, []);
  dom.sweepMessage.textContent = "Calculate the I–V sweep first.";
  setMessage(dom.validationBanner, "PENDING — solve to evaluate residuals and conservation.", "idle");
}

function setPlotState(canvas, state, message = "") {
  const figure = canvas.closest("[data-plot-state]");
  if (!figure) return;
  figure.dataset.plotState = state;
  figure.dataset.plotMessage = message;
}

async function solveVoltageSweep() {
  if (solving) return;
  const validation = validatePnConfig(readConfig());
  const sweepDefinition = validateSweepDefinition();
  const errors = validation.errors.concat(sweepDefinition.errors);
  if (errors.length) {
    setMessage(dom.solverMessage, errors.join(" "), "error");
    return;
  }

  resetJvViewport(false);
  solving = true;
  dom.solveButton.disabled = true;
  for (const input of [dom.minimumBiasInput, dom.maximumBiasInput, dom.jvPointCountInput]) input.disabled = true;
  updateGlobalStatus("I–V sweep…", "solving");
  setPlotState(dom.jvCanvas, "loading", `Calculating ${sweepDefinition.pointCount} points…`);
  setMessage(dom.solverMessage, "Solving equilibrium and continuing toward both voltage limits…", "warning");
  setMessage(dom.sweepMessage, "Preparing equilibrium for the sweep…", "warning");
  await nextPaint();

  try {
    const baseConfig = validation.config;
    const voltages = createPnVoltageGrid(
      sweepDefinition.pointCount,
      sweepDefinition.minimumV,
      sweepDefinition.maximumV,
    );
    const results = new Map();
    const equilibrium = solvePnJunction1D(baseConfig);
    if (!equilibrium.diagnostics.converged) {
      throw new Error(equilibrium.diagnostics.failureReason || "Equilibrium did not converge.");
    }
    results.set(0, equilibrium);
    const branches = [
      voltages.filter((value) => value < 0).sort((a, b) => b - a),
      voltages.filter((value) => value > 0),
    ];
    let solved = voltages.includes(0) ? 1 : 0;
    for (const branch of branches) {
      let previous = equilibrium;
      for (const voltage of branch) {
        previous = solvePnJunction1D({ ...baseConfig, biasV: voltage }, previous);
        results.set(voltage, previous);
        solved += 1;
        setMessage(dom.sweepMessage, `Solving I–V: ${solved}/${sweepDefinition.pointCount} points…`, "warning");
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
        result: result ?? null,
      };
    });
    currentSweep = {
      config: baseConfig,
      points,
      converged: points.every((point) => point.converged),
      warnings: equilibrium.warnings,
    };
    if (!currentSweep.converged) throw new Error("The sweep stopped because at least one point did not converge.");

    selectedSweepIndex = nearestVoltageIndex(points, 0);
    dom.profilePointInput.min = "0";
    dom.profilePointInput.max = String(points.length - 1);
    dom.profilePointInput.disabled = false;
    selectSweepPoint(selectedSweepIndex);
    updateGlobalStatus("I–V converged", "converged");
    setMessage(
      dom.solverMessage,
      `${sweepDefinition.pointCount}-point sweep converged from ${formatFixed(sweepDefinition.minimumV, 3)} to ${formatFixed(sweepDefinition.maximumV, 3)} V.`,
      "ready",
    );
    setMessage(dom.sweepMessage, "Move the slider or click the curve to inspect any solved voltage.", "ready");
    revealMobileResults();
  } catch (error) {
    currentResult = null;
    currentSweep = null;
    selectedSweepIndex = -1;
    renderEmptyDashboard("Sweep failed");
    updateGlobalStatus("Sweep failed", "failed");
    setMessage(dom.solverMessage, error instanceof Error ? error.message : String(error), "error");
  } finally {
    solving = false;
    for (const input of [dom.minimumBiasInput, dom.maximumBiasInput, dom.jvPointCountInput]) input.disabled = false;
    updatePreflight();
    updateExportState();
  }
}

function revealMobileResults() {
  if (dockedPanelMedia.matches) return;
  requestAnimationFrame(() => {
    dom.resultsArea.scrollIntoView({ behavior: "auto", block: "start" });
    dom.jvSectionTitle.focus({ preventScroll: true });
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

function renderJv(sweep) {
  const voltage = Float64Array.from(sweep.points, (point) => point.voltageV);
  const areaM2 = sweep.config.deviceAreaUm2 * 1e-12;
  const densityMode = dom.jvQuantitySelect.value === "density";
  const scale = densityMode ? 1e-4 : areaM2 * 1e3;
  const values = Float64Array.from(sweep.points, (point) => point.currentDensityAm2 * scale);
  const reference = Float64Array.from(sweep.points, (point) =>
    point.shockleyCurrentDensityAm2 == null ? NaN : point.shockleyCurrentDensityAm2 * scale,
  );
  const logScale = dom.jvScaleSelect.value === "log";
  const transform = logScale ? logTransform() : linearTransform();
  const series = [
    { label: "DD + SRH", values: logScale ? Float64Array.from(values, Math.abs) : values, color: "#087e8b" },
  ];
  if (dom.jvReferenceInput.checked) {
    series.push({
      label: "Finite-base diode",
      values: logScale ? Float64Array.from(reference, Math.abs) : reference,
      color: "#ca7b00",
      dash: [7, 4],
    });
  }
  const geometry = drawLineChart(dom.jvCanvas, {
    x: voltage,
    xLabel: "V_D (V)",
    yLabel: densityMode
      ? (logScale ? "|J_D| (A/cm²)" : "J_D (A/cm²)")
      : (logScale ? "|I_D| (mA)" : "I_D (mA)"),
    includeZero: !logScale,
    transform,
    xDomain: hasFiniteViewportPair("x") ? [jvViewport.xMin, jvViewport.xMax] : undefined,
    yDomain: hasFiniteViewportPair("y")
      ? [transform.forward(jvViewport.yMin), transform.forward(jvViewport.yMax)]
      : undefined,
    xMarker: sweep.points[selectedSweepIndex]?.voltageV,
    series,
  });
  chartRegistry.set(dom.jvCanvas, { type: "sweep", x: voltage, geometry });
  setPlotState(dom.jvCanvas, "ready");
}

function emptyJvViewport() {
  return { xMin: null, xMax: null, yMin: null, yMax: null };
}

function hasFiniteViewportPair(axis) {
  const minimum = jvViewport[`${axis}Min`];
  const maximum = jvViewport[`${axis}Max`];
  return Number.isFinite(minimum) && Number.isFinite(maximum) && minimum < maximum;
}

function applyAxisLimits() {
  const x = readAxisPair(dom.xAxisMinInput, dom.xAxisMaxInput, "X");
  const y = readAxisPair(dom.yAxisMinInput, dom.yAxisMaxInput, "Y", dom.jvScaleSelect.value === "log");
  const error = x.error || y.error;
  for (const input of axisLimitInputs) input.setCustomValidity(error || "");
  if (error) {
    setAxisMessage(error, "error");
    return;
  }
  jvViewport = {
    xMin: x.values?.[0] ?? null,
    xMax: x.values?.[1] ?? null,
    yMin: y.values?.[0] ?? null,
    yMax: y.values?.[1] ?? null,
  };
  setAxisMessage(hasFiniteViewportPair("x") || hasFiniteViewportPair("y") ? "Manual limits" : "Automatic limits");
  if (currentSweep?.converged) renderJv(currentSweep);
}

function readAxisPair(minimumInput, maximumInput, axis, positive = false) {
  const minimumText = minimumInput.value.trim();
  const maximumText = maximumInput.value.trim();
  if (!minimumText && !maximumText) return { values: null };
  if (!minimumText || !maximumText) return { error: `${axis} requires both minimum and maximum.` };
  const minimum = Number(minimumText);
  const maximum = Number(maximumText);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum >= maximum) {
    return { error: `${axis} minimum must be smaller than its maximum.` };
  }
  if (positive && minimum <= 0) return { error: "Logarithmic Y limits must be positive." };
  return { values: [minimum, maximum] };
}

function resetJvViewport(redraw) {
  jvViewport = emptyJvViewport();
  for (const input of axisLimitInputs) {
    input.value = "";
    input.setCustomValidity("");
  }
  setAxisMessage("Automatic limits");
  if (redraw && currentSweep?.converged) renderJv(currentSweep);
}

function setAxisMessage(message, state = "ready") {
  dom.plotViewportMessage.textContent = message;
  dom.plotViewportMessage.dataset.state = state;
}

function setJvViewportFromScales(xMinimum, xMaximum, yMinimum, yMaximum, transform, message) {
  jvViewport = {
    xMin: xMinimum,
    xMax: xMaximum,
    yMin: transform.inverse(yMinimum),
    yMax: transform.inverse(yMaximum),
  };
  dom.xAxisMinInput.value = formatAxisInput(jvViewport.xMin);
  dom.xAxisMaxInput.value = formatAxisInput(jvViewport.xMax);
  dom.yAxisMinInput.value = formatAxisInput(jvViewport.yMin);
  dom.yAxisMaxInput.value = formatAxisInput(jvViewport.yMax);
  for (const input of axisLimitInputs) input.setCustomValidity("");
  setAxisMessage(message);
  renderJv(currentSweep);
}

function formatAxisInput(value) {
  return Number(value.toPrecision(7)).toString();
}

function nearestVoltageIndex(points, targetV) {
  let nearest = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (Math.abs(points[index].voltageV - targetV) < Math.abs(points[nearest].voltageV - targetV)) nearest = index;
  }
  return nearest;
}

function selectSweepPoint(index) {
  const point = currentSweep?.points[index];
  if (!point?.result?.diagnostics.converged) return;
  selectedSweepIndex = index;
  currentResult = point.result;
  dom.profilePointInput.value = String(index);
  setScientificText(dom.profileVoltageOutput, `V_D = ${formatFixed(point.voltageV, 3)} V`);
  renderResult(currentResult);
  renderValidation(currentResult);
  renderCircuitMetrics(currentResult, currentSweep);
  renderJv(currentSweep);
  updateExportState();
}

function renderCircuitMetrics(result, sweep) {
  const currentA = result.diagnostics.meanCurrentDensityAm2 * result.derived.deviceAreaM2;
  const biasV = result.config.biasV;
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
    ["V_D", `${formatFixed(biasV, 3)} V`],
    ["I_D", formatNearZero(currentA * 1e3, 1e-12, "mA")],
    ["J_D", formatNearZero(result.diagnostics.meanCurrentDensityAm2 / 1e4, 1e-15, "A/cm²")],
    ["Small-signal r_d", dynamicResistance],
  ]);
}

function renderValidation(result) {
  const potentialBarrierV = result.potentialV.at(-1) - result.potentialV[0];
  const expectedBarrierV = result.derived.builtInPotentialV - result.config.biasV;
  renderMetricList(dom.validationMetrics, [
    ["Status", result.diagnostics.converged ? "Converged" : "Not converged"],
    ["Mean J", `${formatScientific(result.diagnostics.meanCurrentDensityAm2 / 1e4)} A/cm²`],
    ["Scaled residuals (ψ / n / p)", [
      result.diagnostics.poissonResidual,
      result.diagnostics.electronResidual,
      result.diagnostics.holeResidual,
    ].map((value) => formatScientific(value)).join(" / ")],
    ["Current uniformity", `${formatPercent(result.diagnostics.currentContinuityError)}; ΔJ = ${formatScientific(result.diagnostics.currentContinuityAbsoluteErrorAm2 / 1e4)} A/cm²`],
    ["Carrier balance (n / p)", `${formatPercent(result.diagnostics.electronBalanceError)} / ${formatPercent(result.diagnostics.holeBalanceError)}`],
    ["Barrier: simulated / expected", `${formatFixed(potentialBarrierV, 4)} / ${formatFixed(expectedBarrierV, 4)} V`],
    ["Mesh", `${result.config.cells} nodes; Δx = ${formatScientific(result.derived.dxM * 1e9)} nm`],
  ]);
  setMessage(
    dom.validationBanner,
    result.diagnostics.converged
      ? "PASS — residual and conservation thresholds satisfied."
      : "FAIL — do not use this result as a physical solution.",
    result.diagnostics.converged ? "pass" : "error",
  );
  replaceList(dom.warningList, [...new Set(result.warnings)]);
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
  const xScale = createBoundedScale(xValues, 8, false, specification.xDomain);
  const yScale = createBoundedScale(yValues, 7, specification.includeZero, specification.yDomain);
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

  if (Number.isFinite(specification.xMarker)) {
    const markerX = mapX(specification.xMarker);
    context.save();
    context.beginPath();
    context.rect(pad.left, pad.top, plotWidth, plotHeight);
    context.clip();
    context.strokeStyle = "#b12f49";
    context.lineWidth = 1.5;
    context.setLineDash([4, 4]);
    drawLine(context, markerX, pad.top, markerX, pad.top + plotHeight);
    context.restore();
    context.setLineDash([]);
  }

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
  return { width, height, pad, plotWidth, plotHeight, xScale, yScale, transform };
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
  const index = chartIndexFromEvent(event, chart);
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

function chartIndexFromEvent(event, chart) {
  if (!chart?.x?.length) return -1;
  const rect = event.currentTarget.getBoundingClientRect();
  if (!chart.geometry) {
    return Math.round(clamp((event.clientX - rect.left) / rect.width, 0, 1) * (chart.x.length - 1));
  }
  const { width, pad, plotWidth, xScale } = chart.geometry;
  const logicalX = (event.clientX - rect.left) * width / rect.width;
  const fraction = clamp((logicalX - pad.left) / plotWidth, 0, 1);
  const target = xScale.min + fraction * (xScale.max - xScale.min);
  let nearest = 0;
  for (let index = 1; index < chart.x.length; index += 1) {
    if (Math.abs(chart.x[index] - target) < Math.abs(chart.x[nearest] - target)) nearest = index;
  }
  return nearest;
}

function zoomJvPlot(event) {
  const chart = chartRegistry.get(dom.jvCanvas);
  if (!currentSweep?.converged || !chart?.geometry) return;
  event.preventDefault();
  const geometry = chart.geometry;
  const point = chartPointFromEvent(event, geometry);
  const { xScale, yScale, transform } = geometry;

  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
    const xShift = event.deltaX / geometry.plotWidth * (xScale.max - xScale.min);
    setJvViewportFromScales(
      xScale.min + xShift,
      xScale.max + xShift,
      yScale.min,
      yScale.max,
      transform,
      "Trackpad pan",
    );
    return;
  }

  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? geometry.height : 1);
  const factor = Math.exp(clamp(delta * 0.0015, -0.8, 0.8));
  const xAnchor = xScale.min + point.xFraction * (xScale.max - xScale.min);
  const yAnchor = yScale.max - point.yFraction * (yScale.max - yScale.min);
  setJvViewportFromScales(
    xAnchor - (xAnchor - xScale.min) * factor,
    xAnchor + (xScale.max - xAnchor) * factor,
    yAnchor - (yAnchor - yScale.min) * factor,
    yAnchor + (yScale.max - yAnchor) * factor,
    transform,
    "Interactive zoom",
  );
}

function startJvPan(event) {
  const chart = chartRegistry.get(dom.jvCanvas);
  if (event.button !== 0 || !currentSweep?.converged || !chart?.geometry) return;
  const point = chartPointFromEvent(event, chart.geometry);
  if (!point.inside) return;
  const { xScale, yScale } = chart.geometry;
  jvPan = {
    pointerId: event.pointerId,
    startX: point.logicalX,
    startY: point.logicalY,
    xMin: xScale.min,
    xMax: xScale.max,
    yMin: yScale.min,
    yMax: yScale.max,
    geometry: chart.geometry,
    moved: false,
  };
  dom.jvCanvas.dataset.panning = "true";
  dom.jvCanvas.setPointerCapture(event.pointerId);
}

function moveJvPan(event) {
  if (!jvPan || event.pointerId !== jvPan.pointerId) return;
  const point = chartPointFromEvent(event, jvPan.geometry);
  const deltaX = point.logicalX - jvPan.startX;
  const deltaY = point.logicalY - jvPan.startY;
  if (!jvPan.moved && Math.hypot(deltaX, deltaY) < 4) return;
  jvPan.moved = true;
  const xShift = deltaX / jvPan.geometry.plotWidth * (jvPan.xMax - jvPan.xMin);
  const yShift = deltaY / jvPan.geometry.plotHeight * (jvPan.yMax - jvPan.yMin);
  setJvViewportFromScales(
    jvPan.xMin - xShift,
    jvPan.xMax - xShift,
    jvPan.yMin + yShift,
    jvPan.yMax + yShift,
    jvPan.geometry.transform,
    "Interactive pan",
  );
}

function endJvPan(event) {
  if (!jvPan || event.pointerId !== jvPan.pointerId) return;
  suppressJvClick = jvPan.moved;
  jvPan = null;
  delete dom.jvCanvas.dataset.panning;
  if (dom.jvCanvas.hasPointerCapture(event.pointerId)) dom.jvCanvas.releasePointerCapture(event.pointerId);
}

function navigateJvPlot(event) {
  const chart = chartRegistry.get(dom.jvCanvas);
  if (!currentSweep?.converged || !chart?.geometry) return;
  if (event.key === "Home") {
    event.preventDefault();
    resetJvViewport(true);
    return;
  }
  const { xScale, yScale, transform } = chart.geometry;
  const xSpan = xScale.max - xScale.min;
  const ySpan = yScale.max - yScale.min;
  let xMinimum = xScale.min;
  let xMaximum = xScale.max;
  let yMinimum = yScale.min;
  let yMaximum = yScale.max;
  if (event.key === "+" || event.key === "=") {
    [xMinimum, xMaximum] = centeredDomain(xScale.min, xScale.max, 0.8);
    [yMinimum, yMaximum] = centeredDomain(yScale.min, yScale.max, 0.8);
  } else if (event.key === "-") {
    [xMinimum, xMaximum] = centeredDomain(xScale.min, xScale.max, 1.25);
    [yMinimum, yMaximum] = centeredDomain(yScale.min, yScale.max, 1.25);
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    const shift = xSpan * (event.key === "ArrowLeft" ? -0.1 : 0.1);
    xMinimum += shift;
    xMaximum += shift;
  } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    const shift = ySpan * (event.key === "ArrowUp" ? 0.1 : -0.1);
    yMinimum += shift;
    yMaximum += shift;
  } else {
    return;
  }
  event.preventDefault();
  setJvViewportFromScales(xMinimum, xMaximum, yMinimum, yMaximum, transform, "Keyboard view");
}

function chartPointFromEvent(event, geometry) {
  const rect = event.currentTarget.getBoundingClientRect();
  const logicalX = (event.clientX - rect.left) * geometry.width / rect.width;
  const logicalY = (event.clientY - rect.top) * geometry.height / rect.height;
  return {
    logicalX,
    logicalY,
    xFraction: clamp((logicalX - geometry.pad.left) / geometry.plotWidth, 0, 1),
    yFraction: clamp((logicalY - geometry.pad.top) / geometry.plotHeight, 0, 1),
    inside: logicalX >= geometry.pad.left && logicalX <= geometry.pad.left + geometry.plotWidth &&
      logicalY >= geometry.pad.top && logicalY <= geometry.pad.top + geometry.plotHeight,
  };
}

function centeredDomain(minimum, maximum, factor) {
  const center = (minimum + maximum) / 2;
  const halfSpan = (maximum - minimum) * factor / 2;
  return [center - halfSpan, center + halfSpan];
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
