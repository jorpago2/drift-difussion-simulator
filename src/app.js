import {
  DEFAULT_PN_CONFIG,
  serializePnProfileCsv,
  serializePnSweepCsv,
  shockleyReferenceCurrentDensity,
  solvePnJunction1D,
  validatePnConfig,
} from "./ddm-core.js";

const LESSONS = Object.freeze({
  equilibrium: {
    biasV: 0,
    kicker: "Equilibrio térmico",
    title: "Predice la unión antes de resolver",
    prediction: "Antes de resolver, anticipa hacia dónde apunta el campo interno y en qué lado se extiende más la región de agotamiento.",
    question: "¿Qué establece el equilibrio?",
    detail: "La difusión inicial deja carga descubierta, genera un campo interno y curva las bandas hasta alinear el nivel de Fermi.",
    result: "Comprueba que el nivel de Fermi es plano, la corriente total es nula y la caída electrostática coincide con el potencial incorporado.",
  },
  forward: {
    biasV: 0.6,
    kicker: "Polarización directa",
    title: "Observa cómo disminuye la barrera",
    prediction: "Predice qué ocurre con la región de agotamiento y qué portadores se inyectan al aplicar tensión positiva al ánodo.",
    question: "¿Por qué aumenta la corriente?",
    detail: "La tensión directa reduce la barrera, estrecha el agotamiento y eleva exponencialmente la inyección de minoritarios.",
    result: "Relaciona la menor curvatura de bandas con el aumento de portadores minoritarios, recombinación SRH y densidad de corriente.",
  },
  reverse: {
    biasV: -0.5,
    kicker: "Polarización inversa",
    title: "Explora el ensanchamiento del agotamiento",
    prediction: "Predice cómo cambian la anchura de agotamiento, el campo máximo y la generación SRH bajo polarización inversa.",
    question: "¿Qué no representa este modelo?",
    detail: "La inversa aumenta la barrera y ensancha el agotamiento. No se incluyen avalancha ni túnel, por lo que no puede predecir ruptura.",
    result: "Comprueba el aumento del campo y la generación neta en agotamiento, sin interpretar la curva como modelo de ruptura.",
  },
});

const STAGES = Object.freeze({
  device: ["Paso 1 de 4", "Dispositivo"],
  solve: ["Paso 2 de 4", "Resolver"],
  results: ["Paso 3 de 4", "Resultados"],
  validate: ["Paso 4 de 4", "Validar"],
});

const dom = Object.fromEntries([
  "globalStatus", "openPanelButton", "closePanelButton", "controlPanel", "stageKicker", "panelTitle",
  "lessonKicker", "workspaceTitle", "biasBadge", "predictionText", "pDopingLabel", "nDopingLabel",
  "depletionZone", "preflightSummary", "resultsArea", "lessonSelect", "acceptorInput", "donorInput",
  "deviceOverview",
  "biasInput", "lengthInput", "cellsInput", "electronLifetimeInput", "holeLifetimeInput", "predictionTitle",
  "predictionDetail", "preflightDetails", "derivedMetrics", "solveButton", "solverMessage", "resultExplanation",
  "showElectrostaticsButton", "showCarriersButton", "generateJvButton", "jvInlineButton", "sweepMessage",
  "validationBanner", "validationMetrics", "warningList", "exportCsvButton", "exportPngButton", "cursorReadout",
  "potentialCanvas", "fieldCanvas", "chargeCanvas", "carrierCanvas", "bandCanvas", "jvCanvas", "jvEmpty",
  "jvFigure", "electrostaticsView", "carriersView", "jvView",
].map((id) => [id, requireElement(id)]));

const stageButtons = [...document.querySelectorAll("[data-stage]")];
const stagePanels = [...document.querySelectorAll("[data-stage-panel]")];
const openStageButtons = [...document.querySelectorAll("[data-open-stage]")];
const viewTabs = [...document.querySelectorAll("[data-view-tab]")];
const configInputs = [
  dom.acceptorInput,
  dom.donorInput,
  dom.biasInput,
  dom.lengthInput,
  dom.cellsInput,
  dom.electronLifetimeInput,
  dom.holeLifetimeInput,
];
const chartRegistry = new Map();

let activeStage = "device";
let activeView = "electrostatics";
let currentResult = null;
let currentSweep = null;
let solving = false;

bindEvents();
applyLesson("equilibrium", false);
updatePreflight();
selectStage("device");

function requireElement(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Falta el elemento requerido #${id}.`);
  return element;
}

