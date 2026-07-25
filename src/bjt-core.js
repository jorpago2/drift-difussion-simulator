import { EPS0, KB, Q, bernoulli, neutralCarrierPair, thermalVoltage } from "./ddm-core.js";

export const DEFAULT_NPN_CONFIG = Object.freeze({
  lengthUm: 2,
  heightUm: 0.4,
  deviceDepthUm: 100,
  emitterWidthUm: 0.5,
  baseWidthUm: 0.5,
  emitterDopingCm3: 8e15,
  baseDopingCm3: 4e15,
  collectorDopingCm3: 1e15,
  baseEmitterVoltageV: 0.55,
  collectorEmitterVoltageV: 0.8,
  nx: 161,
  ny: 33,
  temperatureK: 300,
  intrinsicDensityCm3: 1e10,
  relativePermittivity: 11.7,
  bandgapEv: 1.12,
  electronMobilityM2Vs: 0.135,
  holeMobilityM2Vs: 0.048,
  electronLifetimeS: 1e-9,
  holeLifetimeS: 1e-9,
  maxIterations: 160,
  residualTolerance: 1e-6,
  conservationTolerance: 1e-2,
});

const CONTACT_NONE = 0;
const CONTACT_EMITTER = 1;
const CONTACT_BASE = 2;
const CONTACT_COLLECTOR = 3;
const MAX_BASE_STEP_V = 0.1;
const MAX_COLLECTOR_STEP_V = 0.1;

const LIMITS = Object.freeze({
  lengthUm: [1.5, 10],
  heightUm: [0.2, 3],
  deviceDepthUm: [1, 1e5],
  emitterWidthUm: [0.2, 4],
  baseWidthUm: [0.1, 2],
  emitterDopingCm3: [1e14, 5e17],
  baseDopingCm3: [1e14, 5e17],
  collectorDopingCm3: [1e14, 5e17],
  baseEmitterVoltageV: [-0.2, 0.75],
  collectorEmitterVoltageV: [-0.2, 5],
  nx: [41, 501],
  ny: [9, 121],
  electronLifetimeS: [1e-12, 1e-3],
  holeLifetimeS: [1e-12, 1e-3],
});

export function validateNpnConfig(input = {}) {
  const config = { ...DEFAULT_NPN_CONFIG, ...input };
  const errors = [];
  const warnings = [];

  for (const [name, [minimum, maximum]] of Object.entries(LIMITS)) {
    const value = config[name];
    if (!Number.isFinite(value)) errors.push(`${name} must be finite.`);
    else if (value < minimum || value > maximum) {
      errors.push(`${name} must be between ${minimum} and ${maximum}.`);
    }
  }
  for (const name of ["nx", "ny"]) {
    if (!Number.isInteger(config[name]) || config[name] % 2 === 0) {
      errors.push(`${name} must be an odd integer.`);
    }
  }
  for (const name of [
    "temperatureK", "intrinsicDensityCm3", "relativePermittivity", "bandgapEv",
    "electronMobilityM2Vs", "holeMobilityM2Vs", "maxIterations",
    "residualTolerance", "conservationTolerance",
  ]) {
    if (!Number.isFinite(config[name]) || config[name] <= 0) {
      errors.push(`${name} must be positive and finite.`);
    }
  }
  if (!Number.isInteger(config.maxIterations)) errors.push("maxIterations must be an integer.");
  if (config.emitterWidthUm + config.baseWidthUm >= config.lengthUm - 0.2) {
    errors.push("Emitter and base widths must leave at least 0.2 um for the collector.");
  }

  let derived = null;
  if (!errors.length) {
    const thermalVoltageV = thermalVoltage(config.temperatureK);
    const epsilonFm = EPS0 * config.relativePermittivity;
    const intrinsicM3 = config.intrinsicDensityCm3 * 1e6;
    const emitterM3 = config.emitterDopingCm3 * 1e6;
    const baseM3 = config.baseDopingCm3 * 1e6;
    const collectorM3 = config.collectorDopingCm3 * 1e6;
    const lengthM = config.lengthUm * 1e-6;
    const heightM = config.heightUm * 1e-6;
    const depthM = config.deviceDepthUm * 1e-6;
    const emitterWidthM = config.emitterWidthUm * 1e-6;
    const baseWidthM = config.baseWidthUm * 1e-6;
    const dxM = lengthM / (config.nx - 1);
    const dyM = heightM / (config.ny - 1);
    const emitterBaseBuiltInV = thermalVoltageV * Math.log(
      emitterM3 * baseM3 / (intrinsicM3 * intrinsicM3),
    );
    const baseCollectorBuiltInV = thermalVoltageV * Math.log(
      collectorM3 * baseM3 / (intrinsicM3 * intrinsicM3),
    );
    const emitterDebyeM = Math.sqrt(
      epsilonFm * KB * config.temperatureK / (Q * Q * emitterM3),
    );
    const baseDebyeM = Math.sqrt(
      epsilonFm * KB * config.temperatureK / (Q * Q * baseM3),
    );
    const collectorDebyeM = Math.sqrt(
      epsilonFm * KB * config.temperatureK / (Q * Q * collectorM3),
    );
    const emitterBaseDepletionM = depletionWidth(
      emitterM3,
      baseM3,
      Math.max(0, emitterBaseBuiltInV - config.baseEmitterVoltageV),
      epsilonFm,
    );
    const baseCollectorVoltageV = config.baseEmitterVoltageV - config.collectorEmitterVoltageV;
    const baseCollectorDepletionM = depletionWidth(
      collectorM3,
      baseM3,
      Math.max(0, baseCollectorBuiltInV - baseCollectorVoltageV),
      epsilonFm,
    );
    const emitterBaseDepletionInBaseM = emitterBaseDepletionM *
      emitterM3 / (emitterM3 + baseM3);
    const baseCollectorDepletionInBaseM = baseCollectorDepletionM *
      collectorM3 / (collectorM3 + baseM3);
    const baseCollectorDepletionInCollectorM = baseCollectorDepletionM *
      baseM3 / (collectorM3 + baseM3);
    const baseContactStartM = emitterWidthM + 0.4 * baseWidthM;
    const baseContactEndM = emitterWidthM + 0.6 * baseWidthM;
    derived = {
      thermalVoltageV,
      epsilonFm,
      intrinsicM3,
      emitterM3,
      baseM3,
      collectorM3,
      lengthM,
      heightM,
      depthM,
      emitterWidthM,
      baseWidthM,
      collectorWidthM: lengthM - emitterWidthM - baseWidthM,
      dxM,
      dyM,
      emitterBaseBuiltInV,
      baseCollectorBuiltInV,
      emitterBaseDepletionM,
      baseCollectorDepletionM,
      emitterBaseDepletionInBaseM,
      baseCollectorDepletionInBaseM,
      baseCollectorDepletionInCollectorM,
      emitterDebyeM,
      baseDebyeM,
      collectorDebyeM,
      baseContactStartM,
      baseContactEndM,
    };

    const minimumDebyeM = Math.min(emitterDebyeM, baseDebyeM, collectorDebyeM);
    if (Math.max(dxM, dyM) > minimumDebyeM / 3) {
      warnings.push("The mesh has fewer than three intervals across the shortest Debye length.");
    }
    if ((baseContactEndM - baseContactStartM) / dxM < 3) {
      warnings.push("The base contact spans fewer than three x intervals.");
    }
    if (emitterBaseDepletionM > 0 && dxM > emitterBaseDepletionM / 20) {
      warnings.push("The emitter-base depletion region has fewer than twenty x intervals.");
    }
    if (baseCollectorDepletionM > 0 && dxM > baseCollectorDepletionM / 20) {
      warnings.push("The base-collector depletion region has fewer than twenty x intervals.");
    }
    if (baseCollectorDepletionInCollectorM > derived.collectorWidthM) {
      warnings.push("The depletion estimate reaches the collector contact; punch-through may affect this bias point.");
    }
    if (emitterBaseDepletionInBaseM + baseCollectorDepletionInBaseM > baseWidthM) {
      warnings.push("The two depletion estimates overlap across the base; the transistor is near punch-through.");
    }
    if (config.baseEmitterVoltageV > 0.9 * emitterBaseBuiltInV) {
      warnings.push("The emitter-base junction approaches high injection for the Boltzmann model.");
    }
    if (config.collectorEmitterVoltageV > config.baseEmitterVoltageV) {
      warnings.push("Avalanche and tunneling are omitted from the reverse-biased collector junction.");
    }
  }

  return { config, errors, warnings, derived };
}

