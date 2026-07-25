export function createNiceScale(values, targetTickCount = 7, includeZero = false) {
  const finiteValues = [...values].filter(Number.isFinite);
  if (!finiteValues.length) return { min: -1, max: 1, step: 0.5, ticks: [-1, -0.5, 0, 0.5, 1] };

  let dataMin = Math.min(...finiteValues);
  let dataMax = Math.max(...finiteValues);
  if (includeZero) {
    const span = Math.max(dataMax - dataMin, Number.MIN_VALUE);
    if (dataMin < 0 && dataMax > 0 && Math.abs(dataMin) < span * 1e-6) dataMin = 0;
    if (dataMax > 0 && dataMin < 0 && Math.abs(dataMax) < span * 1e-6) dataMax = 0;
    dataMin = Math.min(dataMin, 0);
    dataMax = Math.max(dataMax, 0);
  }
  if (dataMin === dataMax) {
    const halfSpan = Math.max(1, Math.abs(dataMin) * 0.1);
    dataMin -= halfSpan;
    dataMax += halfSpan;
  }

  const step = niceStep((dataMax - dataMin) / Math.max(1, targetTickCount - 1));
  const min = cleanNumber(Math.floor(dataMin / step) * step);
  const max = cleanNumber(Math.ceil(dataMax / step) * step);
  const tickCount = Math.round((max - min) / step);
  const ticks = Array.from({ length: tickCount + 1 }, (_, index) => cleanNumber(min + index * step));
  return { min, max, step, ticks };
}

export function formatChartTick(value, step = 0) {
  if (!Number.isFinite(value)) return "–";
  if (Math.abs(value) < Number.EPSILON * 10) return "0";
  const absolute = Math.abs(value);
  if (absolute >= 1e4 || absolute < 1e-3) return value.toExponential(1).replace("e+", "e");
  if (!step) return Number(value.toPrecision(3)).toString();

  let decimals = Math.max(0, -Math.floor(Math.log10(Math.abs(step))));
  if (Math.abs(Number(step.toFixed(decimals)) - step) > Math.abs(step) * 1e-8) decimals += 1;
  return value.toFixed(Math.min(decimals, 6)).replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

function niceStep(rawStep) {
  const exponent = Math.floor(Math.log10(rawStep));
  const magnitude = 10 ** exponent;
  const fraction = rawStep / magnitude;
  const preferred = fraction < Math.sqrt(2) ? 1 :
    fraction < Math.sqrt(5) ? 2 :
      fraction < Math.sqrt(12.5) ? 2.5 :
        fraction < Math.sqrt(50) ? 5 : 10;
  return preferred * magnitude;
}

function cleanNumber(value) {
  return Math.abs(value) < Number.EPSILON * 10 ? 0 : Number(value.toPrecision(12));
}
