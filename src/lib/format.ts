export function scientific(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) < 1e-30) return "0";
  return value.toExponential(digits).replace("e+", "e");
}

export function fixed(value: number, digits = 3): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

export function percent(value: number): string {
  return Number.isFinite(value) ? `${scientific(value * 100)} %` : "—";
}

export function linearGrid(minimum: number, maximum: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) =>
    index === count - 1 ? maximum : minimum + ((maximum - minimum) * index) / (count - 1));
}

export function nearestIndex<T>(values: T[], target: number, accessor: (value: T) => number): number {
  let nearest = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (Math.abs(accessor(values[index]!) - target) < Math.abs(accessor(values[nearest]!) - target)) nearest = index;
  }
  return nearest;
}