export function solveNpnBjt2D(input = {}, previousSolution = null) {
  const validation = validateNpnConfig(input);
  if (validation.errors.length) throw new RangeError(validation.errors.join(" "));
  const { config } = validation;
  let state = reusableState(previousSolution, config);
  if (!state) {
    state = createEquilibriumState(config);
    if (!state.converged) return finalizeResult(config, state, validation.warnings);
  }

  const targetVbe = config.baseEmitterVoltageV;
  const targetVce = config.collectorEmitterVoltageV;
  const collectorSteps = continuationValues(state.collectorEmitterVoltageV, targetVce, MAX_COLLECTOR_STEP_V);
  for (const collectorVoltageV of collectorSteps) {
    state = solveBiasPoint(config, state, state.baseEmitterVoltageV, collectorVoltageV);
    if (!state.converged) return finalizeResult(config, state, validation.warnings);
  }
  const baseSteps = continuationValues(state.baseEmitterVoltageV, targetVbe, MAX_BASE_STEP_V);
  for (const baseVoltageV of baseSteps) {
    state = solveBiasPoint(config, state, baseVoltageV, state.collectorEmitterVoltageV);
    if (!state.converged) break;
  }
  return finalizeResult(config, state, validation.warnings);
}

export function sweepNpnOutput(input = {}, collectorVoltages = null, previousSolution = null) {
  const validation = validateNpnConfig(input);
  if (validation.errors.length) throw new RangeError(validation.errors.join(" "));
  const requested = collectorVoltages ?? Array.from(
    { length: 9 },
    (_, index) => validation.config.collectorEmitterVoltageV * index / 8,
  );
  const voltages = [...new Set(requested.map(Number))].sort((a, b) => a - b);
  if (!voltages.length) throw new RangeError("At least one collector voltage is required.");
  for (const voltage of voltages) {
    if (!Number.isFinite(voltage) || voltage < LIMITS.collectorEmitterVoltageV[0] ||
      voltage > LIMITS.collectorEmitterVoltageV[1]) {
      throw new RangeError(`Invalid collector voltage: ${voltage}.`);
    }
  }

  let previous = solveNpnBjt2D({
    ...validation.config,
    baseEmitterVoltageV: validation.config.baseEmitterVoltageV,
    collectorEmitterVoltageV: voltages[0],
  }, previousSolution);
  const results = new Map([[voltages[0], previous]]);
  for (const voltage of voltages.slice(1)) {
    previous = solveNpnBjt2D({
      ...validation.config,
      baseEmitterVoltageV: validation.config.baseEmitterVoltageV,
      collectorEmitterVoltageV: voltage,
    }, previous);
    results.set(voltage, previous);
    if (!previous.diagnostics.converged) break;
  }
  const points = voltages.map((voltage) => {
    const result = results.get(voltage) ?? null;
    return {
      collectorEmitterVoltageV: voltage,
      collectorCurrentA: result?.terminalCurrents.collector.currentIntoDeviceA ?? NaN,
      baseCurrentA: result?.terminalCurrents.base.currentIntoDeviceA ?? NaN,
      emitterCurrentA: result ? -result.terminalCurrents.emitter.currentIntoDeviceA : NaN,
      converged: result?.diagnostics.converged ?? false,
      result,
    };
  });
  return {
    config: validation.config,
    points,
    converged: points.every((point) => point.converged),
    warnings: validation.warnings,
  };
}

export function sweepNpnOutputFamily(input = {}, baseVoltages = null, collectorVoltages = null) {
  const validation = validateNpnConfig(input);
  if (validation.errors.length) throw new RangeError(validation.errors.join(" "));
  const requestedBase = baseVoltages ?? [
    Math.max(0, validation.config.baseEmitterVoltageV - 0.06),
    Math.max(0, validation.config.baseEmitterVoltageV - 0.03),
    validation.config.baseEmitterVoltageV,
  ];
  const curves = [];
  let previousAtZero = null;
  for (const baseEmitterVoltageV of requestedBase) {
    const sweep = sweepNpnOutput(
      { ...validation.config, baseEmitterVoltageV },
      collectorVoltages,
      previousAtZero,
    );
    curves.push({ baseEmitterVoltageV, ...sweep });
    previousAtZero = sweep.points[0]?.result ?? null;
    if (!sweep.converged) break;
  }
  return { config: validation.config, curves, converged: curves.every((curve) => curve.converged) };
}

export function serializeNpnProfileCsv(result) {
  if (!result?.diagnostics?.converged) throw new Error("Only converged NPN results can be exported.");
  const lines = [
    "# model=2D lateral NPN Poisson-continuity Scharfetter-Gummel SRH",
    `# V_BE_V=${result.config.baseEmitterVoltageV}`,
    `# V_CE_V=${result.config.collectorEmitterVoltageV}`,
    `# nx=${result.config.nx},ny=${result.config.ny}`,
    `# device_depth_um=${result.config.deviceDepthUm}`,
    "x_um,y_um,contact_id,doping_cm-3,potential_V,charge_C_m-3,Ex_V_m,Ey_V_m,electron_cm-3,hole_cm-3,recombination_m-3_s-1,Jn_x_A_m-2,Jn_y_A_m-2,Jp_x_A_m-2,Jp_y_A_m-2,J_x_A_m-2,J_y_A_m-2",
  ];
  for (let iy = 0; iy < result.ny; iy += 1) {
    for (let ix = 0; ix < result.nx; ix += 1) {
      const index = iy * result.nx + ix;
      lines.push([
        result.xM[ix] * 1e6,
        result.yM[iy] * 1e6,
        result.contact[index],
        result.dopingM3[index] / 1e6,
        result.potentialV[index],
        result.chargeDensityCm3[index],
        result.electricFieldXVm[index],
        result.electricFieldYVm[index],
        result.electronM3[index] / 1e6,
        result.holeM3[index] / 1e6,
        result.recombinationM3s[index],
        result.electronCurrentDensityXAm2[index],
        result.electronCurrentDensityYAm2[index],
        result.holeCurrentDensityXAm2[index],
        result.holeCurrentDensityYAm2[index],
        result.totalCurrentDensityXAm2[index],
        result.totalCurrentDensityYAm2[index],
      ].join(","));
    }
  }
  return `${lines.join("\n")}\n`;
}

