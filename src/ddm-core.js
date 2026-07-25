export const Q = 1.602176634e-19;
export const EPS0 = 8.8541878128e-12;
export const KB = 1.380649e-23;
export const MATERIAL_OXIDE = 0;
export const MATERIAL_SEMICONDUCTOR = 1;

const DEFAULT_TEMPERATURE_K = 300;
const DEFAULT_NI_CM3 = 1e10;
const MIN_DENSITY_NORM = 1e-20;
const MAX_DENSITY_NORM = 1e20;

export const PRESETS = Object.freeze({
  pn: "Union PN",
  npn: "NPN lateral",
  mos: "Capacitor MOS",
});

export function thermalVoltage(temperatureK = DEFAULT_TEMPERATURE_K) {
  if (!Number.isFinite(temperatureK) || temperatureK <= 0) {
    throw new Error("temperatureK must be positive.");
  }
  return (KB * temperatureK) / Q;
}

export function bernoulli(x) {
  if (!Number.isFinite(x)) return x > 0 ? 0 : -x;
  const ax = Math.abs(x);
  if (ax < 1e-5) {
    const x2 = x * x;
    return 1 - x / 2 + x2 / 12 - (x2 * x2) / 720;
  }
  if (x > 80) return x * Math.exp(-x);
  if (x < -80) return -x;
  return x / (Math.exp(x) - 1);
}

export function neutralCarrierPair(dopantNorm) {
  if (!Number.isFinite(dopantNorm)) {
    throw new Error("dopantNorm must be finite.");
  }
  const root = Math.sqrt(dopantNorm * dopantNorm + 4);
  if (dopantNorm >= 0) {
    const electron = 0.5 * (dopantNorm + root);
    return { electron, hole: 1 / electron, potential: Math.asinh(dopantNorm / 2) };
  }
  const hole = 0.5 * (-dopantNorm + root);
  return { electron: 1 / hole, hole, potential: Math.asinh(dopantNorm / 2) };
}

export function createSimulation(presetName = "pn", options = {}) {
  const builder = presetBuilders[presetName] ?? presetBuilders.pn;
  const sim = builder(options);
  applyContactVoltages(sim);
  return sim;
}

export function applyContactVoltages(sim, voltageById = null) {
  if (!sim || !sim.cells) throw new Error("Invalid simulation.");
  if (voltageById) {
    for (const contact of sim.contacts) {
      if (Object.hasOwn(voltageById, contact.id)) {
        const value = Number(voltageById[contact.id]);
        if (Number.isFinite(value)) contact.voltage = value;
      }
    }
  }

  const contactVoltage = new Map(sim.contacts.map((contact) => [contact.id, contact.voltage]));
  for (let i = 0; i < sim.cells; i += 1) {
    const contactId = sim.contactMask[i];
    if (!contactId) continue;
    const voltage = contactVoltage.get(contactId) ?? 0;
    const neutral = sim.material[i] === MATERIAL_SEMICONDUCTOR
      ? neutralCarrierPair(sim.dopant[i]).potential
      : 0;
    sim.contactPotential[i] = neutral + voltage / sim.thermalVoltage;
    sim.potential[i] = sim.contactPotential[i];

    if (sim.material[i] === MATERIAL_SEMICONDUCTOR) {
      const pair = neutralCarrierPair(sim.dopant[i]);
      sim.electron[i] = pair.electron;
      sim.hole[i] = pair.hole;
    }
  }
}

export function stepSimulation(sim, options = {}) {
  const iterations = clampInteger(options.iterations ?? 12, 1, 1000);
  const omega = clampNumber(options.omega ?? 0.75, 0.1, 1.4);
  const carrierDamping = clampNumber(options.carrierDamping ?? 0.35, 0.05, 1);
  let maxPotentialDelta = 0;
  let maxCarrierDelta = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const potentialDelta = options.useWasm && sim.wasmBackend
      ? sim.wasmBackend.relaxPotential(sim, 1, omega)
      : relaxPotential(sim, 1, omega);
    const carrierDelta = relaxCarriers(sim, 1, carrierDamping);
    maxPotentialDelta = Math.max(maxPotentialDelta, potentialDelta);
    maxCarrierDelta = Math.max(maxCarrierDelta, carrierDelta);
  }

  sim.iteration += iterations;
  sim.lastResidual = Math.max(maxPotentialDelta, maxCarrierDelta);
  return { maxPotentialDelta, maxCarrierDelta, residual: sim.lastResidual };
}

export function relaxPotential(sim, sweeps = 1, omega = 0.75) {
  const {
    nx,
    ny,
    cells,
    potential,
    electron,
    hole,
    dopant,
    epsRel,
    material,
    contactMask,
    contactPotential,
    poissonScale,
  } = sim;
  let maxDelta = 0;

  for (let sweep = 0; sweep < sweeps; sweep += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        const i = y * nx + x;
        if (contactMask[i]) {
          const delta = contactPotential[i] - potential[i];
          potential[i] = contactPotential[i];
          maxDelta = Math.max(maxDelta, Math.abs(delta));
          continue;
        }

        const epsCenter = epsRel[i];
        let weightedPotential = 0;
        let weight = 0;

        if (x > 0) {
          const j = i - 1;
          const edge = 0.5 * (epsCenter + epsRel[j]);
          weightedPotential += edge * potential[j];
          weight += edge;
        }
        if (x + 1 < nx) {
          const j = i + 1;
          const edge = 0.5 * (epsCenter + epsRel[j]);
          weightedPotential += edge * potential[j];
          weight += edge;
        }
        if (y > 0) {
          const j = i - nx;
          const edge = 0.5 * (epsCenter + epsRel[j]);
          weightedPotential += edge * potential[j];
          weight += edge;
        }
        if (y + 1 < ny) {
          const j = i + nx;
          const edge = 0.5 * (epsCenter + epsRel[j]);
          weightedPotential += edge * potential[j];
          weight += edge;
        }
        if (weight <= 0) continue;

        const chargeNorm = material[i] === MATERIAL_SEMICONDUCTOR
          ? hole[i] - electron[i] + dopant[i]
          : 0;
        const target = (weightedPotential + poissonScale * chargeNorm) / weight;
        const delta = clampNumber((target - potential[i]) * omega, -1, 1);
        potential[i] += delta;
        maxDelta = Math.max(maxDelta, Math.abs(delta));
      }
    }
  }
  return maxDelta;
}

export function relaxCarriers(sim, sweeps = 1, damping = 0.35) {
  const { nx, ny, potential, electron, hole, material, contactMask } = sim;
  let maxRelativeDelta = 0;

  for (let sweep = 0; sweep < sweeps; sweep += 1) {
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        const i = y * nx + x;
        if (material[i] !== MATERIAL_SEMICONDUCTOR) {
          electron[i] = 0;
          hole[i] = 0;
          continue;
        }
        if (contactMask[i]) {
          const pair = neutralCarrierPair(sim.dopant[i]);
          electron[i] = pair.electron;
          hole[i] = pair.hole;
          continue;
        }

        const update = carrierUpdateAt(sim, x, y, i);
        if (!update) continue;

        const nextElectron = mixPositive(electron[i], update.electron, damping);
        const nextHole = mixPositive(hole[i], update.hole, damping);
        maxRelativeDelta = Math.max(
          maxRelativeDelta,
          relativeDelta(electron[i], nextElectron),
          relativeDelta(hole[i], nextHole),
        );
        electron[i] = nextElectron;
        hole[i] = nextHole;
      }
    }
  }
  return maxRelativeDelta;
}

export function collectMetrics(sim) {
  let maxField = 0;
  let maxCharge = 0;
  let minPotential = Infinity;
  let maxPotential = -Infinity;
  const { nx, ny, potential, electron, hole, dopant, material, dxM, thermalVoltage: vt } = sim;

  for (let y = 0; y < ny; y += 1) {
    for (let x = 0; x < nx; x += 1) {
      const i = y * nx + x;
      const potentialV = potential[i] * vt;
      minPotential = Math.min(minPotential, potentialV);
      maxPotential = Math.max(maxPotential, potentialV);

      if (material[i] === MATERIAL_SEMICONDUCTOR) {
        const charge = Q * sim.intrinsicDensityM3 * (hole[i] - electron[i] + dopant[i]);
        maxCharge = Math.max(maxCharge, Math.abs(charge));
      }

      const left = x > 0 ? potential[i - 1] : potential[i];
      const right = x + 1 < nx ? potential[i + 1] : potential[i];
      const up = y > 0 ? potential[i - nx] : potential[i];
      const down = y + 1 < ny ? potential[i + nx] : potential[i];
      const ex = -((right - left) * vt) / (2 * dxM);
      const ey = -((down - up) * vt) / (2 * dxM);
      maxField = Math.max(maxField, Math.hypot(ex, ey));
    }
  }

  return {
    maxCharge,
    maxField,
    minPotential,
    maxPotential,
    iteration: sim.iteration,
    residual: sim.lastResidual,
  };
}

