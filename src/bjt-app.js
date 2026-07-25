import {
  DEFAULT_NPN_CONFIG,
  serializeNpnProfileCsv,
  serializeNpnSweepCsv,
  validateNpnConfig,
} from "./bjt-core.js";
import { createNiceScale, formatChartTick } from "./plot-utils.js";

const ids = [
  "bjtGlobalStatus", "bjtForm", "bjtVbeInput", "bjtVceInput", "bjtEmitterDopingInput",
  "bjtBaseDopingInput", "bjtCollectorDopingInput", "bjtLengthInput", "bjtHeightInput",
  "bjtEmitterWidthInput", "bjtBaseWidthInput", "bjtDepthInput", "bjtNxInput", "bjtNyInput",
  "bjtElectronLifetimeInput", "bjtHoleLifetimeInput", "bjtPreflight", "bjtDerivedMetrics",
  "bjtSolveButton", "bjtSolverMessage", "bjtBiasBadge", "bjtWorkspaceTitle", "bjtOverview",
  "bjtResults", "bjtCircuitMetrics", "bjtSweepEmpty", "bjtSweepButton", "bjtOutputFigure",
  "bjtOutputCanvas", "bjtPotentialCanvas", "bjtElectronCanvas", "bjtCurrentCanvas",
  "bjtRecombinationCanvas",
  "bjtValidationBanner", "bjtValidationMetrics", "bjtWarningList", "bjtExportProfileButton",
  "bjtExportSweepButton", "bjtExportPngButton", "bjtOutputView", "bjtMapsView",
  "bjtValidationView",
];
const dom = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
for (const [id, element] of Object.entries(dom)) if (!element) throw new Error(`Missing #${id}`);

const worker = new Worker("src/bjt-worker.js", { type: "module" });
let currentResult = null;
let currentFamily = null;
let activeView = "output";
let busy = false;
let dirty = false;

dom.bjtForm.addEventListener("submit", solveOperatingPoint);
dom.bjtSweepButton.addEventListener("click", solveOutputFamily);
dom.bjtExportProfileButton.addEventListener("click", exportProfile);
dom.bjtExportSweepButton.addEventListener("click", exportSweep);
dom.bjtExportPngButton.addEventListener("click", exportActivePng);
for (const button of document.querySelectorAll("[data-bjt-view]")) {
  button.addEventListener("click", () => selectView(button.dataset.bjtView));
  button.addEventListener("keydown", navigateResultTabs);
}
for (const input of dom.bjtForm.querySelectorAll("input")) {
  input.addEventListener("input", () => {
    dirty = true;
    currentFamily = null;
    updatePreflight();
    updateExportState();
  });
}
window.addEventListener("resize", debounce(() => {
  if (!currentResult) return;
  drawMaps(currentResult);
  if (currentFamily) drawOutputFamily(currentFamily);
}, 120));

worker.addEventListener("message", ({ data }) => {
  busy = false;
  setControlsEnabled(true);
  if (data.action === "failed") {
    setStatus("Solver failed", "failed");
    setMessage(dom.bjtSolverMessage, data.message, "error");
    return;
  }
  if (data.action === "solved") {
    currentResult = data.result;
    dirty = false;
    if (!currentResult.diagnostics.converged) {
      setStatus("Not converged", "failed");
      setMessage(dom.bjtSolverMessage, currentResult.diagnostics.failureReason, "error");
      dom.bjtResults.hidden = true;
      updateExportState();
      return;
    }
    renderOperatingPoint(currentResult);
    setStatus("NPN converged", "converged");
    setMessage(
      dom.bjtSolverMessage,
      `Converged after ${currentResult.diagnostics.totalIterations} cumulative Gummel iterations.`,
      "ready",
    );
    updateExportState();
    return;
  }
  if (data.action === "swept") {
    currentFamily = data.result;
    if (!currentFamily.converged) {
      setStatus("Sweep failed", "failed");
      setMessage(dom.bjtSolverMessage, "The output family contains an unconverged point.", "error");
      return;
    }
    dom.bjtSweepEmpty.hidden = true;
    dom.bjtOutputFigure.hidden = false;
    drawOutputFamily(currentFamily);
    setStatus("Output family converged", "converged");
    setMessage(dom.bjtSolverMessage, "All output-characteristic points converged.", "ready");
    updateExportState();
  }
});