export function serializeNpnSweepCsv(sweep) {
  if (!sweep?.converged) throw new Error("Only converged NPN sweeps can be exported.");
  const lines = [
    "# model=2D lateral NPN Poisson-continuity Scharfetter-Gummel SRH",
    `# V_BE_V=${sweep.config.baseEmitterVoltageV}`,
    `# device_depth_um=${sweep.config.deviceDepthUm}`,
    "V_CE_V,I_C_A,I_B_A,I_E_A",
    ...sweep.points.map((point) => [
      point.collectorEmitterVoltageV,
      point.collectorCurrentA,
      point.baseCurrentA,
      point.emitterCurrentA,
    ].join(",")),
  ];
  return `${lines.join("\n")}\n`;
}

function createEquilibriumState(config) {
  const geometry = createGeometry(config);
  const potential = new Float64Array(geometry.size);
  const electron = new Float64Array(geometry.size);
  const hole = new Float64Array(geometry.size);
  for (let index = 0; index < geometry.size; index += 1) {
    const pair = neutralCarrierPair(geometry.dopant[index]);
    potential[index] = pair.potential;
    electron[index] = pair.electron;
    hole[index] = pair.hole;
  }
  const state = {
    ...geometry,
    potential,
    electron,
    hole,
    baseEmitterVoltageV: 0,
    collectorEmitterVoltageV: 0,
    converged: false,
    iterations: 0,
    totalIterations: 0,
    damping: 0.5,
    metrics: null,
  };
  enforceContacts(config, state);
  const poisson = solvePoisson(config, state, true);
  if (!poisson.success) {
    state.metrics = failedMetrics(poisson.reason);
    return state;
  }
  state.potential.set(poisson.potential);
  for (let index = 0; index < state.size; index += 1) {
    state.electron[index] = expSafe(state.potential[index]);
    state.hole[index] = expSafe(-state.potential[index]);
  }
  enforceContacts(config, state);
  state.metrics = equationMetrics(config, state);
  state.converged = metricsConverged(config, state.metrics);
  if (!state.converged) state.metrics.failureReason = "Equilibrium did not satisfy the coupled residuals.";
  return state;
}

function createGeometry(config) {
  const { derived } = validateNpnConfig(config);
  const size = config.nx * config.ny;
  const dopant = new Float64Array(size);
  const contact = new Uint8Array(size);
  const volumeM2 = new Float64Array(size);
  const westGeometry = new Float64Array(size);
  const eastGeometry = new Float64Array(size);
  const northGeometry = new Float64Array(size);
  const southGeometry = new Float64Array(size);
  for (let iy = 0; iy < config.ny; iy += 1) {
    const controlHeightM = derived.dyM * (iy === 0 || iy === config.ny - 1 ? 0.5 : 1);
    for (let ix = 0; ix < config.nx; ix += 1) {
      const index = iy * config.nx + ix;
      const xM = ix * derived.dxM;
      const controlWidthM = derived.dxM * (ix === 0 || ix === config.nx - 1 ? 0.5 : 1);
      volumeM2[index] = controlWidthM * controlHeightM;
      if (xM < derived.emitterWidthM) dopant[index] = derived.emitterM3 / derived.intrinsicM3;
      else if (xM < derived.emitterWidthM + derived.baseWidthM) {
        dopant[index] = -derived.baseM3 / derived.intrinsicM3;
      } else dopant[index] = derived.collectorM3 / derived.intrinsicM3;

      if (ix === 0) contact[index] = CONTACT_EMITTER;
      else if (ix === config.nx - 1) contact[index] = CONTACT_COLLECTOR;
      else if (iy === 0 && xM >= derived.baseContactStartM && xM <= derived.baseContactEndM) {
        contact[index] = CONTACT_BASE;
      }
      if (ix > 0) westGeometry[index] = controlHeightM / derived.dxM;
      if (ix + 1 < config.nx) eastGeometry[index] = controlHeightM / derived.dxM;
      if (iy > 0) northGeometry[index] = controlWidthM / derived.dyM;
      if (iy + 1 < config.ny) southGeometry[index] = controlWidthM / derived.dyM;
    }
  }
  return {
    nx: config.nx,
    ny: config.ny,
    size,
    dopant,
    contact,
    volumeM2,
    westGeometry,
    eastGeometry,
    northGeometry,
    southGeometry,
  };
}

function solveBiasPoint(config, previousState, baseEmitterVoltageV, collectorEmitterVoltageV) {
  const state = cloneState(previousState);
  predictBiasShift(
    config,
    state,
    baseEmitterVoltageV - previousState.baseEmitterVoltageV,
    collectorEmitterVoltageV - previousState.collectorEmitterVoltageV,
  );
  state.baseEmitterVoltageV = baseEmitterVoltageV;
  state.collectorEmitterVoltageV = collectorEmitterVoltageV;
  state.converged = false;
  state.iterations = 0;
  enforceContacts(config, state);
  let damping = Math.min(1, Math.max(0.0625, previousState.damping || 0.5));
  let previousScore = Infinity;

  for (let iteration = 1; iteration <= config.maxIterations; iteration += 1) {
    const oldPotential = Float64Array.from(state.potential);
    const oldElectron = Float64Array.from(state.electron);
    const oldHole = Float64Array.from(state.hole);
    const poisson = solvePoisson(config, state, false);
    if (!poisson.success) {
      state.metrics = failedMetrics(poisson.reason);
      break;
    }
    const electronCandidate = solveCarrier(config, state, poisson.potential, oldElectron, oldHole, true);
    if (!electronCandidate.success) {
      state.metrics = failedMetrics(electronCandidate.reason);
      break;
    }
    const holeCandidate = solveCarrier(
      config,
      state,
      poisson.potential,
      electronCandidate.density,
      oldHole,
      false,
    );
    if (!holeCandidate.success) {
      state.metrics = failedMetrics(holeCandidate.reason);
      break;
    }
    mixState(
      state,
      oldPotential,
      oldElectron,
      oldHole,
      poisson.potential,
      electronCandidate.density,
      holeCandidate.density,
      damping,
    );
    enforceContacts(config, state);
    const metrics = equationMetrics(config, state);
    const score = Math.max(
      metrics.poissonResidual,
      metrics.electronResidual,
      metrics.holeResidual,
    );
    if (score > previousScore * 1.5 && damping > 0.0625) {
      state.potential.set(oldPotential);
      state.electron.set(oldElectron);
      state.hole.set(oldHole);
      damping *= 0.5;
      continue;
    }
    state.metrics = metrics;
    state.iterations = iteration;
    state.totalIterations = previousState.totalIterations + iteration;
    state.damping = damping;
    previousScore = score;
    if (metricsConverged(config, metrics)) {
      state.converged = true;
      break;
    }
    if (iteration % 8 === 0 && score < 1e-3 && damping < 1) damping = Math.min(1, damping * 1.25);
  }
  if (!state.metrics) state.metrics = failedMetrics("The numerical state could not be evaluated.");
  if (!state.converged && !state.metrics.failureReason) {
    state.metrics.failureReason = `Did not converge within ${config.maxIterations} Gummel iterations.`;
  }
  return state;
}