function bindEvents() {
  dom.openPanelButton.addEventListener("click", () => openPanel(activeStage));
  dom.closePanelButton.addEventListener("click", () => dom.controlPanel.close());
  dom.controlPanel.addEventListener("close", () => dom.openPanelButton.setAttribute("aria-expanded", "false"));
  dom.controlPanel.addEventListener("cancel", () => dom.openPanelButton.setAttribute("aria-expanded", "false"));

  for (const button of openStageButtons) {
    button.addEventListener("click", () => openPanel(button.dataset.openStage));
  }
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
      dom.cursorReadout.textContent = "Mueve el cursor sobre una gráfica para inspeccionar el perfil.";
    });
  }
}

function openPanel(stage) {
  selectStage(stage);
  if (!dom.controlPanel.open) dom.controlPanel.showModal();
  dom.openPanelButton.setAttribute("aria-expanded", "true");
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
  if (dom.controlPanel.open) dom.controlPanel.close();
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
      ["Potencial incorporado estimado", `${formatFixed(derived.builtInPotentialV, 3)} V`],
      ["Agotamiento estimado", `${formatScientific(derived.depletionWidthM * 1e6)} µm`],
      ["Paso espacial", `${formatScientific(derived.dxM * 1e9)} nm`],
      ["Menor longitud de Debye", `${formatScientific(Math.min(derived.acceptorDebyeLengthM, derived.donorDebyeLengthM) * 1e9)} nm`],
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
    const text = `Configuración válida con ${warnings.length} advertencia${warnings.length === 1 ? "" : "s"}.`;
    setMessage(dom.preflightSummary, text, "warning");
    setMessage(dom.preflightDetails, `${text} ${warnings.join(" ")}`, "warning");
    dom.solveButton.disabled = solving;
  } else {
    setMessage(dom.preflightSummary, "Configuración válida. Abre «Resolver» para calcular el estado físico.", "ready");
    setMessage(dom.preflightDetails, "Preflight superado: parámetros finitos, rangos físicos y malla adecuada.", "ready");
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
  dom.sweepMessage.textContent = "Resuelve primero un punto de operación.";
  dom.validationMetrics.replaceChildren();
  dom.warningList.replaceChildren();
  setMessage(dom.validationBanner, "Sin resultado para validar.", "idle");
  updateGlobalStatus("Sin resolver", "idle");
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
  updateGlobalStatus("Resolviendo…", "solving");
  setMessage(dom.solverMessage, "Resolviendo equilibrio, continuación de tensión y residuos…", "warning");
  await nextPaint();

  try {
    const result = solvePnJunction1D(validation.config);
    currentResult = result;
    currentSweep = null;
    if (!result.diagnostics.converged) {
      dom.resultsArea.hidden = true;
      updateGlobalStatus("No convergido", "failed");
      setMessage(dom.solverMessage, result.diagnostics.failureReason || "El solver no convergió.", "error");
    } else {
      dom.resultsArea.hidden = false;
      dom.deviceOverview.hidden = true;
      dom.workspaceTitle.textContent = "Solución drift-diffusion autoconsistente";
      dom.generateJvButton.disabled = false;
      dom.jvFigure.hidden = true;
      dom.jvEmpty.hidden = false;
      dom.sweepMessage.textContent = "Listo para resolver 67 puntos entre −1,00 y 0,65 V.";
      renderResult(result);
      renderValidation(result);
      selectView("electrostatics");
      selectStage("results");
      updateGlobalStatus("Convergido", "converged");
      setMessage(
        dom.solverMessage,
        `Convergió en ${result.diagnostics.totalIterations} iteraciones acumuladas; conservación de corriente ${formatScientific(result.diagnostics.currentContinuityError)}.`,
        "ready",
      );
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
    yLabel: "Concentración (cm⁻³)",
    transform: logTransform(),
    series: [
      { label: "n", values: Float64Array.from(result.electronM3, (value) => value / 1e6), color: "#2262a5" },
      { label: "p", values: Float64Array.from(result.holeM3, (value) => value / 1e6), color: "#b12f49" },
      { label: "|dopaje|", values: Float64Array.from(result.dopingM3, (value) => Math.abs(value) / 1e6), color: "#6a7780", dash: [6, 4] },
    ],
  });
  drawLineChart(dom.bandCanvas, {
    x: xUm,
    xLabel: "x (µm)",
    yLabel: "Energía relativa (eV)",
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
  updateGlobalStatus("Barrido J–V…", "solving");
  setMessage(dom.sweepMessage, "Preparando equilibrio para el barrido…", "warning");

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
        setMessage(dom.sweepMessage, `Resolviendo J–V: ${solved}/67 puntos…`, "warning");
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
      throw new Error("El barrido se detuvo porque al menos un punto no convergió.");
    }
    renderJv(currentSweep);
    dom.jvEmpty.hidden = true;
    dom.jvFigure.hidden = false;
    selectView("jv");
    updateGlobalStatus("J–V convergida", "converged");
    setMessage(dom.sweepMessage, "67 puntos convergidos entre −1,00 y 0,65 V.", "ready");
    if (dom.controlPanel.open) dom.controlPanel.close();
  } catch (error) {
    currentSweep = null;
    updateGlobalStatus("Barrido fallido", "failed");
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
  const current = Float64Array.from(sweep.points, (point) => point.currentDensityAm2 / 1e4);
  const reference = Float64Array.from(sweep.points, (point) =>
    point.shockleyCurrentDensityAm2 == null ? NaN : point.shockleyCurrentDensityAm2 / 1e4,
  );
  drawLineChart(dom.jvCanvas, {
    x: voltage,
    xLabel: "V_D (V)",
    yLabel: "J (A/cm², symlog)",
    transform: symlogTransform(1e-10),
    series: [
      { label: "DD + SRH", values: current, color: "#087e8b" },
      { label: "Shockley", values: reference, color: "#ca7b00", dash: [7, 4] },
    ],
  });
  chartRegistry.set(dom.jvCanvas, { type: "sweep", x: voltage });
}

function renderValidation(result) {
  const potentialBarrierV = result.potentialV.at(-1) - result.potentialV[0];
  const expectedBarrierV = result.derived.builtInPotentialV - result.config.biasV;
  renderMetricList(dom.validationMetrics, [
    ["Estado", result.diagnostics.converged ? "Convergido" : "No convergido"],
    ["Residual de Poisson", formatScientific(result.diagnostics.poissonResidual)],
    ["Residual de electrones", formatScientific(result.diagnostics.electronResidual)],
    ["Residual de huecos", formatScientific(result.diagnostics.holeResidual)],
    ["No uniformidad de J", formatPercent(result.diagnostics.currentContinuityError)],
    ["J media", `${formatScientific(result.diagnostics.meanCurrentDensityAm2 / 1e4)} A/cm²`],
    ["Barrera simulada / esperada", `${formatFixed(potentialBarrierV, 4)} / ${formatFixed(expectedBarrierV, 4)} V`],
    ["Malla", `${result.config.cells} nodos; Δx = ${formatScientific(result.derived.dxM * 1e9)} nm`],
  ]);
  setMessage(
    dom.validationBanner,
    result.diagnostics.converged
      ? "PASS: ecuaciones, positividad y conservación satisfacen los umbrales de la v1."
      : "FAIL: no utilices este resultado como solución física.",
    result.diagnostics.converged ? "pass" : "error",
  );
  const limitations = [
    ...result.warnings,
    "Sin avalancha ni túnel: la polarización inversa no predice ruptura.",
    "Boltzmann y movilidad constante: no es válido como TCAD general a alta densidad o campo.",
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
  downloadBlob(csv, "text/csv;charset=utf-8", isSweep ? "union-pn-jv.csv" : "union-pn-perfil.csv");
}

function exportPng() {
  if (!currentResult?.diagnostics.converged) return;
  const canvas = activeView === "jv" ? dom.jvCanvas :
    (activeView === "carriers" ? dom.carrierCanvas : dom.potentialCanvas);
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, "image/png", `union-pn-${activeView}.png`);
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
  const context = canvas.getContext("2d");
  const { width, height } = canvas;
  const pad = { left: 74, right: 22, top: 46, bottom: 52 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const transform = specification.transform ?? linearTransform();
  const xValues = [...specification.x].filter(Number.isFinite);
  const yValues = [];
  for (const series of specification.series) {
    for (const value of series.values) if (Number.isFinite(value) && transform.valid(value)) yValues.push(transform.forward(value));
  }
  const xRange = paddedRange(xValues, 0.02);
  const yRange = paddedRange(yValues, 0.08);

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#dce6e8";
  context.lineWidth = 1;
  context.font = "700 11px Inter, system-ui, sans-serif";
  context.fillStyle = "#60747b";

  for (let tick = 0; tick <= 5; tick += 1) {
    const fraction = tick / 5;
    const x = pad.left + fraction * plotWidth;
    const y = pad.top + fraction * plotHeight;
    drawLine(context, x, pad.top, x, pad.top + plotHeight);
    drawLine(context, pad.left, y, pad.left + plotWidth, y);
    context.textAlign = "center";
    context.fillText(formatAxis(xRange.min + fraction * (xRange.max - xRange.min)), x, height - 29);
    context.textAlign = "right";
    const transformedY = yRange.max - fraction * (yRange.max - yRange.min);
    context.fillText(formatAxis(transform.inverse(transformedY)), pad.left - 9, y + 4);
  }

  context.strokeStyle = "#263a41";
  context.lineWidth = 1.4;
  drawLine(context, pad.left, pad.top + plotHeight, pad.left + plotWidth, pad.top + plotHeight);
  drawLine(context, pad.left, pad.top, pad.left, pad.top + plotHeight);

  if (transform.valid(0)) {
    const zero = transform.forward(0);
    if (zero >= yRange.min && zero <= yRange.max) {
      const y = pad.top + plotHeight - ((zero - yRange.min) / (yRange.max - yRange.min)) * plotHeight;
      context.strokeStyle = "#8da0a6";
      context.lineWidth = 1;
      drawLine(context, pad.left, y, pad.left + plotWidth, y);
    }
  }

  for (const series of specification.series) {
    context.strokeStyle = series.color;
    context.lineWidth = 2.4;
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
      const x = pad.left + ((xValue - xRange.min) / (xRange.max - xRange.min)) * plotWidth;
      const transformedY = transform.forward(yValue);
      const y = pad.top + plotHeight - ((transformedY - yRange.min) / (yRange.max - yRange.min)) * plotHeight;
      if (!drawing) context.moveTo(x, y);
      else context.lineTo(x, y);
      drawing = true;
    }
    context.stroke();
  }
  context.setLineDash([]);

  context.textAlign = "center";
  context.fillStyle = "#20343b";
  context.font = "800 12px Inter, system-ui, sans-serif";
  context.fillText(specification.xLabel, pad.left + plotWidth / 2, height - 9);
  context.save();
  context.translate(15, pad.top + plotHeight / 2);
  context.rotate(-Math.PI / 2);
  context.fillText(specification.yLabel, 0, 0);
  context.restore();

  let legendX = pad.left;
  context.textAlign = "left";
  context.font = "800 11px Inter, system-ui, sans-serif";
  for (const series of specification.series) {
    context.strokeStyle = series.color;
    context.lineWidth = 3;
    context.setLineDash(series.dash ?? []);
    drawLine(context, legendX, 20, legendX + 22, 20);
    context.setLineDash([]);
    context.fillStyle = "#33484f";
    context.fillText(series.label, legendX + 28, 24);
    legendX += 42 + context.measureText(series.label).width;
  }
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
      dom.cursorReadout.textContent = `V_D=${formatFixed(point.voltageV, 3)} V | J=${formatScientific(point.currentDensityAm2 / 1e4)} A/cm²`;
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
  return { forward: (value) => value, inverse: (value) => value, valid: Number.isFinite };
}

function logTransform() {
  return {
    forward: (value) => Math.log10(value),
    inverse: (value) => 10 ** value,
    valid: (value) => Number.isFinite(value) && value > 0,
  };
}

function symlogTransform(linear) {
  return {
    forward: (value) => Math.sign(value) * Math.log10(1 + Math.abs(value) / linear),
    inverse: (value) => Math.sign(value) * linear * (10 ** Math.abs(value) - 1),
    valid: Number.isFinite,
  };
}

function paddedRange(values, fraction) {
  if (!values.length) return { min: -1, max: 1 };
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    const padding = Math.max(1, Math.abs(min) * 0.1);
    return { min: min - padding, max: max + padding };
  }
  const padding = (max - min) * fraction;
  return { min: min - padding, max: max + padding };
}

function drawLine(context, x1, y1, x2, y2) {
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
}

function formatAxis(value) {
  if (!Number.isFinite(value)) return "–";
  const absolute = Math.abs(value);
  if (absolute >= 1e4 || (absolute > 0 && absolute < 1e-2)) return value.toExponential(1);
  return Number(value.toPrecision(3)).toString();
}

function formatScientific(value) {
  if (!Number.isFinite(value)) return "–";
  if (value === 0) return "0";
  return value.toExponential(2).replace("e+", "e");
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
