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
  if (value === 0) return "0";
  const absolute = Math.abs(value);
  if (absolute >= 1e4 || absolute < 1e-3) return value.toExponential(1).replace("e+", "e");
  if (!step) return Number(value.toPrecision(3)).toString();

  let decimals = Math.max(0, -Math.floor(Math.log10(Math.abs(step))));
  if (Math.abs(Number(step.toFixed(decimals)) - step) > Math.abs(step) * 1e-8) decimals += 1;
  return value.toFixed(Math.min(decimals, 6)).replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

export function setScientificText(element, text) {
  const fragment = element.ownerDocument.createDocumentFragment();
  for (const segment of parseScientificText(text)) {
    if (segment.subscript) {
      const subscript = element.ownerDocument.createElement("sub");
      subscript.textContent = segment.text;
      fragment.append(subscript);
    } else {
      fragment.append(element.ownerDocument.createTextNode(segment.text));
    }
  }
  element.replaceChildren(fragment);
}

export function drawScientificText(context, text, x, y) {
  const segments = parseScientificText(text);
  if (segments.length === 1) {
    context.fillText(text, x, y);
    return context.measureText(text).width;
  }

  const mainFont = context.font;
  const subscriptFont = mainFont.replace(/(\d+(?:\.\d+)?)px/, (_, size) => `${Number(size) * 0.75}px`);
  const widths = segments.map((segment) => {
    context.font = segment.subscript ? subscriptFont : mainFont;
    return context.measureText(segment.text).width;
  });
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);
  let cursorX = context.textAlign === "center" ? x - totalWidth / 2 : context.textAlign === "right" ? x - totalWidth : x;

  context.save();
  context.textAlign = "left";
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    context.font = segment.subscript ? subscriptFont : mainFont;
    context.fillText(segment.text, cursorX, y + (segment.subscript ? 3 : 0));
    cursorX += widths[index];
  }
  context.restore();
  context.font = mainFont;
  return totalWidth;
}

export function measureScientificText(context, text) {
  const mainFont = context.font;
  const subscriptFont = mainFont.replace(/(\d+(?:\.\d+)?)px/, (_, size) => `${Number(size) * 0.75}px`);
  const width = parseScientificText(text).reduce((sum, segment) => {
    context.font = segment.subscript ? subscriptFont : mainFont;
    return sum + context.measureText(segment.text).width;
  }, 0);
  context.font = mainFont;
  return width;
}

function parseScientificText(text) {
  const segments = [];
  let cursor = 0;
  for (const match of text.matchAll(/_([A-Za-z0-9]+)/g)) {
    if (match.index > cursor) segments.push({ text: text.slice(cursor, match.index), subscript: false });
    segments.push({ text: match[1], subscript: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), subscript: false });
  return segments.length ? segments : [{ text, subscript: false }];
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