function predictBiasShift(config, state, baseVoltageChangeV, collectorVoltageChangeV) {
  const { derived } = validateNpnConfig(config);
  const baseEndM = derived.emitterWidthM + derived.baseWidthM;
  for (let iy = 0; iy < state.ny; iy += 1) {
    for (let ix = 0; ix < state.nx; ix += 1) {
      const index = iy * state.nx + ix;
      const xM = ix * derived.dxM;
      const baseWeight = xM < derived.emitterWidthM
        ? xM / derived.emitterWidthM
        : xM <= baseEndM
          ? 1
          : Math.max(0, (derived.lengthM - xM) / derived.collectorWidthM);
      const collectorWeight = xM <= baseEndM
        ? 0
        : (xM - baseEndM) / derived.collectorWidthM;
      state.potential[index] += (baseVoltageChangeV * baseWeight +
        collectorVoltageChangeV * collectorWeight) / derived.thermalVoltageV;
    }
  }
}

function solvePoisson(config, state, equilibrium) {
  const { derived } = validateNpnConfig({
    ...config,
    baseEmitterVoltageV: state.baseEmitterVoltageV,
    collectorEmitterVoltageV: state.collectorEmitterVoltageV,
  });
  const potential = Float64Array.from(state.potential);
  const etaElectron = new Float64Array(state.size);
  const etaHole = new Float64Array(state.size);
  for (let index = 0; index < state.size; index += 1) {
    etaElectron[index] = equilibrium ? 0 : Math.log(state.electron[index]) - state.potential[index];
    etaHole[index] = equilibrium ? 0 : Math.log(state.hole[index]) + state.potential[index];
  }
  const free = freeMask(state.contact);
  let previousResidual = Infinity;
  for (let newton = 0; newton < 50; newton += 1) {
    enforceContactPotential(config, state, potential);
    const diagonal = new Float64Array(state.size);
    const rhs = new Float64Array(state.size);
    let residualNorm = 0;
    for (let index = 0; index < state.size; index += 1) {
      if (!free[index]) {
        diagonal[index] = 1;
        continue;
      }
      const electron = expSafe(potential[index] + etaElectron[index]);
      const hole = expSafe(-potential[index] + etaHole[index]);
      const electrostatic = neighborSum(state, potential, index, config.relativePermittivity);
      const sourceScale = state.volumeM2[index] * Q * derived.intrinsicM3 /
        (EPS0 * derived.thermalVoltageV);
      const charge = hole - electron + state.dopant[index];
      const residual = electrostatic - sourceScale * charge;
      diagonal[index] = geometrySum(state, index, config.relativePermittivity) +
        sourceScale * (electron + hole);
      rhs[index] = -residual;
      const scale = Math.max(1, Math.abs(electrostatic), Math.abs(sourceScale * charge));
      residualNorm = Math.max(residualNorm, Math.abs(residual) / scale);
    }
    const linear = solvePcg(
      state, diagonal, rhs, free, null, 900, 1e-12, null, null, config.relativePermittivity,
    );
    if (!linear.success) return { success: false, reason: `Poisson linear solve failed: ${linear.reason}` };
    let maximumCorrection = 0;
    for (let index = 0; index < state.size; index += 1) {
      if (free[index]) maximumCorrection = Math.max(maximumCorrection, Math.abs(linear.solution[index]));
    }
    let step = Math.min(1, 1 / Math.max(1, maximumCorrection));
    if (residualNorm > previousResidual * 1.2) step *= 0.5;
    for (let index = 0; index < state.size; index += 1) {
      if (free[index]) potential[index] += step * linear.solution[index];
    }
    previousResidual = residualNorm;
    if (maximumCorrection * step < 1e-10 && residualNorm < 1e-9) break;
  }
  if (!finiteArray(potential)) return { success: false, reason: "Poisson produced NaN or infinity." };
  return { success: true, potential };
}

function solveCarrier(config, state, potential, electron, hole, solveElectron) {
  const { derived } = validateNpnConfig({
    ...config,
    baseEmitterVoltageV: state.baseEmitterVoltageV,
    collectorEmitterVoltageV: state.collectorEmitterVoltageV,
  });
  const free = freeMask(state.contact);
  const variable = new Float64Array(state.size);
  const diagonal = new Float64Array(state.size);
  const rhs = new Float64Array(state.size);
  const mobility = solveElectron ? config.electronMobilityM2Vs : config.holeMobilityM2Vs;
  for (let index = 0; index < state.size; index += 1) {
    variable[index] = solveElectron
      ? electron[index] * expSafe(-potential[index])
      : hole[index] * expSafe(potential[index]);
  }
  enforceContactSlotboom(config, state, potential, variable, solveElectron);

  for (let index = 0; index < state.size; index += 1) {
    if (!free[index]) {
      diagonal[index] = 1;
      rhs[index] = variable[index];
      continue;
    }
    const srh = srhNormalized(electron[index], hole[index], config);
    const densityPerVariable = solveElectron ? expSafe(potential[index]) : expSafe(-potential[index]);
    const derivative = (solveElectron
      ? srhElectronDerivative(electron[index], hole[index], config)
      : srhHoleDerivative(electron[index], hole[index], config)) * densityPerVariable;
    const constant = srh - derivative * variable[index];
    const sourceScale = state.volumeM2[index] / (mobility * derived.thermalVoltageV);
    let sum = 0;
    forEachNeighbor(state, index, (neighbor, geometry) => {
      const conductance = carrierConductance(
        potential[index], potential[neighbor], geometry, solveElectron,
      );
      sum += conductance;
      if (!free[neighbor]) rhs[index] += conductance * variable[neighbor];
    });
    diagonal[index] = sum + sourceScale * derivative;
    rhs[index] -= sourceScale * constant;
  }
  const linear = solvePcg(state, diagonal, rhs, free, variable, 1200, 1e-12, potential, solveElectron);
  if (!linear.success) return { success: false, reason: `${solveElectron ? "Electron" : "Hole"} solve failed: ${linear.reason}` };
  const density = solveElectron ? Float64Array.from(electron) : Float64Array.from(hole);
  for (let index = 0; index < state.size; index += 1) {
    if (!free[index]) continue;
    density[index] = (solveElectron ? expSafe(potential[index]) : expSafe(-potential[index])) *
      linear.solution[index];
    if (!Number.isFinite(density[index]) || density[index] <= 0) {
      return { success: false, reason: "The carrier solve produced a non-positive or non-finite density." };
    }
  }
  return { success: true, density };
}