export function getContactBounds(sim) {
  const byId = new Map(sim.contacts.map((contact) => [
    contact.id,
    { ...contact, minX: sim.nx, minY: sim.ny, maxX: -1, maxY: -1, cells: 0 },
  ]));
  for (let y = 0; y < sim.ny; y += 1) {
    for (let x = 0; x < sim.nx; x += 1) {
      const id = sim.contactMask[y * sim.nx + x];
      if (!id || !byId.has(id)) continue;
      const bounds = byId.get(id);
      bounds.minX = Math.min(bounds.minX, x);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxY = Math.max(bounds.maxY, y);
      bounds.cells += 1;
    }
  }
  return [...byId.values()].filter((bounds) => bounds.cells > 0);
}

export function estimateTerminalCurrent(sim, contactId) {
  let currentPerDepth = 0;
  for (let y = 0; y < sim.ny; y += 1) {
    for (let x = 0; x < sim.nx; x += 1) {
      const i = y * sim.nx + x;
      if (sim.contactMask[i] !== contactId || sim.material[i] !== MATERIAL_SEMICONDUCTOR) continue;
      currentPerDepth += currentToNeighbor(sim, i, x - 1, y);
      currentPerDepth += currentToNeighbor(sim, i, x + 1, y);
      currentPerDepth += currentToNeighbor(sim, i, x, y - 1);
      currentPerDepth += currentToNeighbor(sim, i, x, y + 1);
    }
  }
  return currentPerDepth;
}

export function diodeVoltage(sim) {
  if (sim?.preset !== "pn") return 0;
  const anode = sim.contacts.find((contact) => contact.id === 1)?.voltage ?? 0;
  const cathode = sim.contacts.find((contact) => contact.id === 2)?.voltage ?? 0;
  return anode - cathode;
}

export function estimateRectifierDiodeCurrent(sim, voltage = diodeVoltage(sim)) {
  if (sim?.preset !== "pn") return estimateTerminalCurrent(sim, sim?.contacts?.[0]?.id ?? 0);
  return solvePnDiode1D(sim, voltage).currentPerDepth;
}

export function solvePnDiode1D(sim, voltage = diodeVoltage(sim), options = {}) {
  if (sim?.preset !== "pn") throw new Error("solvePnDiode1D requires a PN simulation.");

  const cells = clampInteger(options.cells ?? 181, 51, 401);
  const dx = sim.lengthUm * 1e-6 / (cells - 1);
  const junction = Math.floor(cells / 2);
  const dopant = new Float64Array(cells);
  const epsRel = new Float64Array(cells);
  const poissonScale = (dx * dx * Q * sim.intrinsicDensityM3) / (EPS0 * sim.thermalVoltage);
  const { acceptorM3, donorM3 } = estimatePnDoping(sim);
  const acceptorNorm = Math.max(1, acceptorM3 / sim.intrinsicDensityM3);
  const donorNorm = Math.max(1, donorM3 / sim.intrinsicDensityM3);

  for (let i = 0; i < cells; i += 1) {
    dopant[i] = i < junction ? -acceptorNorm : donorNorm;
    epsRel[i] = 11.7;
  }

  const leftPair = neutralCarrierPair(dopant[0]);
  const rightPair = neutralCarrierPair(dopant[cells - 1]);
  const leftPotential = leftPair.potential + voltage / sim.thermalVoltage;
  const rightPotential = rightPair.potential;
  const zeroBiasPotential = solveEquilibriumPoisson1D({
    dopant,
    epsRel,
    poissonScale,
    leftPotential: leftPair.potential,
    rightPotential,
  });

  const potential = new Float64Array(cells);
  const electron = new Float64Array(cells);
  const hole = new Float64Array(cells);
  const voltageNorm = voltage / sim.thermalVoltage;
  for (let i = 0; i < cells; i += 1) {
    potential[i] = zeroBiasPotential[i] + voltageNorm * (1 - i / (cells - 1));
    electron[i] = dopant[i] < 0 ? 1 / acceptorNorm : donorNorm;
    hole[i] = dopant[i] < 0 ? acceptorNorm : 1 / donorNorm;
  }
  potential[0] = leftPotential;
  potential[cells - 1] = rightPotential;

  const electronDiffusion = sim.electronMobilityM2Vs * sim.thermalVoltage;
  const holeDiffusion = sim.holeMobilityM2Vs * sim.thermalVoltage;
  const lifetimeS = clampNumber(options.lifetimeS ?? 1e-8, 1e-12, 1e-3);
  const leftWidth = sim.lengthUm * 0.5e-6;
  const rightWidth = sim.lengthUm * 0.5e-6;
  const electronMinorityM3 = sim.intrinsicDensityM3 * sim.intrinsicDensityM3 / acceptorM3;
  const holeMinorityM3 = sim.intrinsicDensityM3 * sim.intrinsicDensityM3 / donorM3;
  const injection = Math.expm1(clampNumber(voltage / sim.thermalVoltage, -80, 40));
  const electronProfile = solveMinorityDiffusion1D({
    lengthM: leftWidth,
    diffusionM2S: electronDiffusion,
    lifetimeS,
    edgeExcessM3: electronMinorityM3 * injection,
  });
  const holeProfile = solveMinorityDiffusion1D({
    lengthM: rightWidth,
    diffusionM2S: holeDiffusion,
    lifetimeS,
    edgeExcessM3: holeMinorityM3 * injection,
  });

  for (let i = 0; i < junction; i += 1) {
    const distanceIndex = junction - 1 - i;
    const excess = electronProfile.values[Math.min(distanceIndex, electronProfile.values.length - 1)] / sim.intrinsicDensityM3;
    electron[i] = Math.max(MIN_DENSITY_NORM, 1 / acceptorNorm + excess);
  }
  for (let i = junction; i < cells; i += 1) {
    const distanceIndex = i - junction;
    const excess = holeProfile.values[Math.min(distanceIndex, holeProfile.values.length - 1)] / sim.intrinsicDensityM3;
    hole[i] = Math.max(MIN_DENSITY_NORM, 1 / donorNorm + excess);
  }

  const currentDensity =
    Q * electronDiffusion * electronProfile.edgeGradientM4 +
    Q * holeDiffusion * holeProfile.edgeGradientM4;
  const currentPerDepth = currentDensity * sim.heightUm * 1e-6;

  return {
    voltage,
    currentPerDepth,
    currentSpread: 0,
    converged: true,
    iterations: 1,
    residual: electronProfile.residual + holeProfile.residual,
    potential,
    electron,
    hole,
    dopant,
  };
}

export function estimateSemiconductorCharge(sim) {
  let chargePerDepth = 0;
  for (let i = 0; i < sim.cells; i += 1) {
    if (sim.material[i] !== MATERIAL_SEMICONDUCTOR) continue;
    chargePerDepth += Q * sim.intrinsicDensityM3 * (sim.hole[i] - sim.electron[i] + sim.dopant[i]) * sim.dxM * sim.dxM;
  }
  return chargePerDepth / (sim.lengthUm * 1e-6);
}

function estimatePnDoping(sim) {
  let acceptorNorm = 0;
  let donorNorm = 0;
  for (let i = 0; i < sim.cells; i += 1) {
    if (sim.dopant[i] < 0) acceptorNorm = Math.max(acceptorNorm, -sim.dopant[i]);
    if (sim.dopant[i] > 0) donorNorm = Math.max(donorNorm, sim.dopant[i]);
  }
  const floorM3 = sim.intrinsicDensityM3;
  return {
    acceptorM3: Math.max(floorM3, acceptorNorm * sim.intrinsicDensityM3),
    donorM3: Math.max(floorM3, donorNorm * sim.intrinsicDensityM3),
  };
}

