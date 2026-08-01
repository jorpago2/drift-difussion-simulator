export type NumericArray = Float64Array | number[];

export interface Validation<TConfig, TDerived> {
  config: TConfig;
  errors: string[];
  warnings: string[];
  derived: TDerived | null;
}

export interface PnConfig {
  acceptorCm3: number;
  donorCm3: number;
  lengthUm: number;
  deviceAreaUm2: number;
  biasV: number;
  cells: number;
  temperatureK: number;
  intrinsicDensityCm3: number;
  relativePermittivity: number;
  bandgapEv: number;
  electronMobilityM2Vs: number;
  holeMobilityM2Vs: number;
  electronLifetimeS: number;
  holeLifetimeS: number;
  maxIterations: number;
  residualTolerance: number;
  currentTolerance: number;
}

export interface PnDerived {
  thermalVoltageV: number;
  epsilonFm: number;
  acceptorM3: number;
  donorM3: number;
  intrinsicM3: number;
  lengthM: number;
  deviceAreaM2: number;
  dxM: number;
  builtInPotentialV: number;
  depletionWidthM: number;
  equilibriumDepletionWidthM: number;
  pSideQuasiNeutralWidthM: number;
  nSideQuasiNeutralWidthM: number;
  finiteBaseReferenceValid: boolean;
  acceptorDebyeLengthM: number;
  donorDebyeLengthM: number;
  lowInjectionLimitV: number;
}

export interface PnDiagnostics {
  converged: boolean;
  iterations: number;
  totalIterations: number;
  damping: number;
  poissonResidual: number;
  electronResidual: number;
  holeResidual: number;
  currentContinuityError: number;
  currentContinuityAbsoluteErrorAm2: number;
  currentContinuityAbsoluteToleranceAm2: number;
  electronBalanceError: number;
  holeBalanceError: number;
  meanCurrentDensityAm2: number;
  maxCurrentDensityAm2: number;
  failureReason: string;
}

export interface PnResult {
  config: PnConfig;
  derived: PnDerived;
  diagnostics: PnDiagnostics;
  warnings: string[];
  assumptions: string[];
  xM: NumericArray;
  dopingM3: NumericArray;
  potentialV: NumericArray;
  fieldVm: NumericArray;
  chargeCm3: NumericArray;
  electronM3: NumericArray;
  holeM3: NumericArray;
  recombinationM3s: NumericArray;
  electronCurrentAm2: NumericArray;
  holeCurrentAm2: NumericArray;
  totalCurrentAm2: NumericArray;
  conductionBandEv: NumericArray;
  intrinsicBandEv: NumericArray;
  valenceBandEv: NumericArray;
  electronQuasiFermiEv: NumericArray;
  holeQuasiFermiEv: NumericArray;
}

export interface PnSweepPoint {
  voltageV: number;
  currentDensityAm2: number;
  shockleyCurrentDensityAm2: number | null;
  converged: boolean;
}

export interface PnSweep {
  config: PnConfig;
  points: PnSweepPoint[];
  converged: boolean;
  warnings: string[];
  elapsedMs: number;
}

export interface NpnConfig {
  lengthUm: number;
  heightUm: number;
  deviceDepthUm: number;
  emitterWidthUm: number;
  baseWidthUm: number;
  emitterDopingCm3: number;
  baseDopingCm3: number;
  collectorDopingCm3: number;
  baseEmitterVoltageV: number;
  collectorEmitterVoltageV: number;
  nx: number;
  ny: number;
  temperatureK: number;
  intrinsicDensityCm3: number;
  relativePermittivity: number;
  bandgapEv: number;
  electronMobilityM2Vs: number;
  holeMobilityM2Vs: number;
  electronLifetimeS: number;
  holeLifetimeS: number;
  maxIterations: number;
  residualTolerance: number;
  conservationTolerance: number;
}

export interface NpnDerived {
  lengthM: number;
  heightM: number;
  depthM: number;
  dxM: number;
  dyM: number;
  emitterBaseBuiltInV: number;
  baseCollectorBuiltInV: number;
}

export interface TerminalCurrent {
  electronAm: number;
  holeAm: number;
  totalAm: number;
  electronCurrentA: number;
  holeCurrentA: number;
  currentIntoDeviceA: number;
}

export interface NpnResult {
  config: NpnConfig;
  derived: NpnDerived;
  diagnostics: {
    converged: boolean;
    failureReason: string;
    backend: string;
    elapsedMs?: number;
    totalIterations: number;
    poissonResidual: number;
    electronResidual: number;
    holeResidual: number;
    terminalKclError: number;
    electronBalanceError: number;
    holeBalanceError: number;
  };
  terminalCurrents: Record<"emitter" | "base" | "collector", TerminalCurrent>;
  warnings: string[];
  assumptions: string[];
  nx: number;
  ny: number;
  potentialV: NumericArray;
  electronM3: NumericArray;
  holeM3: NumericArray;
  recombinationM3s: NumericArray;
  totalCurrentDensityXAm2: NumericArray;
  totalCurrentDensityYAm2: NumericArray;
}

export interface NpnFamilyPoint {
  collectorEmitterVoltageV: number;
  collectorCurrentA: number;
  baseCurrentA: number;
  emitterCurrentA: number;
  converged: boolean;
}

export interface NpnFamilyCurve {
  baseEmitterVoltageV: number;
  converged: boolean;
  points: NpnFamilyPoint[];
}

export interface NpnFamily {
  config: NpnConfig;
  curves: NpnFamilyCurve[];
  converged: boolean;
  backend: string;
  elapsedMs: number;
}

export type SolverState = "idle" | "solving" | "converged" | "failed";