function equationMetrics(config, state) {
  const validation = validateNpnConfig({
    ...config,
    baseEmitterVoltageV: state.baseEmitterVoltageV,
    collectorEmitterVoltageV: state.collectorEmitterVoltageV,
  });
  const { derived } = validation;
  let poissonResidual = 0;
  let electronResidual = 0;
  let holeResidual = 0;
  let integratedRecombinationAm = 0;
  for (let index = 0; index < state.size; index += 1) {
    if (state.contact[index] !== CONTACT_NONE) continue;
    const charge = state.hole[index] - state.electron[index] + state.dopant[index];
    const electrostatic = neighborSum(state, state.potential, index, config.relativePermittivity);
    const poissonSource = state.volumeM2[index] * Q * derived.intrinsicM3 /
      (EPS0 * derived.thermalVoltageV) * charge;
    poissonResidual = Math.max(
      poissonResidual,
      Math.abs(electrostatic - poissonSource) /
        Math.max(1, Math.abs(electrostatic), Math.abs(poissonSource)),
    );
    const srh = srhNormalized(state.electron[index], state.hole[index], config);
    const electronSource = state.volumeM2[index] /
      (config.electronMobilityM2Vs * derived.thermalVoltageV) * srh;
    const holeSource = state.volumeM2[index] /
      (config.holeMobilityM2Vs * derived.thermalVoltageV) * srh;
    let electronFlux = 0;
    let holeFlux = 0;
    let electronMagnitude = 1;
    let holeMagnitude = 1;
    forEachNeighbor(state, index, (neighbor, geometry) => {
      const electronFace = electronFluxIntegratedNormalized(state, index, neighbor, geometry);
      const holeFace = holeFluxIntegratedNormalized(state, index, neighbor, geometry);
      electronFlux += electronFace;
      holeFlux += holeFace;
      electronMagnitude = Math.max(electronMagnitude, Math.abs(electronFace));
      holeMagnitude = Math.max(holeMagnitude, Math.abs(holeFace));
    });
    electronResidual = Math.max(
      electronResidual,
      Math.abs(electronFlux - electronSource) /
        Math.max(electronMagnitude, Math.abs(electronSource)),
    );
    holeResidual = Math.max(
      holeResidual,
      Math.abs(holeFlux + holeSource) /
        Math.max(holeMagnitude, Math.abs(holeSource)),
    );
    integratedRecombinationAm += Q * derived.intrinsicM3 * srh * state.volumeM2[index];
  }
  const terminalCurrents = terminalCurrentsPerDepth(config, state, derived);
  const terminalTotalAm = terminalCurrents.emitter.totalAm +
    terminalCurrents.base.totalAm + terminalCurrents.collector.totalAm;
  const electronTerminalAm = terminalCurrents.emitter.electronAm +
    terminalCurrents.base.electronAm + terminalCurrents.collector.electronAm;
  const holeTerminalAm = terminalCurrents.emitter.holeAm +
    terminalCurrents.base.holeAm + terminalCurrents.collector.holeAm;
  const characteristicCurrentAm = Q * derived.intrinsicM3 * derived.thermalVoltageV *
    (config.electronMobilityM2Vs + config.holeMobilityM2Vs) * derived.heightM / derived.lengthM;
  const absoluteToleranceAm = Math.max(
    1e-18,
    characteristicCurrentAm * config.residualTolerance,
    4 * characteristicCurrentAm * Math.sqrt(Number.EPSILON * state.size),
  );
  const currentScaleAm = Math.max(
    Math.abs(terminalCurrents.emitter.totalAm),
    Math.abs(terminalCurrents.base.totalAm),
    Math.abs(terminalCurrents.collector.totalAm),
    absoluteToleranceAm / config.conservationTolerance,
  );
  const balanceScaleAm = Math.max(
    Math.abs(integratedRecombinationAm),
    Math.abs(electronTerminalAm),
    Math.abs(holeTerminalAm),
    absoluteToleranceAm / config.conservationTolerance,
  );
  return {
    converged: false,
    poissonResidual,
    electronResidual,
    holeResidual,
    terminalKclError: Math.abs(terminalTotalAm) / currentScaleAm,
    terminalKclAbsoluteErrorAm: Math.abs(terminalTotalAm),
    terminalKclAbsoluteToleranceAm: absoluteToleranceAm,
    electronBalanceError: Math.abs(electronTerminalAm + integratedRecombinationAm) / balanceScaleAm,
    holeBalanceError: Math.abs(holeTerminalAm - integratedRecombinationAm) / balanceScaleAm,
    integratedRecombinationAm,
    terminalCurrents,
    failureReason: "",
  };
}

function terminalCurrentsPerDepth(config, state, derived) {
  const currents = {
    emitter: { electronAm: 0, holeAm: 0, totalAm: 0 },
    base: { electronAm: 0, holeAm: 0, totalAm: 0 },
    collector: { electronAm: 0, holeAm: 0, totalAm: 0 },
  };
  const names = [null, "emitter", "base", "collector"];
  for (let index = 0; index < state.size; index += 1) {
    const contactId = state.contact[index];
    if (contactId === CONTACT_NONE) continue;
    const terminal = currents[names[contactId]];
    forEachNeighbor(state, index, (neighbor, geometry) => {
      if (state.contact[neighbor] === contactId) return;
      const electronAm = Q * config.electronMobilityM2Vs * derived.thermalVoltageV *
        derived.intrinsicM3 * electronFluxIntegratedNormalized(state, index, neighbor, geometry);
      const holeAm = Q * config.holeMobilityM2Vs * derived.thermalVoltageV *
        derived.intrinsicM3 * holeFluxIntegratedNormalized(state, index, neighbor, geometry);
      terminal.electronAm += electronAm;
      terminal.holeAm += holeAm;
    });
    terminal.totalAm = terminal.electronAm + terminal.holeAm;
  }
  return currents;
}