function solveMinorityDiffusion1D({ lengthM, diffusionM2S, lifetimeS, edgeExcessM3 }) {
  const cells = 96;
  const dx = lengthM / (cells - 1);
  const diffusionLength = Math.sqrt(diffusionM2S * lifetimeS);
  const alpha = (dx * dx) / (diffusionLength * diffusionLength);
  const unknowns = cells - 2;
  const lower = new Float64Array(Math.max(0, unknowns - 1));
  const diagonal = new Float64Array(unknowns);
  const upper = new Float64Array(Math.max(0, unknowns - 1));
  const rhs = new Float64Array(unknowns);

  for (let row = 0; row < unknowns; row += 1) {
    diagonal[row] = 2 + alpha;
    if (row > 0) lower[row - 1] = -1;
    else rhs[row] += edgeExcessM3;
    if (row + 1 < unknowns) upper[row] = -1;
  }

  const interior = solveTridiagonal(lower, diagonal, upper, rhs);
  const values = new Float64Array(cells);
  values[0] = edgeExcessM3;
  values[cells - 1] = 0;
  for (let i = 1; i < cells - 1; i += 1) values[i] = interior[i - 1];

  let residual = 0;
  let scale = Math.max(1, Math.abs(edgeExcessM3));
  for (let i = 1; i < cells - 1; i += 1) {
    residual = Math.max(residual, Math.abs(values[i - 1] - (2 + alpha) * values[i] + values[i + 1]));
    scale = Math.max(scale, Math.abs(values[i]));
  }
  return {
    values,
    edgeGradientM4: (values[0] - values[1]) / dx,
    residual: residual / scale,
  };
}

function solveEquilibriumPoisson1D({ dopant, epsRel, poissonScale, leftPotential, rightPotential }) {
  const cells = dopant.length;
  const potential = new Float64Array(cells);
  for (let i = 0; i < cells; i += 1) {
    const t = i / (cells - 1);
    potential[i] = leftPotential + t * (rightPotential - leftPotential);
  }

  for (let iteration = 0; iteration < 80; iteration += 1) {
    const unknowns = cells - 2;
    const lower = new Float64Array(Math.max(0, unknowns - 1));
    const diagonal = new Float64Array(unknowns);
    const upper = new Float64Array(Math.max(0, unknowns - 1));
    const rhs = new Float64Array(unknowns);
    let maxCorrection = 0;

    for (let row = 0; row < unknowns; row += 1) {
      const i = row + 1;
      const epsLeft = 0.5 * (epsRel[i] + epsRel[i - 1]);
      const epsRight = 0.5 * (epsRel[i] + epsRel[i + 1]);
      const electron = expClamped(potential[i]);
      const hole = expClamped(-potential[i]);
      const charge = hole - electron + dopant[i];
      const residual =
        (epsLeft + epsRight) * potential[i] -
        epsLeft * potential[i - 1] -
        epsRight * potential[i + 1] -
        poissonScale * charge;

      diagonal[row] = epsLeft + epsRight + poissonScale * (electron + hole);
      rhs[row] = -residual;
      if (row > 0) lower[row - 1] = -epsLeft;
      if (row + 1 < unknowns) upper[row] = -epsRight;
    }

    const correction = solveTridiagonal(lower, diagonal, upper, rhs);
    for (let i = 1; i < cells - 1; i += 1) {
      const delta = clampNumber(correction[i - 1], -1, 1);
      potential[i] += delta;
      maxCorrection = Math.max(maxCorrection, Math.abs(delta));
    }
    if (maxCorrection < 1e-9) break;
  }

  potential[0] = leftPotential;
  potential[cells - 1] = rightPotential;
  return potential;
}

function solveTridiagonal(lower, diagonal, upper, rhs) {
  const n = diagonal.length;
  const cPrime = new Float64Array(Math.max(0, n - 1));
  const dPrime = new Float64Array(n);
  let pivot = safePivot(diagonal[0]);
  if (n > 1) cPrime[0] = upper[0] / pivot;
  dPrime[0] = rhs[0] / pivot;

  for (let i = 1; i < n; i += 1) {
    pivot = safePivot(diagonal[i] - lower[i - 1] * cPrime[i - 1]);
    if (i < n - 1) cPrime[i] = upper[i] / pivot;
    dPrime[i] = (rhs[i] - lower[i - 1] * dPrime[i - 1]) / pivot;
  }

  const x = new Float64Array(n);
  x[n - 1] = dPrime[n - 1];
  for (let i = n - 2; i >= 0; i -= 1) x[i] = dPrime[i] - cPrime[i] * x[i + 1];
  return x;
}

function safePivot(value) {
  if (!Number.isFinite(value)) return 1e-30;
  if (Math.abs(value) < 1e-30) return value < 0 ? -1e-30 : 1e-30;
  return value;
}

function expClamped(value) {
  return Math.exp(clampNumber(value, -80, 80));
}

export function sampleCell(sim, x, y) {
  const cx = clampInteger(x, 0, sim.nx - 1);
  const cy = clampInteger(y, 0, sim.ny - 1);
  const i = cy * sim.nx + cx;
  const densityScale = sim.intrinsicDensityCm3;
  return {
    x: cx,
    y: cy,
    potentialV: sim.potential[i] * sim.thermalVoltage,
    electronCm3: sim.electron[i] * densityScale,
    holeCm3: sim.hole[i] * densityScale,
    dopantCm3: sim.dopant[i] * densityScale,
    material: sim.material[i],
  };
}

function currentToNeighbor(sim, i, xNeighbor, yNeighbor) {
  if (xNeighbor < 0 || xNeighbor >= sim.nx || yNeighbor < 0 || yNeighbor >= sim.ny) return 0;
  const j = yNeighbor * sim.nx + xNeighbor;
  if (sim.material[j] !== MATERIAL_SEMICONDUCTOR || sim.contactMask[j] === sim.contactMask[i]) return 0;

  const du = sim.potential[j] - sim.potential[i];
  const density = sim.intrinsicDensityM3;
  const scale = Q * sim.thermalVoltage * density;
  const electronCurrent = sim.electronMobilityM2Vs * scale * (
    sim.electron[j] * bernoulli(du) - sim.electron[i] * bernoulli(-du)
  );
  const holeCurrent = sim.holeMobilityM2Vs * scale * (
    sim.hole[i] * bernoulli(du) - sim.hole[j] * bernoulli(-du)
  );
  return electronCurrent + holeCurrent;
}

function carrierUpdateAt(sim, x, y, i) {
  const { nx, ny, potential, electron, hole, material } = sim;
  let electronNumerator = 0;
  let electronDenominator = 0;
  let holeNumerator = 0;
  let holeDenominator = 0;

  const addNeighbor = (j) => {
    if (material[j] !== MATERIAL_SEMICONDUCTOR) return;
    const du = potential[j] - potential[i];
    electronNumerator += electron[j] * bernoulli(du);
    electronDenominator += bernoulli(-du);
    holeNumerator += hole[j] * bernoulli(-du);
    holeDenominator += bernoulli(du);
  };

  if (x > 0) addNeighbor(i - 1);
  if (x + 1 < nx) addNeighbor(i + 1);
  if (y > 0) addNeighbor(i - nx);
  if (y + 1 < ny) addNeighbor(i + nx);

  if (electronDenominator <= 0 || holeDenominator <= 0) return null;
  return {
    electron: clampNumber(electronNumerator / electronDenominator, MIN_DENSITY_NORM, MAX_DENSITY_NORM),
    hole: clampNumber(holeNumerator / holeDenominator, MIN_DENSITY_NORM, MAX_DENSITY_NORM),
  };
}

function createBaseSimulation({ preset, nx, lengthUm, heightUm, temperatureK = DEFAULT_TEMPERATURE_K, intrinsicDensityCm3 = DEFAULT_NI_CM3 }) {
  const ny = Math.max(24, Math.round(nx * heightUm / lengthUm));
  const cells = nx * ny;
  const vt = thermalVoltage(temperatureK);
  const intrinsicDensityM3 = intrinsicDensityCm3 * 1e6;
  const dxM = lengthUm * 1e-6 / nx;

  return {
    preset,
    nx,
    ny,
    cells,
    lengthUm,
    heightUm,
    dxM,
    temperatureK,
    thermalVoltage: vt,
    intrinsicDensityCm3,
    intrinsicDensityM3,
    electronMobilityM2Vs: 0.135,
    holeMobilityM2Vs: 0.048,
    poissonScale: (dxM * dxM * Q * intrinsicDensityM3) / (EPS0 * vt),
    potential: new Float64Array(cells),
    electron: new Float64Array(cells),
    hole: new Float64Array(cells),
    dopant: new Float64Array(cells),
    epsRel: new Float64Array(cells),
    material: new Uint8Array(cells),
    contactMask: new Uint8Array(cells),
    contactPotential: new Float64Array(cells),
    contacts: [],
    iteration: 0,
    lastResidual: 0,
    wasmBackend: null,
    backendName: "JS",
  };
}

