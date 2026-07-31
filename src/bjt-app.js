import {
  DEFAULT_NPN_CONFIG,
  idealNpnTransportCurrentA,
  serializeNpnProfileCsv,
  serializeNpnSweepCsv,
  validateNpnConfig,
} from "./bjt-core.js";
import {
  createNiceScale,
  drawScientificText,
  formatChartTick,
  measureScientificText,
  setScientificText,
} from "./plot-utils.js";

const ids = [
  "bjtGlobalStatus", "openBjtPanelButton", "bjtPanelButtonIcon", "bjtControls", "bjtForm",
  "bjtVbeMinInput", "bjtVbeMaxInput", "bjtBasePointCountInput", "bjtVceMaxInput", "bjtCollectorPointCountInput",
  "bjtEmitterDopingInput", "bjtBaseDopingInput", "bjtCollectorDopingInput", "bjtLengthInput", "bjtHeightInput",
  "bjtEmitterWidthInput", "bjtBaseWidthInput", "bjtDepthInput", "bjtNxInput", "bjtNyInput",
  "bjtElectronLifetimeInput", "bjtHoleLifetimeInput", "bjtPreflight", "bjtDerivedMetrics",
  "bjtSolveButton", "bjtSolverMessage", "bjtBiasBadge", "bjtResultsTitle", "bjtOutputFigure", "bjtOutputCanvas",
  "bjtTransferFigure", "bjtTransferCanvas", "bjtCurveSelect", "bjtPointInput", "bjtPointOutput", "bjtReferenceInput",
  "bjtCircuitMetrics", "bjtMapsView", "bjtPotentialCanvas", "bjtElectronCanvas", "bjtCurrentCanvas", "bjtRecombinationCanvas",
  "bjtValidationView", "bjtValidationBanner", "bjtValidationMetrics", "bjtWarningList",
  "bjtExportProfileButton", "bjtExportSweepButton", "bjtExportPngButton",
];
const dom = Object.fromEntries(ids.map((id) => [id, requireElement(id)]));
const mapCanvases = [dom.bjtPotentialCanvas, dom.bjtElectronCanvas, dom.bjtCurrentCanvas, dom.bjtRecombinationCanvas];
const worker = new Worker("src/bjt-worker.js", { type: "module" });
const compactControlsMedia = window.matchMedia("(max-width: 980px)");

let currentFamily = null;
let currentResult = null;
let selectedCurveIndex = -1;
let selectedPointIndex = -1;
let outputGeometry = null;
let transferGeometry = null;
let busy = false;
let dirty = true;

bindEvents();
syncControlsDisclosure();
updatePreflight();
renderEmptyDashboard();

function requireElement(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element;
}