function currentDensityAtNodes(config, state, derived) {
  const electronCurrentDensityXAm2 = new Float64Array(state.size);
  const electronCurrentDensityYAm2 = new Float64Array(state.size);
  const holeCurrentDensityXAm2 = new Float64Array(state.size);
  const holeCurrentDensityYAm2 = new Float64Array(state.size);
  const totalCurrentDensityXAm2 = new Float64Array(state.size);
  const totalCurrentDensityYAm2 = new Float64Array(state.size);
  const electronScaleX = Q * config.electronMobilityM2Vs * derived.thermalVoltageV *
    derived.intrinsicM3 / derived.dxM;
  const electronScaleY = Q * config.electronMobilityM2Vs * derived.thermalVoltageV *
    derived.intrinsicM3 / derived.dyM;
  const holeScaleX = Q * config.holeMobilityM2Vs * derived.thermalVoltageV *
    derived.intrinsicM3 / derived.dxM;
  const holeScaleY = Q * config.holeMobilityM2Vs * derived.thermalVoltageV *
    derived.intrinsicM3 / derived.dyM;

  for (let iy = 0; iy < state.ny; iy += 1) {
    for (let ix = 0; ix < state.nx; ix += 1) {
      const index = iy * state.nx + ix;
      const west = index - 1;
      const east = index + 1;
      const north = index - state.nx;
      const south = index + state.nx;
      const xFaces = ix > 0 && ix + 1 < state.nx ? 2 : 1;
      const yFaces = iy > 0 && iy + 1 < state.ny ? 2 : 1;
      if (ix > 0) {
        electronCurrentDensityXAm2[index] += electronScaleX *
          electronFluxIntegratedNormalized(state, west, index, 1);
        holeCurrentDensityXAm2[index] += holeScaleX *
          holeFluxIntegratedNormalized(state, west, index, 1);
      }
      if (ix + 1 < state.nx) {
        electronCurrentDensityXAm2[index] += electronScaleX *
          electronFluxIntegratedNormalized(state, index, east, 1);
        holeCurrentDensityXAm2[index] += holeScaleX *
          holeFluxIntegratedNormalized(state, index, east, 1);
      }
      if (iy > 0) {
        electronCurrentDensityYAm2[index] += electronScaleY *
          electronFluxIntegratedNormalized(state, north, index, 1);
        holeCurrentDensityYAm2[index] += holeScaleY *
          holeFluxIntegratedNormalized(state, north, index, 1);
      }
      if (iy + 1 < state.ny) {
        electronCurrentDensityYAm2[index] += electronScaleY *
          electronFluxIntegratedNormalized(state, index, south, 1);
        holeCurrentDensityYAm2[index] += holeScaleY *
          holeFluxIntegratedNormalized(state, index, south, 1);
      }
      electronCurrentDensityXAm2[index] /= xFaces;
      electronCurrentDensityYAm2[index] /= yFaces;
      holeCurrentDensityXAm2[index] /= xFaces;
      holeCurrentDensityYAm2[index] /= yFaces;
      totalCurrentDensityXAm2[index] = electronCurrentDensityXAm2[index] +
        holeCurrentDensityXAm2[index];
      totalCurrentDensityYAm2[index] = electronCurrentDensityYAm2[index] +
        holeCurrentDensityYAm2[index];
    }
  }
  return {
    electronCurrentDensityXAm2,
    electronCurrentDensityYAm2,
    holeCurrentDensityXAm2,
    holeCurrentDensityYAm2,
    totalCurrentDensityXAm2,
    totalCurrentDensityYAm2,
  };
}

function finalizeResult(config, state, baseWarnings) {
  const validation = validateNpnConfig({
    ...config,
    baseEmitterVoltageV: state.baseEmitterVoltageV,
    collectorEmitterVoltageV: state.collectorEmitterVoltageV,
  });
  const { derived } = validation;
  const xM = Float64Array.from({ length: state.nx }, (_, ix) => ix * derived.dxM);
  const yM = Float64Array.from({ length: state.ny }, (_, iy) => iy * derived.dyM);
  const dopingM3 = new Float64Array(state.size);
  const potentialV = new Float64Array(state.size);
  const electronM3 = new Float64Array(state.size);
  const holeM3 = new Float64Array(state.size);
  const chargeDensityCm3 = new Float64Array(state.size);
  const recombinationM3s = new Float64Array(state.size);
  const electricFieldXVm = new Float64Array(state.size);
  const electricFieldYVm = new Float64Array(state.size);
  for (let iy = 0; iy < state.ny; iy += 1) {
    for (let ix = 0; ix < state.nx; ix += 1) {
      const index = iy * state.nx + ix;
      dopingM3[index] = state.dopant[index] * derived.intrinsicM3;
      potentialV[index] = state.potential[index] * derived.thermalVoltageV;
      electronM3[index] = state.electron[index] * derived.intrinsicM3;
      holeM3[index] = state.hole[index] * derived.intrinsicM3;
      chargeDensityCm3[index] = Q * (holeM3[index] - electronM3[index] + dopingM3[index]);
      recombinationM3s[index] = derived.intrinsicM3 *
        srhNormalized(state.electron[index], state.hole[index], config);
      const west = iy * state.nx + Math.max(0, ix - 1);
      const east = iy * state.nx + Math.min(state.nx - 1, ix + 1);
      const north = Math.max(0, iy - 1) * state.nx + ix;
      const south = Math.min(state.ny - 1, iy + 1) * state.nx + ix;
      const xWidth = (ix > 0 && ix + 1 < state.nx ? 2 : 1) * derived.dxM;
      const yWidth = (iy > 0 && iy + 1 < state.ny ? 2 : 1) * derived.dyM;
      electricFieldXVm[index] = -(potentialV[east] - potentialV[west]) / xWidth;
      electricFieldYVm[index] = -(potentialV[south] - potentialV[north]) / yWidth;
    }
  }
  const currentDensity = currentDensityAtNodes(config, state, derived);
  const metrics = { ...state.metrics };
  metrics.converged = state.converged;
  metrics.iterations = state.iterations;
  metrics.totalIterations = state.totalIterations;
  metrics.damping = state.damping;
  const terminalCurrents = {};
  for (const [name, current] of Object.entries(metrics.terminalCurrents ?? {
    emitter: { electronAm: NaN, holeAm: NaN, totalAm: NaN },
    base: { electronAm: NaN, holeAm: NaN, totalAm: NaN },
    collector: { electronAm: NaN, holeAm: NaN, totalAm: NaN },
  })) {
    terminalCurrents[name] = {
      ...current,
      electronCurrentA: current.electronAm * derived.depthM,
      holeCurrentA: current.holeAm * derived.depthM,
      currentIntoDeviceA: current.totalAm * derived.depthM,
    };
  }
  const warnings = [...new Set([...baseWarnings, ...validation.warnings])];
  if (!state.converged) warnings.push(metrics.failureReason || "The NPN solution did not converge.");
  return {
    config: {
      ...config,
      baseEmitterVoltageV: state.baseEmitterVoltageV,
      collectorEmitterVoltageV: state.collectorEmitterVoltageV,
    },
    nx: state.nx,
    ny: state.ny,
    xM,
    yM,
    dopingM3,
    potentialV,
    electronM3,
    holeM3,
    chargeDensityCm3,
    recombinationM3s,
    electricFieldXVm,
    electricFieldYVm,
    ...currentDensity,
    contact: Uint8Array.from(state.contact),
    normalizedPotential: Float64Array.from(state.potential),
    normalizedElectron: Float64Array.from(state.electron),
    normalizedHole: Float64Array.from(state.hole),
    normalizedDoping: Float64Array.from(state.dopant),
    diagnostics: metrics,
    terminalCurrents,
    derived,
    warnings,
    assumptions: [
      "Lateral 2D silicon NPN with ohmic emitter, base, and collector contacts.",
      "Boltzmann statistics, complete ionization, constant mobility, and midgap SRH.",
      "No avalanche, tunneling, bandgap narrowing, Auger recombination, self-heating, or contact resistance.",
    ],
  };
}

function enforceContacts(config, state) {
  enforceContactPotential(config, state, state.potential);
  const { derived } = validateNpnConfig({
    ...config,
    baseEmitterVoltageV: state.baseEmitterVoltageV,
    collectorEmitterVoltageV: state.collectorEmitterVoltageV,
  });
  for (let index = 0; index < state.size; index += 1) {
    if (state.contact[index] === CONTACT_NONE) continue;
    const pair = neutralCarrierPair(state.dopant[index]);
    state.electron[index] = pair.electron;
    state.hole[index] = pair.hole;
    const voltage = contactVoltage(state.contact[index], state);
    state.potential[index] = pair.potential + voltage / derived.thermalVoltageV;
  }
}