function initializeNeutral(sim) {
  for (let i = 0; i < sim.cells; i += 1) {
    if (sim.material[i] !== MATERIAL_SEMICONDUCTOR) {
      sim.potential[i] = 0;
      sim.electron[i] = 0;
      sim.hole[i] = 0;
      continue;
    }
    const pair = neutralCarrierPair(sim.dopant[i]);
    sim.potential[i] = pair.potential;
    sim.electron[i] = pair.electron;
    sim.hole[i] = pair.hole;
  }
}

function buildPn(options) {
  const nx = clampInteger(options.nx ?? 144, 72, 240);
  const sim = createBaseSimulation({ preset: "pn", nx, lengthUm: 4, heightUm: 2 });
  const donor = (options.donorCm3 ?? 1e16) / sim.intrinsicDensityCm3;
  const acceptor = (options.acceptorCm3 ?? 1e16) / sim.intrinsicDensityCm3;
  const junction = Math.floor(sim.nx / 2);

  fillSemiconductor(sim, (x) => (x < junction ? -acceptor : donor));
  sim.contacts = [
    { id: 1, name: "Anodo P", voltage: options.diodeVoltage ?? 0, min: -5, max: 1, step: 0.01 },
    { id: 2, name: "Catodo N", voltage: 0, min: -1, max: 1, step: 0.01 },
  ];
  for (let y = 0; y < sim.ny; y += 1) {
    sim.contactMask[y * sim.nx] = 1;
    sim.contactMask[y * sim.nx + sim.nx - 1] = 2;
  }
  initializeNeutral(sim);
  return sim;
}

function buildNpn(options) {
  const nx = clampInteger(options.nx ?? 180, 96, 240);
  const sim = createBaseSimulation({ preset: "npn", nx, lengthUm: 6, heightUm: 2 });
  const emitterEnd = Math.floor(sim.nx * 0.28);
  const baseEnd = Math.floor(sim.nx * 0.48);
  const emitter = (options.emitterCm3 ?? 5e16) / sim.intrinsicDensityCm3;
  const base = (options.baseCm3 ?? 1e16) / sim.intrinsicDensityCm3;
  const collector = (options.collectorCm3 ?? 2e16) / sim.intrinsicDensityCm3;

  fillSemiconductor(sim, (x) => {
    if (x < emitterEnd) return emitter;
    if (x < baseEnd) return -base;
    return collector;
  });
  sim.contacts = [
    { id: 1, name: "Emisor", voltage: 0, min: -1, max: 1, step: 0.01 },
    { id: 2, name: "Base", voltage: options.baseVoltage ?? 0.65, min: -1, max: 1, step: 0.01 },
    { id: 3, name: "Colector", voltage: options.collectorVoltage ?? 1.5, min: -1, max: 3, step: 0.01 },
  ];
  for (let y = 0; y < sim.ny; y += 1) {
    sim.contactMask[y * sim.nx] = 1;
    sim.contactMask[y * sim.nx + sim.nx - 1] = 3;
  }
  for (let x = emitterEnd; x < baseEnd; x += 1) {
    sim.contactMask[x] = 2;
  }
  initializeNeutral(sim);
  return sim;
}

function buildMos(options) {
  const nx = clampInteger(options.nx ?? 144, 72, 240);
  const sim = createBaseSimulation({ preset: "mos", nx, lengthUm: 4, heightUm: 2 });
  const oxideRows = Math.max(4, Math.round(sim.ny * 0.22));
  const acceptor = (options.acceptorCm3 ?? 5e15) / sim.intrinsicDensityCm3;

  for (let y = 0; y < sim.ny; y += 1) {
    for (let x = 0; x < sim.nx; x += 1) {
      const i = y * sim.nx + x;
      if (y < oxideRows) {
        sim.material[i] = MATERIAL_OXIDE;
        sim.epsRel[i] = 3.9;
        sim.dopant[i] = 0;
      } else {
        sim.material[i] = MATERIAL_SEMICONDUCTOR;
        sim.epsRel[i] = 11.7;
        sim.dopant[i] = -acceptor;
      }
    }
  }
  sim.contacts = [
    { id: 1, name: "Puerta", voltage: options.gateVoltage ?? 1, min: -2, max: 2, step: 0.01 },
    { id: 2, name: "Substrato", voltage: 0, min: -1, max: 1, step: 0.01 },
  ];
  for (let x = 0; x < sim.nx; x += 1) {
    sim.contactMask[x] = 1;
    sim.contactMask[(sim.ny - 1) * sim.nx + x] = 2;
  }
  initializeNeutral(sim);
  return sim;
}

function fillSemiconductor(sim, dopantAtX) {
  for (let y = 0; y < sim.ny; y += 1) {
    for (let x = 0; x < sim.nx; x += 1) {
      const i = y * sim.nx + x;
      sim.material[i] = MATERIAL_SEMICONDUCTOR;
      sim.epsRel[i] = 11.7;
      sim.dopant[i] = dopantAtX(x, y);
    }
  }
}

function mixPositive(current, target, damping) {
  const mixed = current + damping * (target - current);
  return clampNumber(mixed, MIN_DENSITY_NORM, MAX_DENSITY_NORM);
}

