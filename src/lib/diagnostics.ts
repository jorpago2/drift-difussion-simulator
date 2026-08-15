export type DeviceWarningCategory = "numerical" | "model-scope" | "physics-regime";

export function classifyDeviceWarning(message: string): DeviceWarningCategory {
  if (/avalanche|tunneling|omits|not included|no breakdown/i.test(message)) return "model-scope";
  if (/high injection|punch-through|overlap across the base|degeneracy|bandgap narrowing/i.test(message)) return "physics-regime";
  return "numerical";
}

export function actionableWarnings(warnings: readonly string[]): string[] {
  return warnings.filter((warning) => classifyDeviceWarning(warning) !== "model-scope");
}

export function meshWarnings(warnings: readonly string[]): string[] {
  return warnings.filter((warning) => classifyDeviceWarning(warning) === "numerical" && /mesh|Debye|depletion|interval|contact spans|quasi-neutral/i.test(warning));
}