function enforceContactPotential(config, state, potential) {
  const { derived } = validateNpnConfig({
    ...config,
    baseEmitterVoltageV: state.baseEmitterVoltageV,
    collectorEmitterVoltageV: state.collectorEmitterVoltageV,
  });
  for (let index = 0; index < state.size; index += 1) {
    if (state.contact[index] === CONTACT_NONE) continue;
    const pair = neutralCarrierPair(state.dopant[index]);
    potential[index] = pair.potential + contactVoltage(state.contact[index], state) /
      derived.thermalVoltageV;
  }
}

function enforceContactSlotboom(config, state, potential, variable, electronVariable) {
  for (let index = 0; index < state.size; index += 1) {
    if (state.contact[index] === CONTACT_NONE) continue;
    const pair = neutralCarrierPair(state.dopant[index]);
    variable[index] = electronVariable
      ? pair.electron * expSafe(-potential[index])
      : pair.hole * expSafe(potential[index]);
  }
}

function contactVoltage(contact, state) {
  if (contact === CONTACT_BASE) return state.baseEmitterVoltageV;
  if (contact === CONTACT_COLLECTOR) return state.collectorEmitterVoltageV;
  return 0;
}

function mixState(state, oldPotential, oldElectron, oldHole, potential, electron, hole, damping) {
  for (let index = 0; index < state.size; index += 1) {
    if (state.contact[index] !== CONTACT_NONE) continue;
    state.potential[index] = oldPotential[index] + damping * (potential[index] - oldPotential[index]);
    state.electron[index] = Math.exp(
      Math.log(oldElectron[index]) + damping * (Math.log(electron[index]) - Math.log(oldElectron[index])),
    );
    state.hole[index] = Math.exp(
      Math.log(oldHole[index]) + damping * (Math.log(hole[index]) - Math.log(oldHole[index])),
    );
  }
}

function solvePcg(
  state,
  diagonal,
  rhs,
  free,
  initial,
  maxIterations,
  tolerance,
  potential = null,
  electron = null,
  geometryMultiplier = 1,
) {
  const solution = initial ? Float64Array.from(initial) : new Float64Array(state.size);
  for (let index = 0; index < state.size; index += 1) if (!free[index]) solution[index] = 0;
  const residual = new Float64Array(state.size);
  const preconditioned = new Float64Array(state.size);
  const direction = new Float64Array(state.size);
  const product = new Float64Array(state.size);
  applyMatrix(state, diagonal, free, solution, product, potential, electron, geometryMultiplier);
  let rhsNorm2 = 0;
  for (let index = 0; index < state.size; index += 1) {
    if (!free[index]) continue;
    residual[index] = rhs[index] - product[index];
    rhsNorm2 += rhs[index] * rhs[index];
  }
  applySsorPreconditioner(
    state, diagonal, free, residual, preconditioned, potential, electron, geometryMultiplier,
  );
  direction.set(preconditioned);
  let rz = dotFree(residual, preconditioned, free);
  const reference = Math.sqrt(Math.max(rhsNorm2, Number.MIN_VALUE));
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    applyMatrix(state, diagonal, free, direction, product, potential, electron, geometryMultiplier);
    let denominator = 0;
    for (let index = 0; index < state.size; index += 1) {
      if (free[index]) denominator += direction[index] * product[index];
    }
    if (!Number.isFinite(denominator) || denominator <= 0 || !Number.isFinite(rz)) {
      return { success: false, reason: "PCG lost positive definiteness.", solution };
    }
    const alpha = rz / denominator;
    let residualNorm2 = 0;
    for (let index = 0; index < state.size; index += 1) {
      if (!free[index]) continue;
      solution[index] += alpha * direction[index];
      residual[index] -= alpha * product[index];
      residualNorm2 += residual[index] * residual[index];
    }
    if (Math.sqrt(residualNorm2) / reference < tolerance) {
      return { success: true, solution, iterations: iteration + 1 };
    }
    applySsorPreconditioner(
      state, diagonal, free, residual, preconditioned, potential, electron, geometryMultiplier,
    );
    const nextRz = dotFree(residual, preconditioned, free);
    const beta = nextRz / rz;
    for (let index = 0; index < state.size; index += 1) {
      if (free[index]) direction[index] = preconditioned[index] + beta * direction[index];
    }
    rz = nextRz;
  }
  return { success: false, reason: `PCG exceeded ${maxIterations} iterations.`, solution };
}

function applySsorPreconditioner(
  state,
  diagonal,
  free,
  residual,
  output,
  potential,
  electronVariable,
  geometryMultiplier,
) {
  output.fill(0);
  for (let index = 0; index < state.size; index += 1) {
    if (!free[index]) continue;
    const ix = index % state.nx;
    const iy = (index / state.nx) | 0;
    let value = residual[index];
    if (ix > 0 && free[index - 1]) {
      value += matrixConductance(
        state, index, index - 1, state.westGeometry[index], potential,
        electronVariable, geometryMultiplier,
      ) * output[index - 1];
    }
    if (iy > 0 && free[index - state.nx]) {
      value += matrixConductance(
        state, index, index - state.nx, state.northGeometry[index], potential,
        electronVariable, geometryMultiplier,
      ) * output[index - state.nx];
    }
    output[index] = value / diagonal[index];
  }
  for (let index = state.size - 1; index >= 0; index -= 1) {
    if (!free[index]) continue;
    const ix = index % state.nx;
    const iy = (index / state.nx) | 0;
    let value = diagonal[index] * output[index];
    if (ix + 1 < state.nx && free[index + 1]) {
      value += matrixConductance(
        state, index, index + 1, state.eastGeometry[index], potential,
        electronVariable, geometryMultiplier,
      ) * output[index + 1];
    }
    if (iy + 1 < state.ny && free[index + state.nx]) {
      value += matrixConductance(
        state, index, index + state.nx, state.southGeometry[index], potential,
        electronVariable, geometryMultiplier,
      ) * output[index + state.nx];
    }
    output[index] = value / diagonal[index];
  }
}

function matrixConductance(
  state,
  index,
  neighbor,
  geometry,
  potential,
  electronVariable,
  geometryMultiplier,
) {
  return potential
    ? carrierConductance(potential[index], potential[neighbor], geometry, electronVariable)
    : geometryMultiplier * geometry;
}

function dotFree(left, right, free) {
  let value = 0;
  for (let index = 0; index < free.length; index += 1) {
    if (free[index]) value += left[index] * right[index];
  }
  return value;
}