updatePreflight();
selectView("output");

function readConfig() {
  return {
    ...DEFAULT_NPN_CONFIG,
    baseEmitterVoltageV: Number(dom.bjtVbeInput.value),
    collectorEmitterVoltageV: Number(dom.bjtVceInput.value),
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

function updatePreflight() {
  const validation = validateNpnConfig(readConfig());
  const { errors, warnings, derived, config } = validation;
  dom.bjtBiasBadge.textContent = `VBE = ${formatFixed(config.baseEmitterVoltageV, 2)} V · VCE = ${formatFixed(config.collectorEmitterVoltageV, 2)} V`;
  if (errors.length) setMessage(dom.bjtPreflight, errors.join(" "), "error");
  else if (warnings.length) setMessage(dom.bjtPreflight, warnings.join(" "), "warning");
  else setMessage(dom.bjtPreflight, "Preflight passed: geometry, contacts, model ranges, and mesh scales are consistent.", "ready");
  renderMetricList(dom.bjtDerivedMetrics, derived ? [
    ["Δx / Δy", `${formatScientific(derived.dxM * 1e9)} / ${formatScientific(derived.dyM * 1e9)} nm`],
    ["Emitter-base Vbi", `${formatFixed(derived.emitterBaseBuiltInV, 3)} V`],
    ["Base-collector Vbi", `${formatFixed(derived.baseCollectorBuiltInV, 3)} V`],
    ["EB / BC depletion", `${formatScientific(derived.emitterBaseDepletionM * 1e6)} / ${formatScientific(derived.baseCollectorDepletionM * 1e6)} µm`],
  ] : []);
  dom.bjtSolveButton.disabled = busy || errors.length > 0;
  if (dirty) setStatus("Configuration changed", "idle");
}

function solveOperatingPoint(event) {
  event.preventDefault();
  if (busy) return;
  const validation = validateNpnConfig(readConfig());
  if (validation.errors.length) return;
  busy = true;
  setControlsEnabled(false);
  setStatus("Solving 2D NPN…", "solving");
  setMessage(
    dom.bjtSolverMessage,
    "Solving equilibrium, collector continuation, and base continuation in a background worker…",
    "warning",
  );
  worker.postMessage({ action: "solve", config: validation.config, previousSolution: currentResult });
}

function solveOutputFamily() {
  if (busy || !currentResult?.diagnostics.converged || dirty) return;
  busy = true;
  setControlsEnabled(false);
  setStatus("Calculating IC–VCE…", "solving");
  setMessage(
    dom.bjtSolverMessage,
    "Solving three base-voltage curves; each point must pass the coupled residual and terminal-balance checks.",
    "warning",
  );
  worker.postMessage({ action: "sweep", config: readConfig() });
}

function renderOperatingPoint(result) {
  const emitterInto = result.terminalCurrents.emitter.currentIntoDeviceA;
  const baseInto = result.terminalCurrents.base.currentIntoDeviceA;
  const collectorInto = result.terminalCurrents.collector.currentIntoDeviceA;
  const emitterOut = -emitterInto;
  const beta = baseInto > 0 ? collectorInto / baseInto : NaN;
  const region = result.config.baseEmitterVoltageV < 0.3
    ? "Cutoff"
    : result.config.collectorEmitterVoltageV <= result.config.baseEmitterVoltageV
      ? "Saturation"
      : "Forward active";
  renderMetricList(dom.bjtCircuitMetrics, [
    ["Operating region", region],
    ["Collector current IC", `${formatScientific(collectorInto * 1e3)} mA`],
    ["Base current IB", `${formatScientific(baseInto * 1e6)} µA`],
    ["Emitter current IE", `${formatScientific(emitterOut * 1e3)} mA`],
    ["Current gain β = IC/IB", Number.isFinite(beta) ? formatFixed(beta, 2) : "Not defined"],
    ["Device depth", `${formatScientific(result.config.deviceDepthUm)} µm`],
  ]);
  renderMetricList(dom.bjtValidationMetrics, [
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
    "PASS: all three equations, terminal KCL, carrier balance, positivity, and contact constraints satisfy the NPN thresholds.",
    "pass",
  );
  replaceList(dom.bjtWarningList, result.warnings.length ? result.warnings : [
    "No additional preflight warning at this operating point.",
  ]);
  dom.bjtWorkspaceTitle.textContent = "Self-consistent NPN operating point";
  dom.bjtOverview.hidden = true;
  dom.bjtResults.hidden = false;
  dom.bjtSweepEmpty.hidden = false;
  dom.bjtOutputFigure.hidden = true;
  drawMaps(result);
}

function selectView(view) {
  activeView = view;
  for (const button of document.querySelectorAll("[data-bjt-view]")) {
    const selected = button.dataset.bjtView === view;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  dom.bjtOutputView.hidden = view !== "output";
  dom.bjtMapsView.hidden = view !== "maps";
  dom.bjtValidationView.hidden = view !== "validation";
  if (view === "maps" && currentResult) drawMaps(currentResult);
  if (view === "output" && currentFamily) drawOutputFamily(currentFamily);
  updateExportState();
}

function drawMaps(result) {
  const extent = { lengthUm: result.derived.lengthM * 1e6, heightUm: result.derived.heightM * 1e6 };
  drawHeatmap(dom.bjtPotentialCanvas, result.potentialV, result.nx, result.ny, {
    label: "ψ (V)", diverging: false, ...extent,
  });
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
}

function navigateResultTabs(event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [...document.querySelectorAll("[data-bjt-view]")];
  const current = tabs.indexOf(event.currentTarget);
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 :
    (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next].focus();
  selectView(tabs[next].dataset.bjtView);
}

function drawOutputFamily(family) {
  const colors = ["#7b61a8", "#ca7b00", "#087e8b", "#c4483f"];
  const x = Float64Array.from(family.curves[0].points, (point) => point.collectorEmitterVoltageV);
  drawLineChart(dom.bjtOutputCanvas, {
    x,
    xLabel: "V_CE (V)",
    yLabel: "I_C (mA)",
    includeZero: true,
    series: family.curves.map((curve, index) => ({
      label: `V_BE = ${formatFixed(curve.baseEmitterVoltageV, 2)} V`,
      color: colors[index % colors.length],
      values: Float64Array.from(curve.points, (point) => point.collectorCurrentA * 1e3),
    })),
  });
}

function drawHeatmap(canvas, values, nx, ny, options) {
  const { context, width, height } = prepareCanvas(canvas);
  const pad = width < 520 ? { left: 54, right: 12, top: 32, bottom: 48 } :
    { left: 66, right: 18, top: 34, bottom: 52 };
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
    const fraction = Math.max(0, Math.min(1, (values[index] - minimum) / (maximum - minimum)));
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
  context.lineWidth = 1;
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
  const pad = compact ? { left: 58, right: 10, top: 62, bottom: 50 } :
    { left: 82, right: 18, top: 58, bottom: 58 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const xValues = [...specification.x].filter(Number.isFinite);
  const yValues = specification.series.flatMap((series) => [...series.values].filter(Number.isFinite));
  const xScale = createNiceScale(xValues, 7, true);
  const yScale = createNiceScale(yValues, 7, specification.includeZero);
  const mapX = (value) => pad.left + (value - xScale.min) / (xScale.max - xScale.min) * plotWidth;
  const mapY = (value) => pad.top + plotHeight - (value - yScale.min) / (yScale.max - yScale.min) * plotHeight;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.font = "600 11px Inter, system-ui, sans-serif";
  context.fillStyle = "#52676e";
  for (const tick of xScale.ticks) {
    const xPosition = mapX(tick);
    context.strokeStyle = tick === 0 ? "#b8c7cb" : "#e8eef0";
    drawLine(context, xPosition, pad.top, xPosition, pad.top + plotHeight);
    context.textAlign = "center";
    context.fillText(formatChartTick(tick, xScale.step), xPosition, pad.top + plotHeight + 19);
  }
  for (const tick of yScale.ticks) {
    const yPosition = mapY(tick);
    context.strokeStyle = tick === 0 ? "#b8c7cb" : "#e8eef0";
    drawLine(context, pad.left, yPosition, pad.left + plotWidth, yPosition);
    context.textAlign = "right";
    context.fillText(formatChartTick(tick, yScale.step), pad.left - 10, yPosition + 4);
  }
  context.save();
  context.beginPath();
  context.rect(pad.left, pad.top, plotWidth, plotHeight);
  context.clip();
  for (const series of specification.series) {
    context.strokeStyle = series.color;
    context.lineWidth = 2.6;
    context.beginPath();
    for (let index = 0; index < specification.x.length; index += 1) {
      const xPosition = mapX(specification.x[index]);
      const yPosition = mapY(series.values[index]);
      if (index === 0) context.moveTo(xPosition, yPosition);
      else context.lineTo(xPosition, yPosition);
    }
    context.stroke();
  }
  context.restore();
  context.fillStyle = "#20343b";
  context.font = "700 12px Inter, system-ui, sans-serif";
  context.textAlign = "center";
  context.fillText(specification.xLabel, pad.left + plotWidth / 2, height - 8);
  context.save();
  context.translate(17, pad.top + plotHeight / 2);
  context.rotate(-Math.PI / 2);
  context.fillText(specification.yLabel, 0, 0);
  context.restore();
  let legendX = pad.left;
  let legendY = 22;
  context.font = "700 11px Inter, system-ui, sans-serif";
  context.textAlign = "left";
  for (const series of specification.series) {
    const required = 34 + context.measureText(series.label).width;
    if (legendX + required > width - 10) {
      legendX = pad.left;
      legendY += 18;
    }
    context.strokeStyle = series.color;
    context.lineWidth = 3;
    drawLine(context, legendX, legendY, legendX + 20, legendY);
    context.fillStyle = "#40555c";
    context.fillText(series.label, legendX + 26, legendY + 4);
    legendX += required + 12;
  }
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

function exportProfile() {
  if (!currentResult?.diagnostics.converged || dirty) return;
  downloadBlob(serializeNpnProfileCsv(currentResult), "text/csv;charset=utf-8", "npn-2d-profile.csv");
}

function exportSweep() {
  if (!currentFamily?.converged || dirty) return;
  downloadBlob(serializeNpnSweepCsv(currentFamily), "text/csv;charset=utf-8", "npn-output-family.csv");
}

function exportActivePng() {
  if (!currentResult?.diagnostics.converged || dirty) return;
  const canvas = activeView === "output" ? dom.bjtOutputCanvas :
    activeView === "maps" ? dom.bjtPotentialCanvas : null;
  if (!canvas || (activeView === "output" && !currentFamily)) return;
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, "image/png", `npn-${activeView}.png`);
  }, "image/png");
}

function updateExportState() {
  const ready = currentResult?.diagnostics.converged && !dirty;
  dom.bjtExportProfileButton.disabled = !ready;
  dom.bjtExportSweepButton.disabled = !ready || !currentFamily?.converged;
  dom.bjtExportPngButton.disabled = !ready || activeView === "validation" ||
    (activeView === "output" && !currentFamily);
  dom.bjtSweepButton.disabled = !ready || busy;
}

function setControlsEnabled(enabled) {
  for (const input of dom.bjtForm.querySelectorAll("input, button")) input.disabled = !enabled;
  dom.bjtSweepButton.disabled = !enabled || !currentResult?.diagnostics.converged || dirty;
  updateExportState();
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
    dt.textContent = term;
    dd.textContent = definition;
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
  return [
    Math.round(236 - 194 * value),
    Math.round(244 - 84 * value),
    Math.round(246 - 101 * value),
  ];
}

function divergingColor(value) {
  if (value < 0.5) {
    const t = value * 2;
    return [Math.round(48 + 207 * t), Math.round(105 + 150 * t), Math.round(152 + 103 * t)];
  }
  const t = (value - 0.5) * 2;
  return [255, Math.round(255 - 174 * t), Math.round(255 - 196 * t)];
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