function bindEvents() {
  dom.openBjtPanelButton.addEventListener("click", () => {
    dom.bjtControls.open = !dom.bjtControls.open;
    if (dom.bjtControls.open) {
      requestAnimationFrame(() => dom.bjtControls.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  });
  dom.bjtControls.addEventListener("toggle", syncBjtPanelButton);
  compactControlsMedia.addEventListener("change", syncControlsDisclosure);
  dom.bjtForm.addEventListener("submit", solveCharacteristicGrid);
  for (const input of dom.bjtForm.querySelectorAll("input")) {
    input.addEventListener("input", () => {
      invalidateBjtResults();
      updatePreflight();
    });
  }
  dom.bjtCurveSelect.addEventListener("change", () => selectFamilyPoint(Number(dom.bjtCurveSelect.value), selectedPointIndex));
  dom.bjtPointInput.addEventListener("input", () => selectFamilyPoint(selectedCurveIndex, Number(dom.bjtPointInput.value)));
  dom.bjtReferenceInput.addEventListener("change", redrawCharacteristics);
  dom.bjtOutputCanvas.addEventListener("click", (event) => selectNearestOutputPoint(event));
  dom.bjtTransferCanvas.addEventListener("click", (event) => selectNearestTransferCurve(event));
  dom.bjtMapsView.addEventListener("toggle", () => {
    if (dom.bjtMapsView.open && currentResult) drawMaps(currentResult);
  });
  dom.bjtExportProfileButton.addEventListener("click", exportProfile);
  dom.bjtExportSweepButton.addEventListener("click", exportSweep);
  dom.bjtExportPngButton.addEventListener("click", exportOutputPng);
  window.addEventListener("resize", debounce(() => {
    redrawCharacteristics();
    if (dom.bjtMapsView.open && currentResult) drawMaps(currentResult);
  }, 120));
}

worker.addEventListener("message", ({ data }) => {
  if (data.action === "failed") {
    busy = false;
    setControlsEnabled(true);
    setStatus("Solver failed", "failed");
    setMessage(dom.bjtSolverMessage, data.message, "error");
    setPlotState(dom.bjtOutputFigure, "error", "Characteristic grid failed");
    setPlotState(dom.bjtTransferFigure, "error", "Characteristic grid failed");
    return;
  }
  if (data.action === "swept") receiveFamily(data.result);
  if (data.action === "selected") receiveSelectedPoint(data);
});

function syncControlsDisclosure() {
  dom.bjtControls.open = !compactControlsMedia.matches;
  syncBjtPanelButton();
}

function syncBjtPanelButton() {
  dom.openBjtPanelButton.setAttribute("aria-expanded", String(dom.bjtControls.open));
  dom.openBjtPanelButton.setAttribute("aria-label", `${dom.bjtControls.open ? "Close" : "Open"} device controls`);
  dom.bjtPanelButtonIcon.textContent = dom.bjtControls.open ? "×" : "☰";
}

function readConfig() {
  return {
    ...DEFAULT_NPN_CONFIG,
    baseEmitterVoltageV: Number(dom.bjtVbeMaxInput.value),
    collectorEmitterVoltageV: Number(dom.bjtVceMaxInput.value),
    emitterDopingCm3: Number(dom.bjtEmitterDopingInput.value),
    baseDopingCm3: Number(dom.bjtBaseDopingInput.value),
    collectorDopingCm3: Number(dom.bjtCollectorDopingInput.value),
    lengthUm: Number(dom.bjtLengthInput.value),
    heightUm: Number(dom.bjtHeightInput.value),
    emitterWidthUm: Number(dom.bjtEmitterWidthInput.value),
    baseWidthUm: Number(dom.bjtBaseWidthInput.value),
    deviceDepthUm: Number(dom.bjtDepthInput.value),
    nx: Number(dom.bjtNxInput.value),
    ny: Number(dom.bjtNyInput.value),
    electronLifetimeS: Number(dom.bjtElectronLifetimeInput.value),
    holeLifetimeS: Number(dom.bjtHoleLifetimeInput.value),
  };
}

function readSweepDefinition() {
  return {
    minimumVbeV: Number(dom.bjtVbeMinInput.value),
    maximumVbeV: Number(dom.bjtVbeMaxInput.value),
    basePointCount: Number(dom.bjtBasePointCountInput.value),
    maximumVceV: Number(dom.bjtVceMaxInput.value),
    collectorPointCount: Number(dom.bjtCollectorPointCountInput.value),
  };
}

function validateSweepDefinition() {
  const sweep = readSweepDefinition();
  const errors = [];
  if (!Number.isFinite(sweep.minimumVbeV) || sweep.minimumVbeV < -0.2 || sweep.minimumVbeV > 0.75) {
    errors.push("V_BE,min must be between −0.2 and 0.75 V.");
  }
  if (!Number.isFinite(sweep.maximumVbeV) || sweep.maximumVbeV < -0.2 || sweep.maximumVbeV > 0.75) {
    errors.push("V_BE,max must be between −0.2 and 0.75 V.");
  }
  if (Number.isFinite(sweep.minimumVbeV) && Number.isFinite(sweep.maximumVbeV) && sweep.minimumVbeV >= sweep.maximumVbeV) {
    errors.push("V_BE,min must be smaller than V_BE,max.");
  }
  if (!Number.isInteger(sweep.basePointCount) || sweep.basePointCount < 3 || sweep.basePointCount > 9) {
    errors.push("V_BE curves must be an integer between 3 and 9.");
  }
  if (!Number.isFinite(sweep.maximumVceV) || sweep.maximumVceV < 0.1 || sweep.maximumVceV > 5) {
    errors.push("V_CE,max must be between 0.1 and 5 V.");
  }
  if (!Number.isInteger(sweep.collectorPointCount) || sweep.collectorPointCount < 5 || sweep.collectorPointCount > 21) {
    errors.push("V_CE points must be an integer between 5 and 21.");
  }
  return { ...sweep, errors };
}

function updatePreflight() {
  const validation = validateNpnConfig(readConfig());
  const sweep = validateSweepDefinition();
  const errors = validation.errors.concat(sweep.errors);
  setScientificText(
    dom.bjtBiasBadge,
    `${formatFixed(sweep.minimumVbeV, 2)} ≤ V_BE ≤ ${formatFixed(sweep.maximumVbeV, 2)} V · 0 ≤ V_CE ≤ ${formatFixed(sweep.maximumVceV, 2)} V`,
  );
  if (errors.length) setMessage(dom.bjtPreflight, errors.join(" "), "error");
  else if (validation.warnings.length) setMessage(dom.bjtPreflight, validation.warnings.join(" "), "warning");
  else setMessage(dom.bjtPreflight, "Preflight passed: geometry, contacts, model ranges, and mesh scales are consistent.", "ready");
  renderMetricList(dom.bjtDerivedMetrics, validation.derived ? [
    ["Δx / Δy", `${formatScientific(validation.derived.dxM * 1e9)} / ${formatScientific(validation.derived.dyM * 1e9)} nm`],
    ["Emitter-base V_bi", `${formatFixed(validation.derived.emitterBaseBuiltInV, 3)} V`],
    ["Base-collector V_bi", `${formatFixed(validation.derived.baseCollectorBuiltInV, 3)} V`],
    ["Bias points", formatFixed(sweep.basePointCount * sweep.collectorPointCount, 0)],
  ] : []);
  dom.bjtSolveButton.disabled = busy || errors.length > 0;
  if (dirty) setStatus("Not solved", "idle");
}

function solveCharacteristicGrid(event) {
  event.preventDefault();
  if (busy) return;
  const validation = validateNpnConfig(readConfig());
  const sweep = validateSweepDefinition();
  if (validation.errors.length || sweep.errors.length) return;
  busy = true;
  dirty = true;
  currentFamily = null;
  currentResult = null;
  setControlsEnabled(false);
  setStatus("Calculating characteristics…", "solving");
  setMessage(
    dom.bjtSolverMessage,
    `Solving ${sweep.basePointCount} × ${sweep.collectorPointCount} coupled bias points with continuation…`,
    "warning",
  );
  setPlotState(dom.bjtOutputFigure, "loading", "Calculating output family");
  setPlotState(dom.bjtTransferFigure, "loading", "Calculating transfer characteristic");
  worker.postMessage({
    action: "sweep",
    config: validation.config,
    baseVoltages: linearGrid(sweep.minimumVbeV, sweep.maximumVbeV, sweep.basePointCount),
    collectorVoltages: linearGrid(0, sweep.maximumVceV, sweep.collectorPointCount),
  });
}

function receiveFamily(family) {
  busy = false;
  setControlsEnabled(true);
  currentFamily = family;
  if (!family.converged) {
    dirty = true;
    setStatus("Sweep failed", "failed");
    setMessage(dom.bjtSolverMessage, "The characteristic grid contains an unconverged point.", "error");
    setPlotState(dom.bjtOutputFigure, "error", "Characteristic grid did not converge");
    setPlotState(dom.bjtTransferFigure, "error", "Characteristic grid did not converge");
    updateExportState();
    return;
  }
  dirty = false;
  selectedCurveIndex = family.curves.length - 1;
  selectedPointIndex = family.curves[0].points.length - 1;
  populatePointControls();
  setPlotState(dom.bjtOutputFigure, "ready");
  setPlotState(dom.bjtTransferFigure, "ready");
  redrawCharacteristics();
  setStatus("Characteristics converged", "converged");
  setMessage(
    dom.bjtSolverMessage,
    `${family.curves.length * family.curves[0].points.length} bias points converged with ${family.backend} (${formatFixed(family.elapsedMs ?? 0, 1)} ms kernel time).`,
    "ready",
  );
  selectFamilyPoint(selectedCurveIndex, selectedPointIndex);
  revealMobileResults();
}

function populatePointControls() {
  dom.bjtCurveSelect.replaceChildren(...currentFamily.curves.map((curve, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${formatFixed(curve.baseEmitterVoltageV, 3)} V`;
    return option;
  }));
  dom.bjtCurveSelect.value = String(selectedCurveIndex);
  dom.bjtCurveSelect.disabled = false;
  dom.bjtPointInput.min = "0";
  dom.bjtPointInput.max = String(currentFamily.curves[0].points.length - 1);
  dom.bjtPointInput.value = String(selectedPointIndex);
  dom.bjtPointInput.disabled = false;
  updateSelectedPointLabel();
}

function selectFamilyPoint(curveIndex, pointIndex) {
  if (!currentFamily?.converged) return;
  const curve = currentFamily.curves[curveIndex];
  const point = curve?.points[pointIndex];
  if (!point?.converged) return;
  selectedCurveIndex = curveIndex;
  selectedPointIndex = pointIndex;
  currentResult = null;
  dom.bjtCurveSelect.value = String(curveIndex);
  dom.bjtPointInput.value = String(pointIndex);
  updateSelectedPointLabel();
  redrawCharacteristics();
  setMessage(dom.bjtValidationBanner, "Loading diagnostics for the selected converged point…", "warning");
  for (const canvas of mapCanvases) setPlotState(canvas.closest("figure"), "loading", "Loading selected point");
  updateExportState();
  worker.postMessage({ action: "select", curveIndex, pointIndex });
}

function receiveSelectedPoint(data) {
  if (data.curveIndex !== selectedCurveIndex || data.pointIndex !== selectedPointIndex) return;
  currentResult = data.result;
  renderSelectedPoint(currentResult);
  updateExportState();
}

function updateSelectedPointLabel() {
  const curve = currentFamily?.curves[selectedCurveIndex];
  const point = curve?.points[selectedPointIndex];
  setScientificText(dom.bjtPointOutput, point ? `V_CE = ${formatFixed(point.collectorEmitterVoltageV, 3)} V` : "—");
}

function renderSelectedPoint(result) {
  const emitterInto = result.terminalCurrents.emitter.currentIntoDeviceA;
  const baseInto = result.terminalCurrents.base.currentIntoDeviceA;
  const collectorInto = result.terminalCurrents.collector.currentIntoDeviceA;
  const beta = baseInto > 0 ? collectorInto / baseInto : NaN;
  const region = classifyOperatingRegion(result.config.baseEmitterVoltageV, result.config.collectorEmitterVoltageV);
  renderMetricList(dom.bjtCircuitMetrics, [
    ["Region", region],
    ["V_BE / V_CE", `${formatFixed(result.config.baseEmitterVoltageV, 3)} / ${formatFixed(result.config.collectorEmitterVoltageV, 3)} V`],
    ["I_C", `${formatScientific(collectorInto * 1e3)} mA`],
    ["I_B", `${formatScientific(baseInto * 1e6)} µA`],
    ["I_E", `${formatScientific(-emitterInto * 1e3)} mA`],
    ["β = I_C/I_B", Number.isFinite(beta) ? formatFixed(beta, 2) : "—"],
  ]);
  renderMetricList(dom.bjtValidationMetrics, [
    ["Compute backend", result.diagnostics.backend],
    ["Kernel time", `${formatFixed(result.diagnostics.elapsedMs ?? 0, 1)} ms`],
    ["Gummel iterations", formatFixed(result.diagnostics.totalIterations, 0)],
    ["Poisson residual", formatScientific(result.diagnostics.poissonResidual)],
    ["Electron residual", formatScientific(result.diagnostics.electronResidual)],
    ["Hole residual", formatScientific(result.diagnostics.holeResidual)],
    ["Terminal KCL error", formatPercent(result.diagnostics.terminalKclError)],
    ["Electron SRH balance", formatPercent(result.diagnostics.electronBalanceError)],
    ["Hole SRH balance", formatPercent(result.diagnostics.holeBalanceError)],
    ["Mesh", `${result.nx} × ${result.ny} nodes`],
  ]);
  setMessage(
    dom.bjtValidationBanner,
    "PASS: the selected grid point satisfies all three residuals, terminal KCL, carrier balance, positivity, and contact constraints.",
    "pass",
  );
  replaceList(dom.bjtWarningList, result.warnings.length ? result.warnings : ["No additional warning at the selected grid point."]);
  if (dom.bjtMapsView.open) drawMaps(result);
  else for (const canvas of mapCanvases) setPlotState(canvas.closest("figure"), "ready");
}

function redrawCharacteristics() {
  if (!currentFamily?.converged) return;
  drawOutputFamily(currentFamily);
  drawTransferCharacteristic(currentFamily);
}

function drawOutputFamily(family) {
  const colors = ["#6f4ca5", "#4d72b8", "#087e8b", "#2d936c", "#ca7b00", "#c4483f", "#9a4268", "#52676e", "#846d35"];
  const x = Float64Array.from(family.curves[0].points, (point) => point.collectorEmitterVoltageV);
  const series = [];
  family.curves.forEach((curve, index) => {
    const color = colors[index % colors.length];
    series.push({
      label: `V_BE = ${formatFixed(curve.baseEmitterVoltageV, 3)} V`,
      color,
      lineWidth: index === selectedCurveIndex ? 3.2 : 2.1,
      values: Float64Array.from(curve.points, (point) => point.collectorCurrentA * 1e3),
    });
    if (dom.bjtReferenceInput.checked) {
      series.push({
        label: "Ideal 1D",
        color,
        dash: [7, 4],
        lineWidth: 1.7,
        showInLegend: false,
        values: Float64Array.from(curve.points, (point) =>
          idealNpnTransportCurrentA(family.config, curve.baseEmitterVoltageV, point.collectorEmitterVoltageV) * 1e3),
      });
    }
  });
  outputGeometry = drawLineChart(dom.bjtOutputCanvas, {
    x,
    xLabel: "V_CE (V)",
    yLabel: "I_C (mA)",
    includeZero: true,
    includeXZero: true,
    xMarker: family.curves[selectedCurveIndex]?.points[selectedPointIndex]?.collectorEmitterVoltageV,
    series,
  });
}

function drawTransferCharacteristic(family) {
  const x = Float64Array.from(family.curves, (curve) => curve.baseEmitterVoltageV);
  const numerical = Float64Array.from(family.curves, (curve) => curve.points[selectedPointIndex].collectorCurrentA * 1e3);
  const selectedVce = family.curves[0].points[selectedPointIndex].collectorEmitterVoltageV;
  const series = [{ label: "2D DD", color: "#087e8b", lineWidth: 2.5, values: numerical }];
  if (dom.bjtReferenceInput.checked) {
    series.push({
      label: "Ideal 1D",
      color: "#ca7b00",
      dash: [6, 4],
      lineWidth: 1.7,
      values: Float64Array.from(family.curves, (curve) =>
        idealNpnTransportCurrentA(family.config, curve.baseEmitterVoltageV, selectedVce) * 1e3),
    });
  }
  transferGeometry = drawLineChart(dom.bjtTransferCanvas, {
    x,
    xLabel: "V_BE (V)",
    yLabel: "I_C (mA)",
    includeZero: true,
    xMarker: family.curves[selectedCurveIndex]?.baseEmitterVoltageV,
    series,
  });
}

function selectNearestOutputPoint(event) {
  if (!outputGeometry || !currentFamily) return;
  const target = chartValueFromEvent(event, outputGeometry);
  const points = currentFamily.curves[selectedCurveIndex].points;
  selectFamilyPoint(selectedCurveIndex, nearestIndex(points, target, (point) => point.collectorEmitterVoltageV));
}

function selectNearestTransferCurve(event) {
  if (!transferGeometry || !currentFamily) return;
  const target = chartValueFromEvent(event, transferGeometry);
  selectFamilyPoint(nearestIndex(currentFamily.curves, target, (curve) => curve.baseEmitterVoltageV), selectedPointIndex);
}

function chartValueFromEvent(event, geometry) {
  const rect = event.currentTarget.getBoundingClientRect();
  const logicalX = (event.clientX - rect.left) * geometry.width / rect.width;
  const fraction = clamp((logicalX - geometry.pad.left) / geometry.plotWidth, 0, 1);
  return geometry.xScale.min + fraction * (geometry.xScale.max - geometry.xScale.min);
}

function nearestIndex(values, target, accessor) {
  let nearest = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (Math.abs(accessor(values[index]) - target) < Math.abs(accessor(values[nearest]) - target)) nearest = index;
  }
  return nearest;
}

function drawMaps(result) {
  const extent = { lengthUm: result.derived.lengthM * 1e6, heightUm: result.derived.heightM * 1e6 };
  drawHeatmap(dom.bjtPotentialCanvas, result.potentialV, result.nx, result.ny, { label: "ψ (V)", diverging: false, ...extent });
  drawHeatmap(
    dom.bjtElectronCanvas,
    Float64Array.from(result.electronM3, (value) => Math.log10(value / 1e6)),
    result.nx,
    result.ny,
    { label: "log₁₀ n (cm⁻³)", diverging: false, ...extent },
  );
  drawHeatmap(
    dom.bjtCurrentCanvas,
    Float64Array.from(result.totalCurrentDensityXAm2, (value, index) => Math.log10(Math.max(
      1e-30,
      Math.hypot(value, result.totalCurrentDensityYAm2[index]),
    ))),
    result.nx,
    result.ny,
    { label: "log₁₀ |J| (A/m²)", diverging: false, ...extent },
  );
  const recombinationScale = maxAbs(result.recombinationM3s);
  drawHeatmap(
    dom.bjtRecombinationCanvas,
    Float64Array.from(result.recombinationM3s, (value) =>
      Math.sign(value) * Math.log10(1 + Math.abs(value) / Math.max(1, recombinationScale * 1e-6))),
    result.nx,
    result.ny,
    { label: "sgn(R) log₁₀(1+|R|/R₀)", diverging: true, ...extent },
  );
  for (const canvas of mapCanvases) setPlotState(canvas.closest("figure"), "ready");
}

function drawHeatmap(canvas, values, nx, ny, options) {
  const { context, width, height } = prepareCanvas(canvas);
  const pad = width < 520 ? { left: 54, right: 12, top: 32, bottom: 48 } : { left: 66, right: 18, top: 34, bottom: 52 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  if (options.diverging) {
    const extent = Math.max(Math.abs(minimum), Math.abs(maximum), Number.MIN_VALUE);
    minimum = -extent;
    maximum = extent;
  }
  if (!(maximum > minimum)) maximum = minimum + 1;
  const imageCanvas = document.createElement("canvas");
  imageCanvas.width = nx;
  imageCanvas.height = ny;
  const imageContext = imageCanvas.getContext("2d");
  const image = imageContext.createImageData(nx, ny);
  for (let index = 0; index < values.length; index += 1) {
    const fraction = clamp((values[index] - minimum) / (maximum - minimum), 0, 1);
    const color = options.diverging ? divergingColor(fraction) : sequentialColor(fraction);
    image.data[index * 4] = color[0];
    image.data[index * 4 + 1] = color[1];
    image.data[index * 4 + 2] = color[2];
    image.data[index * 4 + 3] = 255;
  }
  imageContext.putImageData(image, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = false;
  context.drawImage(imageCanvas, pad.left, pad.top, plotWidth, plotHeight);
  context.font = "600 10px Inter, system-ui, sans-serif";
  context.fillStyle = "#52676e";
  const xStep = options.lengthUm / 4;
  const yStep = options.heightUm / 4;
  for (let tick = 0; tick <= 4; tick += 1) {
    const xPosition = pad.left + tick * plotWidth / 4;
    const yPosition = pad.top + tick * plotHeight / 4;
    context.strokeStyle = "rgb(255 255 255 / 0.35)";
    drawLine(context, xPosition, pad.top, xPosition, pad.top + plotHeight);
    drawLine(context, pad.left, yPosition, pad.left + plotWidth, yPosition);
    context.fillStyle = "#52676e";
    context.textAlign = "center";
    context.fillText(formatChartTick(tick * xStep, xStep), xPosition, pad.top + plotHeight + 17);
    context.textAlign = "right";
    context.fillText(formatChartTick(tick * yStep, yStep), pad.left - 8, yPosition + 3);
  }
  context.strokeStyle = "#334a51";
  context.strokeRect(pad.left, pad.top, plotWidth, plotHeight);
  context.fillStyle = "#40555c";
  context.font = "700 11px Inter, system-ui, sans-serif";
  context.textAlign = "center";
  context.fillText("x (µm)", pad.left + plotWidth / 2, height - 8);
  context.save();
  context.translate(15, pad.top + plotHeight / 2);
  context.rotate(-Math.PI / 2);
  context.fillText("y (µm)", 0, 0);
  context.restore();
  context.textAlign = "left";
  context.fillText(`${options.label}: ${formatScientific(minimum)} to ${formatScientific(maximum)}`, pad.left, 16);
}

function drawLineChart(canvas, specification) {
  const { context, width, height } = prepareCanvas(canvas);
  const compact = width < 520;
  const pad = compact ? { left: 55, right: 10, top: 48, bottom: 46 } : { left: 78, right: 18, top: 58, bottom: 58 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const xValues = [...specification.x].filter(Number.isFinite);
  const yValues = specification.series.flatMap((series) => [...series.values].filter(Number.isFinite));
  const xScale = createNiceScale(xValues, compact ? 5 : 7, specification.includeXZero === true);
  const yScale = createNiceScale(yValues, compact ? 5 : 7, specification.includeZero);
  const mapX = (value) => pad.left + (value - xScale.min) / (xScale.max - xScale.min) * plotWidth;
  const mapY = (value) => pad.top + plotHeight - (value - yScale.min) / (yScale.max - yScale.min) * plotHeight;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.font = "600 10px Inter, system-ui, sans-serif";
  context.fillStyle = "#52676e";
  for (const tick of xScale.ticks) {
    const position = mapX(tick);
    context.strokeStyle = tick === 0 ? "#b8c7cb" : "#e8eef0";
    drawLine(context, position, pad.top, position, pad.top + plotHeight);
    context.textAlign = "center";
    context.fillText(formatChartTick(tick, xScale.step), position, pad.top + plotHeight + 17);
  }
  for (const tick of yScale.ticks) {
    const position = mapY(tick);
    context.strokeStyle = tick === 0 ? "#b8c7cb" : "#e8eef0";
    drawLine(context, pad.left, position, pad.left + plotWidth, position);
    context.textAlign = "right";
    context.fillText(formatChartTick(tick, yScale.step), pad.left - 8, position + 4);
  }
  context.save();
  context.beginPath();
  context.rect(pad.left, pad.top, plotWidth, plotHeight);
  context.clip();
  for (const series of specification.series) {
    context.strokeStyle = series.color;
    context.lineWidth = series.lineWidth ?? 2.4;
    context.setLineDash(series.dash ?? []);
    context.beginPath();
    let drawing = false;
    for (let index = 0; index < specification.x.length; index += 1) {
      const xValue = specification.x[index];
      const yValue = series.values[index];
      if (!Number.isFinite(xValue) || !Number.isFinite(yValue)) {
        drawing = false;
        continue;
      }
      const xPosition = mapX(xValue);
      const yPosition = mapY(yValue);
      if (!drawing) context.moveTo(xPosition, yPosition);
      else context.lineTo(xPosition, yPosition);
      drawing = true;
    }
    context.stroke();
  }
  if (Number.isFinite(specification.xMarker)) {
    context.strokeStyle = "#b12f49";
    context.lineWidth = 1.4;
    context.setLineDash([4, 4]);
    drawLine(context, mapX(specification.xMarker), pad.top, mapX(specification.xMarker), pad.top + plotHeight);
  }
  context.restore();
  context.setLineDash([]);
  context.fillStyle = "#20343b";
  context.font = `700 ${compact ? 10 : 12}px Inter, system-ui, sans-serif`;
  context.textAlign = "center";
  drawScientificText(context, specification.xLabel, pad.left + plotWidth / 2, height - 8);
  context.save();
  context.translate(compact ? 14 : 17, pad.top + plotHeight / 2);
  context.rotate(-Math.PI / 2);
  drawScientificText(context, specification.yLabel, 0, 0);
  context.restore();
  let legendX = pad.left;
  let legendY = compact ? 17 : 22;
  context.font = `700 ${compact ? 9 : 11}px Inter, system-ui, sans-serif`;
  context.textAlign = "left";
  for (const series of specification.series.filter((item) => item.showInLegend !== false)) {
    const required = 30 + measureScientificText(context, series.label);
    if (legendX + required > width - 8) {
      legendX = pad.left;
      legendY += compact ? 14 : 18;
    }
    context.strokeStyle = series.color;
    context.lineWidth = series.lineWidth ?? 2.5;
    context.setLineDash(series.dash ?? []);
    drawLine(context, legendX, legendY, legendX + 18, legendY);
    context.setLineDash([]);
    context.fillStyle = "#40555c";
    drawScientificText(context, series.label, legendX + 23, legendY + 4);
    legendX += required + 9;
  }
  return { width, pad, plotWidth, xScale };
}

function renderEmptyDashboard() {
  clearCanvas(dom.bjtOutputCanvas);
  clearCanvas(dom.bjtTransferCanvas);
  setPlotState(dom.bjtOutputFigure, "empty", "Awaiting a converged characteristic grid");
  setPlotState(dom.bjtTransferFigure, "empty", "Awaiting sweep");
  for (const canvas of mapCanvases) {
    clearCanvas(canvas);
    setPlotState(canvas.closest("figure"), "empty", "Select a converged point");
  }
  renderMetricList(dom.bjtCircuitMetrics, [
    ["Region", "—"], ["V_BE / V_CE", "—"], ["I_C", "—"], ["I_B", "—"], ["I_E", "—"], ["β", "—"],
  ]);
  renderMetricList(dom.bjtValidationMetrics, []);
  replaceList(dom.bjtWarningList, []);
  setMessage(dom.bjtValidationBanner, "PENDING — calculate the characteristic grid.", "idle");
  dom.bjtCurveSelect.replaceChildren();
  dom.bjtCurveSelect.disabled = true;
  dom.bjtPointInput.disabled = true;
  dom.bjtPointOutput.textContent = "—";
  updateExportState();
}

function invalidateBjtResults() {
  dirty = true;
  currentFamily = null;
  currentResult = null;
  selectedCurveIndex = -1;
  selectedPointIndex = -1;
  renderEmptyDashboard();
}

function setPlotState(figure, state, message = "") {
  figure.dataset.plotState = state;
  figure.dataset.plotMessage = message;
}

function clearCanvas(canvas) {
  canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
}

function revealMobileResults() {
  if (!compactControlsMedia.matches) return;
  dom.bjtControls.open = false;
  requestAnimationFrame(() => dom.bjtResultsTitle.focus({ preventScroll: true }));
}

function exportProfile() {
  if (!currentResult?.diagnostics.converged || dirty) return;
  downloadBlob(serializeNpnProfileCsv(currentResult), "text/csv;charset=utf-8", "npn-selected-2d.csv");
}

function exportSweep() {
  if (!currentFamily?.converged || dirty || selectedCurveIndex < 0) return;
  const curve = currentFamily.curves[selectedCurveIndex];
  const sweep = { ...curve, config: { ...currentFamily.config, baseEmitterVoltageV: curve.baseEmitterVoltageV } };
  downloadBlob(serializeNpnSweepCsv(sweep), "text/csv;charset=utf-8", "npn-selected-output-curve.csv");
}

function exportOutputPng() {
  if (!currentFamily?.converged || dirty) return;
  dom.bjtOutputCanvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, "image/png", "npn-output-characteristics.png");
  }, "image/png");
}

function updateExportState() {
  dom.bjtExportProfileButton.disabled = !currentResult?.diagnostics.converged || dirty;
  dom.bjtExportSweepButton.disabled = !currentFamily?.converged || dirty || selectedCurveIndex < 0;
  dom.bjtExportPngButton.disabled = !currentFamily?.converged || dirty;
}

function setControlsEnabled(enabled) {
  for (const element of dom.bjtForm.querySelectorAll("input, button")) element.disabled = !enabled;
  updatePreflight();
}

function classifyOperatingRegion(baseEmitterVoltageV, collectorEmitterVoltageV) {
  if (baseEmitterVoltageV < 0.3) return "Cutoff";
  return collectorEmitterVoltageV <= baseEmitterVoltageV ? "Saturation" : "Forward active";
}

function linearGrid(minimum, maximum, count) {
  return Array.from({ length: count }, (_, index) => index === count - 1
    ? maximum
    : minimum + (maximum - minimum) * index / (count - 1));
}

function prepareCanvas(canvas) {
  const logicalWidth = canvas.clientWidth || Number(canvas.getAttribute("width"));
  const logicalHeight = canvas.clientHeight || Number(canvas.getAttribute("height"));
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  const width = Math.round(logicalWidth * ratio);
  const height = Math.round(logicalHeight * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width: logicalWidth, height: logicalHeight };
}

function setStatus(text, state) {
  dom.bjtGlobalStatus.textContent = text;
  dom.bjtGlobalStatus.dataset.state = state;
}

function setMessage(element, text, state) {
  element.textContent = text;
  element.dataset.state = state;
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

function replaceList(container, values) {
  container.replaceChildren(...values.map((value) => {
    const item = document.createElement("li");
    item.textContent = value;
    return item;
  }));
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

function sequentialColor(value) {
  return [Math.round(236 - 194 * value), Math.round(244 - 84 * value), Math.round(246 - 101 * value)];
}

function divergingColor(value) {
  if (value < 0.5) {
    const scaled = value * 2;
    return [Math.round(48 + 207 * scaled), Math.round(105 + 150 * scaled), Math.round(152 + 103 * scaled)];
  }
  const scaled = (value - 0.5) * 2;
  return [255, Math.round(255 - 174 * scaled), Math.round(255 - 196 * scaled)];
}

function drawLine(context, x1, y1, x2, y2) {
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
}

function maxAbs(values) {
  let maximum = 0;
  for (const value of values) maximum = Math.max(maximum, Math.abs(value));
  return maximum;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatScientific(value) {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) < 1e-30) return "0";
  return value.toExponential(2).replace("e+", "e");
}

function formatFixed(value, decimals) {
  return Number.isFinite(value) ? value.toFixed(decimals) : "—";
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${formatScientific(value * 100)} %` : "—";
}

function debounce(callback, delay) {
  let timeout;
  return () => {
    clearTimeout(timeout);
    timeout = setTimeout(callback, delay);
  };
}