function applyMatrix(
  state,
  diagonal,
  free,
  vector,
  output,
  potential,
  electronVariable,
  geometryMultiplier,
) {
  output.fill(0);
  for (let index = 0; index < state.size; index += 1) {
    if (!free[index]) continue;
    let value = diagonal[index] * vector[index];
    const ix = index % state.nx;
    const iy = (index / state.nx) | 0;
    if (ix > 0 && free[index - 1]) {
      const conductance = potential
        ? carrierConductance(
          potential[index], potential[index - 1], state.westGeometry[index], electronVariable,
        )
        : geometryMultiplier * state.westGeometry[index];
      value -= conductance * vector[index - 1];
    }
    if (ix + 1 < state.nx && free[index + 1]) {
      const conductance = potential
        ? carrierConductance(
          potential[index], potential[index + 1], state.eastGeometry[index], electronVariable,
        )
        : geometryMultiplier * state.eastGeometry[index];
      value -= conductance * vector[index + 1];
    }
    if (iy > 0 && free[index - state.nx]) {
      const conductance = potential
        ? carrierConductance(
          potential[index], potential[index - state.nx], state.northGeometry[index], electronVariable,
        )
        : geometryMultiplier * state.northGeometry[index];
      value -= conductance * vector[index - state.nx];
    }
    if (iy + 1 < state.ny && free[index + state.nx]) {
      const conductance = potential
        ? carrierConductance(
          potential[index], potential[index + state.nx], state.southGeometry[index], electronVariable,
        )
        : geometryMultiplier * state.southGeometry[index];
      value -= conductance * vector[index + state.nx];
    }
    output[index] = value;
  }
}

function neighborSum(state, values, index, multiplier) {
  let sum = 0;
  forEachNeighbor(state, index, (neighbor, geometry) => {
    sum += multiplier * geometry * (values[index] - values[neighbor]);
  });
  return sum;
}

function geometrySum(state, index, multiplier) {
  let sum = 0;
  forEachNeighbor(state, index, (_neighbor, geometry) => { sum += multiplier * geometry; });
  return sum;
}

function forEachNeighbor(state, index, callback) {
  const ix = index % state.nx;
  const iy = Math.floor(index / state.nx);
  if (ix > 0) callback(index - 1, state.westGeometry[index]);
  if (ix + 1 < state.nx) callback(index + 1, state.eastGeometry[index]);
  if (iy > 0) callback(index - state.nx, state.northGeometry[index]);
  if (iy + 1 < state.ny) callback(index + state.nx, state.southGeometry[index]);
}

function carrierConductance(potentialHere, potentialNeighbor, geometry, electron) {
  const difference = potentialNeighbor - potentialHere;
  return electron
    ? geometry * expSafe(potentialNeighbor) * bernoulli(difference)
    : geometry * expSafe(-potentialHere) * bernoulli(difference);
}

function electronFluxIntegratedNormalized(state, here, neighbor, geometry) {
  const difference = state.potential[neighbor] - state.potential[here];
  const etaDifference = (Math.log(state.electron[neighbor]) - state.potential[neighbor]) -
    (Math.log(state.electron[here]) - state.potential[here]);
  return geometry * state.electron[here] * bernoulli(-difference) * Math.expm1(etaDifference);
}

function holeFluxIntegratedNormalized(state, here, neighbor, geometry) {
  const difference = state.potential[neighbor] - state.potential[here];
  const etaDifference = (Math.log(state.hole[neighbor]) + state.potential[neighbor]) -
    (Math.log(state.hole[here]) + state.potential[here]);
  return -geometry * state.hole[here] * bernoulli(difference) * Math.expm1(etaDifference);
}

function srhNormalized(electron, hole, config) {
  return (electron * hole - 1) /
    (config.holeLifetimeS * (electron + 1) + config.electronLifetimeS * (hole + 1));
}

function srhElectronDerivative(electron, hole, config) {
  const constant = config.holeLifetimeS + config.electronLifetimeS * (hole + 1);
  const denominator = config.holeLifetimeS * electron + constant;
  return (hole * constant + config.holeLifetimeS) / (denominator * denominator);
}

function srhHoleDerivative(electron, hole, config) {
  const constant = config.holeLifetimeS * (electron + 1) + config.electronLifetimeS;
  const denominator = constant + config.electronLifetimeS * hole;
  return (electron * constant + config.electronLifetimeS) / (denominator * denominator);
}

function metricsConverged(config, metrics) {
  return metrics.poissonResidual < config.residualTolerance &&
    metrics.electronResidual < config.residualTolerance &&
    metrics.holeResidual < config.residualTolerance &&
    metrics.terminalKclError < config.conservationTolerance &&
    metrics.electronBalanceError < config.conservationTolerance &&
    metrics.holeBalanceError < config.conservationTolerance;
}

function reusableState(result, config) {
  if (!result?.diagnostics?.converged || result.nx !== config.nx || result.ny !== config.ny) return null;
  for (const name of [
    "lengthUm", "heightUm", "emitterWidthUm", "baseWidthUm", "emitterDopingCm3",
    "baseDopingCm3", "collectorDopingCm3", "temperatureK", "intrinsicDensityCm3",
    "relativePermittivity", "electronMobilityM2Vs", "holeMobilityM2Vs",
    "electronLifetimeS", "holeLifetimeS",
  ]) {
    if (result.config[name] !== config[name]) return null;
  }
  return {
    ...createGeometry(config),
    potential: Float64Array.from(result.normalizedPotential),
    electron: Float64Array.from(result.normalizedElectron),
    hole: Float64Array.from(result.normalizedHole),
    baseEmitterVoltageV: result.config.baseEmitterVoltageV,
    collectorEmitterVoltageV: result.config.collectorEmitterVoltageV,
    converged: true,
    iterations: 0,
    totalIterations: result.diagnostics.totalIterations,
    damping: result.diagnostics.damping,
    metrics: result.diagnostics,
  };
}

function cloneState(state) {
  return {
    ...state,
    potential: Float64Array.from(state.potential),
    electron: Float64Array.from(state.electron),
    hole: Float64Array.from(state.hole),
  };
}

function continuationValues(start, target, maximumStep) {
  const difference = target - start;
  if (Math.abs(difference) < 1e-15) return [];
  const steps = Math.ceil(Math.abs(difference) / maximumStep);
  return Array.from({ length: steps }, (_, index) => start + difference * (index + 1) / steps);
}

function freeMask(contact) {
  return Uint8Array.from(contact, (value) => value === CONTACT_NONE ? 1 : 0);
}

function failedMetrics(reason) {
  return {
    converged: false,
    poissonResidual: Infinity,
    electronResidual: Infinity,
    holeResidual: Infinity,
    terminalKclError: Infinity,
    terminalKclAbsoluteErrorAm: Infinity,
    terminalKclAbsoluteToleranceAm: NaN,
    electronBalanceError: Infinity,
    holeBalanceError: Infinity,
    integratedRecombinationAm: NaN,
    terminalCurrents: null,
    failureReason: reason,
  };
}

function depletionWidth(donorM3, acceptorM3, voltageV, epsilonFm) {
  return Math.sqrt(2 * epsilonFm * voltageV / Q * (1 / donorM3 + 1 / acceptorM3));
}

function expSafe(value) {
  return Math.exp(Math.max(-80, Math.min(80, value)));
}

function finiteArray(values) {
  for (const value of values) if (!Number.isFinite(value)) return false;
  return true;
}