function relativeDelta(a, b) {
  return Math.abs(b - a) / Math.max(1, Math.abs(a), Math.abs(b));
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function clampInteger(value, min, max) {
  return Math.round(clampNumber(Number(value), min, max));
}

const presetBuilders = {
  pn: buildPn,
  npn: buildNpn,
  mos: buildMos,
};

export const DEFAULT_PN_CONFIG = Object.freeze({
  acceptorCm3: 1e16,
  donorCm3: 1e16,
  lengthUm: 4,
  biasV: 0,
  cells: 401,
  temperatureK: 300,
  intrinsicDensityCm3: 1e10,
  relativePermittivity: 11.7,
  bandgapEv: 1.12,
  electronMobilityM2Vs: 0.135,
  holeMobilityM2Vs: 0.048,
  electronLifetimeS: 1e-8,
  holeLifetimeS: 1e-8,
  maxIterations: 200,
  residualTolerance: 1e-8,
  currentTolerance: 1e-3,
});

const PN_LIMITS = Object.freeze({
  acceptorCm3: [1e14, 1e18],
  donorCm3: [1e14, 1e18],
  lengthUm: [1, 20],
  biasV: [-1, 0.8],
  cells: [101, 2001],
  electronLifetimeS: [1e-12, 1e-3],
  holeLifetimeS: [1e-12, 1e-3],
});

const PN_MIN_DENSITY = 1e-30;
const PN_MAX_DENSITY = 1e30;
const PN_CONTINUATION_STEP_V = 0.025;

export function validatePnConfig(input = {}) {
  const config = { ...DEFAULT_PN_CONFIG, ...input };
  const errors = [];
  const warnings = [];

  for (const [name, [min, max]] of Object.entries(PN_LIMITS)) {
    const value = config[name];
    if (!Number.isFinite(value)) errors.push(`${name} must be a finite number.`);
    else if (value < min || value > max) errors.push(`${name} must be between ${min} and ${max}.`);
  }
  if (!Number.isInteger(config.cells) || config.cells % 2 === 0) {
    errors.push("cells must be an odd integer.");
  }

  for (const name of [
    "temperatureK",
    "intrinsicDensityCm3",
    "relativePermittivity",
    "bandgapEv",
    "electronMobilityM2Vs",
    "holeMobilityM2Vs",
    "maxIterations",
    "residualTolerance",
    "currentTolerance",
  ]) {
    if (!Number.isFinite(config[name]) || config[name] <= 0) errors.push(`${name} must be positive and finite.`);
  }
  if (!Number.isInteger(config.maxIterations)) errors.push("maxIterations must be an integer.");

  let derived = null;
  if (!errors.length) {
    const vt = thermalVoltage(config.temperatureK);
    const epsilon = EPS0 * config.relativePermittivity;
    const acceptorM3 = config.acceptorCm3 * 1e6;
    const donorM3 = config.donorCm3 * 1e6;
    const intrinsicM3 = config.intrinsicDensityCm3 * 1e6;
    const lengthM = config.lengthUm * 1e-6;
    const dxM = lengthM / (config.cells - 1);
    const builtInPotentialV = vt * Math.log((acceptorM3 * donorM3) / (intrinsicM3 * intrinsicM3));
    const depletionVoltageV = Math.max(0, builtInPotentialV - config.biasV);
    const depletionWidthM = Math.sqrt(
      (2 * epsilon * depletionVoltageV / Q) * (1 / acceptorM3 + 1 / donorM3),
    );
    const acceptorDebyeLengthM = Math.sqrt((epsilon * KB * config.temperatureK) / (Q * Q * acceptorM3));
    const donorDebyeLengthM = Math.sqrt((epsilon * KB * config.temperatureK) / (Q * Q * donorM3));
    const lowInjectionLimitV = vt * Math.log(
      (Math.min(acceptorM3, donorM3) ** 2) / (intrinsicM3 * intrinsicM3),
    );
    derived = {
      thermalVoltageV: vt,
      epsilonFm: epsilon,
      acceptorM3,
      donorM3,
      intrinsicM3,
      lengthM,
      dxM,
      builtInPotentialV,
      depletionWidthM,
      acceptorDebyeLengthM,
      donorDebyeLengthM,
      lowInjectionLimitV,
    };

    const smallestDebyeM = Math.min(acceptorDebyeLengthM, donorDebyeLengthM);
    if (dxM > smallestDebyeM / 3) {
      warnings.push("The mesh uses fewer than three cells across the shortest Debye length.");
    }
    if (depletionWidthM > 0 && dxM > depletionWidthM / 20) {
      warnings.push("The estimated depletion region spans fewer than twenty cells.");
    }
    if (config.biasV > 0.9 * lowInjectionLimitV) {
      warnings.push("The applied bias approaches or exceeds the estimated low-injection limit.");
    }
    if (config.biasV < 0) {
      warnings.push("The model omits avalanche and tunneling; reverse bias describes classical drift-diffusion only.");
    }
    if (Math.max(config.acceptorCm3, config.donorCm3) > 5e17) {
      warnings.push("Degeneracy and bandgap narrowing may matter at high doping and are not included.");
    }
  }

  return { config, errors, warnings, derived };
}

export function solvePnJunction1D(input = {}, previousSolution = null) {
  const validation = validatePnConfig(input);
  if (validation.errors.length) throw new RangeError(validation.errors.join(" "));
  const { config } = validation;
  const targetBiasV = config.biasV;
  let state = reusablePnState(previousSolution, config);

  if (!state || state.biasV * targetBiasV < 0) {
    state = createPnState(config, 0);
    if (!state.converged) state = solvePnBiasPoint(config, state, 0);
  }
  if (!state.converged) return finalizePnResult(config, state, validation.warnings);

  const deltaV = targetBiasV - state.biasV;
  if (Math.abs(deltaV) < 1e-15) return finalizePnResult(config, state, validation.warnings);
  const steps = Math.max(1, Math.ceil(Math.abs(deltaV) / PN_CONTINUATION_STEP_V));
  for (let step = 1; step <= steps; step += 1) {
    const biasV = state.biasV + (targetBiasV - state.biasV) / (steps - step + 1);
    state = solvePnBiasPoint(config, state, biasV);
    if (!state.converged) break;
  }
  return finalizePnResult(config, state, validation.warnings);
}

export function sweepPnJunction(input = {}, voltages = null) {
  const validation = validatePnConfig(input);
  if (validation.errors.length) throw new RangeError(validation.errors.join(" "));
  const requested = voltages ?? Array.from({ length: 67 }, (_, index) => -1 + index * 0.025);
  const unique = [...new Set(requested.map(Number))].sort((a, b) => a - b);
  for (const voltage of unique) {
    if (!Number.isFinite(voltage) || voltage < PN_LIMITS.biasV[0] || voltage > PN_LIMITS.biasV[1]) {
      throw new RangeError(`Invalid sweep voltage: ${voltage}.`);
    }
  }

  const zero = solvePnJunction1D({ ...validation.config, biasV: 0 });
  const byVoltage = new Map([[0, zero]]);
  let previous = zero;
  for (const voltage of unique.filter((value) => value < 0).sort((a, b) => b - a)) {
    previous = solvePnJunction1D({ ...validation.config, biasV: voltage }, previous);
    byVoltage.set(voltage, previous);
    if (!previous.diagnostics.converged) break;
  }
  previous = zero;
  for (const voltage of unique.filter((value) => value > 0)) {
    previous = solvePnJunction1D({ ...validation.config, biasV: voltage }, previous);
    byVoltage.set(voltage, previous);
    if (!previous.diagnostics.converged) break;
  }

  const points = unique.map((voltage) => {
    const result = byVoltage.get(voltage);
    return {
      voltageV: voltage,
      currentDensityAm2: result?.diagnostics.meanCurrentDensityAm2 ?? NaN,
      shockleyCurrentDensityAm2: voltage <= validation.derived.lowInjectionLimitV
        ? shockleyReferenceCurrentDensity(validation.config, voltage)
        : null,
      converged: result?.diagnostics.converged ?? false,
      result: result ?? null,
    };
  });
  return {
    config: validation.config,
    points,
    converged: points.every((point) => point.converged),
    warnings: validation.warnings,
  };
}

export function shockleyReferenceCurrentDensity(input = {}, voltage = null) {
  const validation = validatePnConfig(input);
  if (validation.errors.length) throw new RangeError(validation.errors.join(" "));
  const { config, derived } = validation;
  const appliedV = voltage ?? config.biasV;
  const electronDiffusionM2S = config.electronMobilityM2Vs * derived.thermalVoltageV;
  const holeDiffusionM2S = config.holeMobilityM2Vs * derived.thermalVoltageV;
  const electronLengthM = Math.sqrt(electronDiffusionM2S * config.electronLifetimeS);
  const holeLengthM = Math.sqrt(holeDiffusionM2S * config.holeLifetimeS);
  const saturationAm2 = Q * derived.intrinsicM3 * derived.intrinsicM3 * (
    electronDiffusionM2S / (electronLengthM * derived.acceptorM3) +
    holeDiffusionM2S / (holeLengthM * derived.donorM3)
  );
  return saturationAm2 * Math.expm1(clampNumber(appliedV / derived.thermalVoltageV, -80, 40));
}

export function serializePnProfileCsv(result) {
  if (!result?.diagnostics?.converged) throw new Error("Only converged results can be exported.");
  const lines = [
    `# model=1D Poisson-continuity Scharfetter-Gummel SRH`,
    `# bias_V=${result.config.biasV}`,
    `# cells=${result.config.cells}`,
    "x_um,doping_cm-3,potential_V,field_V_m,charge_C_m-3,electron_cm-3,hole_cm-3,recombination_m-3_s-1,Jn_A_cm-2,Jp_A_cm-2,Jtotal_A_cm-2,Ec_eV,Ei_eV,Ev_eV,Fn_eV,Fp_eV",
  ];
  for (let i = 0; i < result.xM.length; i += 1) {
    lines.push([
      result.xM[i] * 1e6,
      result.dopingM3[i] / 1e6,
      result.potentialV[i],
      result.fieldVm[i],
      result.chargeCm3[i],
      result.electronM3[i] / 1e6,
      result.holeM3[i] / 1e6,
      result.recombinationM3s[i],
      result.electronCurrentAm2[i] / 1e4,
      result.holeCurrentAm2[i] / 1e4,
      result.totalCurrentAm2[i] / 1e4,
      result.conductionBandEv[i],
      result.intrinsicBandEv[i],
      result.valenceBandEv[i],
      result.electronQuasiFermiEv[i],
      result.holeQuasiFermiEv[i],
    ].join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function serializePnSweepCsv(sweep) {
  if (!sweep?.converged) throw new Error("Only converged sweeps can be exported.");
  const lines = [
    "# model=1D Poisson-continuity Scharfetter-Gummel SRH",
    "voltage_V,J_A_cm-2,J_Shockley_A_cm-2",
    ...sweep.points.map((point) => [
      point.voltageV,
      point.currentDensityAm2 / 1e4,
      point.shockleyCurrentDensityAm2 == null ? "" : point.shockleyCurrentDensityAm2 / 1e4,
    ].join(",")),
  ];
  return `${lines.join("\n")}\n`;
}

function reusablePnState(result, config) {
  if (!result?.diagnostics?.converged || result.config.cells !== config.cells) return null;
  for (const name of [
    "acceptorCm3",
    "donorCm3",
    "lengthUm",
    "temperatureK",
    "intrinsicDensityCm3",
    "relativePermittivity",
    "electronMobilityM2Vs",
    "holeMobilityM2Vs",
    "electronLifetimeS",
    "holeLifetimeS",
  ]) {
    if (result.config[name] !== config[name]) return null;
  }
  return {
    biasV: result.config.biasV,
    potential: Float64Array.from(result.normalizedPotential),
    electron: Float64Array.from(result.normalizedElectron),
    hole: Float64Array.from(result.normalizedHole),
    dopant: Float64Array.from(result.normalizedDoping),
    converged: true,
    iterations: 0,
    totalIterations: result.diagnostics.totalIterations,
    damping: result.diagnostics.damping,
    metrics: result.diagnostics,
  };
}

function createPnState(config, biasV) {
  const validation = validatePnConfig({ ...config, biasV });
  const { derived } = validation;
  const cells = config.cells;
  const junction = Math.floor(cells / 2);
  const acceptorNorm = derived.acceptorM3 / derived.intrinsicM3;
  const donorNorm = derived.donorM3 / derived.intrinsicM3;
  const leftPair = neutralCarrierPair(-acceptorNorm);
  const rightPair = neutralCarrierPair(donorNorm);
  const potential = new Float64Array(cells);
  const electron = new Float64Array(cells);
  const hole = new Float64Array(cells);
  const dopant = new Float64Array(cells);
  const leftPotential = leftPair.potential + biasV / derived.thermalVoltageV;
  const rightPotential = rightPair.potential;

  for (let i = 0; i < cells; i += 1) {
    const t = i / (cells - 1);
    const pair = i < junction ? leftPair : rightPair;
    dopant[i] = i < junction ? -acceptorNorm : donorNorm;
    potential[i] = leftPotential + t * (rightPotential - leftPotential);
    electron[i] = pair.electron;
    hole[i] = pair.hole;
  }
  const state = {
    biasV,
    potential,
    electron,
    hole,
    dopant,
    converged: false,
    iterations: 0,
    totalIterations: 0,
    damping: 0.5,
    metrics: null,
  };
  if (biasV === 0) {
    const epsRel = new Float64Array(cells);
    epsRel.fill(config.relativePermittivity);
    state.potential = solveEquilibriumPoisson1D({
      dopant,
      epsRel,
      poissonScale: (derived.dxM * derived.dxM * Q * derived.intrinsicM3) /
        (EPS0 * derived.thermalVoltageV),
      leftPotential: leftPair.potential,
      rightPotential: rightPair.potential,
    });
    for (let i = 0; i < cells; i += 1) {
      state.electron[i] = expClamped(state.potential[i]);
      state.hole[i] = expClamped(-state.potential[i]);
    }
    state.metrics = pnEquationMetrics(config, state);
    state.converged =
      state.metrics.poissonResidual < config.residualTolerance &&
      state.metrics.electronResidual < config.residualTolerance &&
      state.metrics.holeResidual < config.residualTolerance &&
      state.metrics.currentContinuityError < config.currentTolerance;
  }
  return state;
}

function solvePnBiasPoint(config, previousState, biasV) {
  const state = {
    ...previousState,
    potential: Float64Array.from(previousState.potential),
    electron: Float64Array.from(previousState.electron),
    hole: Float64Array.from(previousState.hole),
    biasV,
    converged: false,
    iterations: 0,
  };
  shiftPnBias(config, state, previousState.biasV, biasV);
  let damping = clampNumber(previousState.damping || 0.5, 0.0625, 1);
  let previousScore = Infinity;

  for (let iteration = 1; iteration <= config.maxIterations; iteration += 1) {
    const oldPotential = Float64Array.from(state.potential);
    const oldElectron = Float64Array.from(state.electron);
    const oldHole = Float64Array.from(state.hole);
    const potentialCandidate = solvePnPoisson(config, state);
    const electronCandidate = solvePnElectron(config, state, potentialCandidate, oldElectron, oldHole);
    const holeCandidate = solvePnHole(config, state, potentialCandidate, electronCandidate, oldHole);

    if (!positiveFiniteArray(electronCandidate) || !positiveFiniteArray(holeCandidate) || !finiteArray(potentialCandidate)) {
      state.metrics = failedPnMetrics("The solver produced NaN, infinity, or a non-positive density.");
      break;
    }

    mixPnState(state, oldPotential, oldElectron, oldHole, potentialCandidate, electronCandidate, holeCandidate, damping);
    enforcePnContacts(config, state);
    const metrics = pnEquationMetrics(config, state);
    const score = Math.max(metrics.poissonResidual, metrics.electronResidual, metrics.holeResidual);

    if (score > previousScore * 1.5 && damping > 0.0625) {
      state.potential.set(oldPotential);
      state.electron.set(oldElectron);
      state.hole.set(oldHole);
      damping = Math.max(0.0625, damping * 0.5);
      continue;
    }

    state.metrics = metrics;
    state.iterations = iteration;
    state.totalIterations = previousState.totalIterations + iteration;
    state.damping = damping;
    previousScore = score;
    if (
      metrics.poissonResidual < config.residualTolerance &&
      metrics.electronResidual < config.residualTolerance &&
      metrics.holeResidual < config.residualTolerance &&
      metrics.currentContinuityError < config.currentTolerance
    ) {
      state.converged = true;
      break;
    }
    if (iteration % 8 === 0 && score < 1e-3 && damping < 1) damping = Math.min(1, damping * 1.25);
  }

  if (!state.metrics) state.metrics = failedPnMetrics("The numerical state could not be evaluated.");
  if (!state.converged && !state.metrics.failureReason) {
    state.metrics.failureReason = `Did not converge within ${config.maxIterations} iterations.`;
  }
  return state;
}

function shiftPnBias(config, state, oldBiasV, newBiasV) {
  const vt = thermalVoltage(config.temperatureK);
  const delta = (newBiasV - oldBiasV) / vt;
  for (let i = 0; i < config.cells; i += 1) {
    state.potential[i] += delta * (1 - i / (config.cells - 1));
  }
  enforcePnContacts(config, state);
}

function enforcePnContacts(config, state) {
  const validation = validatePnConfig({ ...config, biasV: state.biasV });
  const { derived } = validation;
  const acceptorNorm = derived.acceptorM3 / derived.intrinsicM3;
  const donorNorm = derived.donorM3 / derived.intrinsicM3;
  const left = neutralCarrierPair(-acceptorNorm);
  const right = neutralCarrierPair(donorNorm);
  const last = config.cells - 1;
  state.potential[0] = left.potential + state.biasV / derived.thermalVoltageV;
  state.potential[last] = right.potential;
  state.electron[0] = left.electron;
  state.hole[0] = left.hole;
  state.electron[last] = right.electron;
  state.hole[last] = right.hole;
}

function solvePnPoisson(config, state) {
  const validation = validatePnConfig({ ...config, biasV: state.biasV });
  const { derived } = validation;
  const cells = config.cells;
  const unknowns = cells - 2;
  const epsilonRel = config.relativePermittivity;
  const scale = (derived.dxM * derived.dxM * Q * derived.intrinsicM3) /
    (EPS0 * derived.thermalVoltageV);
  const etaElectron = new Float64Array(cells);
  const etaHole = new Float64Array(cells);
  const potential = Float64Array.from(state.potential);
  for (let i = 0; i < cells; i += 1) {
    etaElectron[i] = Math.log(state.electron[i]) - state.potential[i];
    etaHole[i] = Math.log(state.hole[i]) + state.potential[i];
  }

  let previousResidual = Infinity;
  for (let iteration = 0; iteration < 30; iteration += 1) {
    const lower = new Float64Array(unknowns - 1);
    const diagonal = new Float64Array(unknowns);
    const upper = new Float64Array(unknowns - 1);
    const rhs = new Float64Array(unknowns);
    let maxResidual = 0;
    for (let row = 0; row < unknowns; row += 1) {
      const i = row + 1;
      const electron = expClamped(potential[i] + etaElectron[i]);
      const hole = expClamped(-potential[i] + etaHole[i]);
      const residual = 2 * epsilonRel * potential[i] -
        epsilonRel * potential[i - 1] - epsilonRel * potential[i + 1] -
        scale * (hole - electron + state.dopant[i]);
      diagonal[row] = 2 * epsilonRel + scale * (electron + hole);
      rhs[row] = -residual;
      if (row > 0) lower[row - 1] = -epsilonRel;
      if (row + 1 < unknowns) upper[row] = -epsilonRel;
      maxResidual = Math.max(maxResidual, Math.abs(residual));
    }
    const correction = solveTridiagonal(lower, diagonal, upper, rhs);
    let step = maxResidual > previousResidual ? 0.5 : 1;
    let maxCorrection = 0;
    for (let i = 1; i < cells - 1; i += 1) {
      const delta = clampNumber(correction[i - 1], -1, 1) * step;
      potential[i] += delta;
      maxCorrection = Math.max(maxCorrection, Math.abs(delta));
    }
    previousResidual = maxResidual;
    if (maxCorrection < 1e-10) break;
  }
  return potential;
}

function solvePnElectron(config, state, potential, electron, hole) {
  const validation = validatePnConfig({ ...config, biasV: state.biasV });
  const { derived } = validation;
  const cells = config.cells;
  const unknowns = cells - 2;
  const lower = new Float64Array(unknowns - 1);
  const diagonal = new Float64Array(unknowns);
  const upper = new Float64Array(unknowns - 1);
  const rhs = new Float64Array(unknowns);
  const sourceScale = derived.dxM * derived.dxM /
    (config.electronMobilityM2Vs * derived.thermalVoltageV);
  const slotboom = new Float64Array(cells);
  for (let i = 0; i < cells; i += 1) slotboom[i] = electron[i] * expClamped(-potential[i]);

  for (let row = 0; row < unknowns; row += 1) {
    const i = row + 1;
    const duLeft = potential[i] - potential[i - 1];
    const duRight = potential[i + 1] - potential[i];
    const srh = srhNormalized(electron[i], hole[i], config);
    const densityPerSlotboom = expClamped(potential[i]);
    const derivative = srhElectronDerivative(electron[i], hole[i], config) * densityPerSlotboom;
    const constant = srh - derivative * slotboom[i];
    const leftConductance = expClamped(potential[i]) * bernoulli(duLeft);
    const rightConductance = expClamped(potential[i + 1]) * bernoulli(duRight);
    const lowerValue = -leftConductance;
    const upperValue = -rightConductance;
    diagonal[row] = leftConductance + rightConductance + sourceScale * derivative;
    rhs[row] = -sourceScale * constant;
    if (row > 0) lower[row - 1] = lowerValue;
    else rhs[row] -= lowerValue * slotboom[0];
    if (row + 1 < unknowns) upper[row] = upperValue;
    else rhs[row] -= upperValue * slotboom[cells - 1];
  }
  const interior = solveTridiagonal(lower, diagonal, upper, rhs);
  const result = Float64Array.from(electron);
  for (let i = 1; i < cells - 1; i += 1) {
    result[i] = clampNumber(
      expClamped(potential[i]) * interior[i - 1],
      PN_MIN_DENSITY,
      PN_MAX_DENSITY,
    );
  }
  return result;
}

function solvePnHole(config, state, potential, electron, hole) {
  const validation = validatePnConfig({ ...config, biasV: state.biasV });
  const { derived } = validation;
  const cells = config.cells;
  const unknowns = cells - 2;
  const lower = new Float64Array(unknowns - 1);
  const diagonal = new Float64Array(unknowns);
  const upper = new Float64Array(unknowns - 1);
  const rhs = new Float64Array(unknowns);
  const sourceScale = derived.dxM * derived.dxM /
    (config.holeMobilityM2Vs * derived.thermalVoltageV);
  const slotboom = new Float64Array(cells);
  for (let i = 0; i < cells; i += 1) slotboom[i] = hole[i] * expClamped(potential[i]);

  for (let row = 0; row < unknowns; row += 1) {
    const i = row + 1;
    const duLeft = potential[i] - potential[i - 1];
    const duRight = potential[i + 1] - potential[i];
    const srh = srhNormalized(electron[i], hole[i], config);
    const densityPerSlotboom = expClamped(-potential[i]);
    const derivative = srhHoleDerivative(electron[i], hole[i], config) * densityPerSlotboom;
    const constant = srh - derivative * slotboom[i];
    const leftConductance = expClamped(-potential[i - 1]) * bernoulli(duLeft);
    const rightConductance = expClamped(-potential[i]) * bernoulli(duRight);
    const lowerValue = -leftConductance;
    const upperValue = -rightConductance;
    diagonal[row] = leftConductance + rightConductance + sourceScale * derivative;
    rhs[row] = -sourceScale * constant;
    if (row > 0) lower[row - 1] = lowerValue;
    else rhs[row] -= lowerValue * slotboom[0];
    if (row + 1 < unknowns) upper[row] = upperValue;
    else rhs[row] -= upperValue * slotboom[cells - 1];
  }
  const interior = solveTridiagonal(lower, diagonal, upper, rhs);
  const result = Float64Array.from(hole);
  for (let i = 1; i < cells - 1; i += 1) {
    result[i] = clampNumber(
      expClamped(-potential[i]) * interior[i - 1],
      PN_MIN_DENSITY,
      PN_MAX_DENSITY,
    );
  }
  return result;
}

function srhNormalized(electron, hole, config) {
  const denominator = config.holeLifetimeS * (electron + 1) +
    config.electronLifetimeS * (hole + 1);
  return (electron * hole - 1) / denominator;
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

function mixPnState(state, oldPotential, oldElectron, oldHole, nextPotential, nextElectron, nextHole, damping) {
  for (let i = 1; i < state.potential.length - 1; i += 1) {
    state.potential[i] = oldPotential[i] + damping * (nextPotential[i] - oldPotential[i]);
    state.electron[i] = Math.exp(
      Math.log(oldElectron[i]) + damping * (Math.log(nextElectron[i]) - Math.log(oldElectron[i])),
    );
    state.hole[i] = Math.exp(
      Math.log(oldHole[i]) + damping * (Math.log(nextHole[i]) - Math.log(oldHole[i])),
    );
  }
}

function pnEquationMetrics(config, state) {
  const validation = validatePnConfig({ ...config, biasV: state.biasV });
  const { derived } = validation;
  const cells = config.cells;
  const poissonScale = derived.dxM * derived.dxM * Q * derived.intrinsicM3 /
    (EPS0 * derived.thermalVoltageV);
  const electronScale = derived.dxM * derived.dxM /
    (config.electronMobilityM2Vs * derived.thermalVoltageV);
  const holeScale = derived.dxM * derived.dxM /
    (config.holeMobilityM2Vs * derived.thermalVoltageV);
  let poissonResidual = 0;
  let electronResidual = 0;
  let holeResidual = 0;

  for (let i = 1; i < cells - 1; i += 1) {
    const charge = state.hole[i] - state.electron[i] + state.dopant[i];
    const poisson = 2 * config.relativePermittivity * state.potential[i] -
      config.relativePermittivity * state.potential[i - 1] -
      config.relativePermittivity * state.potential[i + 1] - poissonScale * charge;
    const poissonNorm = Math.max(
      1,
      Math.abs(2 * config.relativePermittivity * state.potential[i]),
      Math.abs(poissonScale * charge),
    );
    poissonResidual = Math.max(poissonResidual, Math.abs(poisson) / poissonNorm);

    const duLeft = state.potential[i] - state.potential[i - 1];
    const duRight = state.potential[i + 1] - state.potential[i];
    const electronLeft = pnElectronFlux(
      state.potential[i - 1], state.potential[i], state.electron[i - 1], state.electron[i],
    );
    const electronRight = pnElectronFlux(
      state.potential[i], state.potential[i + 1], state.electron[i], state.electron[i + 1],
    );
    const holeLeft = pnHoleFlux(
      state.potential[i - 1], state.potential[i], state.hole[i - 1], state.hole[i],
    );
    const holeRight = pnHoleFlux(
      state.potential[i], state.potential[i + 1], state.hole[i], state.hole[i + 1],
    );
    const srh = srhNormalized(state.electron[i], state.hole[i], config);
    const electronEquation = electronRight - electronLeft - electronScale * srh;
    const holeEquation = holeRight - holeLeft + holeScale * srh;
    const electronMagnitude = Math.max(
      1,
      Math.abs(state.electron[i - 1] * bernoulli(-duLeft)),
      Math.abs(state.electron[i] * bernoulli(duLeft)),
      Math.abs(state.electron[i] * bernoulli(-duRight)),
      Math.abs(state.electron[i + 1] * bernoulli(duRight)),
    );
    const holeMagnitude = Math.max(
      1,
      Math.abs(state.hole[i - 1] * bernoulli(duLeft)),
      Math.abs(state.hole[i] * bernoulli(-duLeft)),
      Math.abs(state.hole[i] * bernoulli(duRight)),
      Math.abs(state.hole[i + 1] * bernoulli(-duRight)),
    );
    electronResidual = Math.max(
      electronResidual,
      Math.abs(electronEquation) / Math.max(electronMagnitude, Math.abs(electronScale * srh)),
    );
    holeResidual = Math.max(
      holeResidual,
      Math.abs(holeEquation) / Math.max(holeMagnitude, Math.abs(holeScale * srh)),
    );
  }

  const currents = pnEdgeCurrents(config, state, derived);
  const total = currents.total;
  const meanCurrentDensityAm2 = total.reduce((sum, value) => sum + value, 0) / total.length;
  const maxCurrent = Math.max(...total.map(Math.abs));
  const currentContinuityError = maxCurrent < 1e-2 ? 0 :
    Math.max(...total.map((value) => Math.abs(value - meanCurrentDensityAm2))) / maxCurrent;
  return {
    converged: false,
    poissonResidual,
    electronResidual,
    holeResidual,
    currentContinuityError,
    meanCurrentDensityAm2,
    maxCurrentDensityAm2: maxCurrent,
    failureReason: "",
  };
}

function pnEdgeCurrents(config, state, derived) {
  const edges = config.cells - 1;
  const electron = new Float64Array(edges);
  const hole = new Float64Array(edges);
  const total = new Float64Array(edges);
  const electronPrefactor = Q * config.electronMobilityM2Vs * derived.thermalVoltageV *
    derived.intrinsicM3 / derived.dxM;
  const holePrefactor = Q * config.holeMobilityM2Vs * derived.thermalVoltageV *
    derived.intrinsicM3 / derived.dxM;
  for (let i = 0; i < edges; i += 1) {
    electron[i] = electronPrefactor * pnElectronFlux(
      state.potential[i], state.potential[i + 1], state.electron[i], state.electron[i + 1],
    );
    hole[i] = holePrefactor * pnHoleFlux(
      state.potential[i], state.potential[i + 1], state.hole[i], state.hole[i + 1],
    );
    total[i] = electron[i] + hole[i];
  }
  return { electron, hole, total };
}

function pnElectronFlux(potentialLeft, potentialRight, electronLeft, electronRight) {
  const du = potentialRight - potentialLeft;
  const etaDifference = (Math.log(electronRight) - potentialRight) -
    (Math.log(electronLeft) - potentialLeft);
  return electronLeft * bernoulli(-du) * Math.expm1(etaDifference);
}

function pnHoleFlux(potentialLeft, potentialRight, holeLeft, holeRight) {
  const du = potentialRight - potentialLeft;
  const etaDifference = (Math.log(holeRight) + potentialRight) -
    (Math.log(holeLeft) + potentialLeft);
  return -holeLeft * bernoulli(du) * Math.expm1(etaDifference);
}

function finalizePnResult(config, state, baseWarnings) {
  const validation = validatePnConfig({ ...config, biasV: state.biasV });
  const { derived } = validation;
  const cells = config.cells;
  const xM = new Float64Array(cells);
  const dopingM3 = new Float64Array(cells);
  const potentialV = new Float64Array(cells);
  const fieldVm = new Float64Array(cells);
  const chargeCm3 = new Float64Array(cells);
  const electronM3 = new Float64Array(cells);
  const holeM3 = new Float64Array(cells);
  const recombinationM3s = new Float64Array(cells);
  const intrinsicBandEv = new Float64Array(cells);
  const conductionBandEv = new Float64Array(cells);
  const valenceBandEv = new Float64Array(cells);
  const electronQuasiFermiEv = new Float64Array(cells);
  const holeQuasiFermiEv = new Float64Array(cells);
  const currents = pnEdgeCurrents(config, state, derived);
  const electronCurrentAm2 = edgeToNode(currents.electron);
  const holeCurrentAm2 = edgeToNode(currents.hole);
  const totalCurrentAm2 = edgeToNode(currents.total);

  for (let i = 0; i < cells; i += 1) {
    xM[i] = i * derived.dxM;
    dopingM3[i] = state.dopant[i] * derived.intrinsicM3;
    potentialV[i] = state.potential[i] * derived.thermalVoltageV;
    electronM3[i] = state.electron[i] * derived.intrinsicM3;
    holeM3[i] = state.hole[i] * derived.intrinsicM3;
    chargeCm3[i] = Q * (holeM3[i] - electronM3[i] + dopingM3[i]);
    recombinationM3s[i] = derived.intrinsicM3 * srhNormalized(state.electron[i], state.hole[i], config);
    const left = i > 0 ? state.potential[i - 1] : state.potential[i];
    const right = i + 1 < cells ? state.potential[i + 1] : state.potential[i];
    const width = i > 0 && i + 1 < cells ? 2 * derived.dxM : derived.dxM;
    fieldVm[i] = -((right - left) * derived.thermalVoltageV) / width;
    intrinsicBandEv[i] = -potentialV[i];
    conductionBandEv[i] = intrinsicBandEv[i] + config.bandgapEv / 2;
    valenceBandEv[i] = intrinsicBandEv[i] - config.bandgapEv / 2;
    electronQuasiFermiEv[i] = intrinsicBandEv[i] + derived.thermalVoltageV * Math.log(state.electron[i]);
    holeQuasiFermiEv[i] = intrinsicBandEv[i] - derived.thermalVoltageV * Math.log(state.hole[i]);
  }

  const metrics = { ...state.metrics };
  metrics.converged = state.converged;
  metrics.iterations = state.iterations;
  metrics.totalIterations = state.totalIterations;
  metrics.damping = state.damping;
  const warnings = [...new Set([...baseWarnings, ...validation.warnings])];
  if (!state.converged) warnings.push(metrics.failureReason || "Result did not converge.");
  if (Math.max(...electronM3, ...holeM3) > 1e25) {
    warnings.push("La densidad supera 1e19 cm^-3; la estadistica no degenerada puede dejar de ser valida.");
  }

  return {
    config: { ...config, biasV: state.biasV },
    xM,
    dopingM3,
    potentialV,
    fieldVm,
    chargeCm3,
    electronM3,
    holeM3,
    recombinationM3s,
    electronCurrentAm2,
    holeCurrentAm2,
    totalCurrentAm2,
    conductionBandEv,
    intrinsicBandEv,
    valenceBandEv,
    electronQuasiFermiEv,
    holeQuasiFermiEv,
    normalizedPotential: Float64Array.from(state.potential),
    normalizedElectron: Float64Array.from(state.electron),
    normalizedHole: Float64Array.from(state.hole),
    normalizedDoping: Float64Array.from(state.dopant),
    diagnostics: metrics,
    derived: validation.derived,
    warnings,
    assumptions: [
      "Silicio 1D homogeneo a 300 K y estadistica de Boltzmann.",
      "Movilidades constantes, ionizacion completa y contactos ohmicos.",
      "SRH de nivel medio; sin Auger, tunel, avalancha ni estrechamiento de banda.",
    ],
  };
}

function edgeToNode(edge) {
  const node = new Float64Array(edge.length + 1);
  node[0] = edge[0];
  node[node.length - 1] = edge[edge.length - 1];
  for (let i = 1; i < node.length - 1; i += 1) node[i] = 0.5 * (edge[i - 1] + edge[i]);
  return node;
}

function failedPnMetrics(reason) {
  return {
    converged: false,
    poissonResidual: Infinity,
    electronResidual: Infinity,
    holeResidual: Infinity,
    currentContinuityError: Infinity,
    meanCurrentDensityAm2: NaN,
    maxCurrentDensityAm2: NaN,
    failureReason: reason,
  };
}

function positiveFiniteArray(values) {
  for (const value of values) if (!Number.isFinite(value) || value <= 0) return false;
  return true;
}

function finiteArray(values) {
  for (const value of values) if (!Number.isFinite(value)) return false;
  return true;
}
