import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { createBoundedScale, drawScientificText, formatChartTick, measureScientificText } from "../plot-utils.js";
import type { NumericArray } from "../types";

export interface ChartSeries {
  label: string;
  values: NumericArray;
  color: string;
  dash?: number[];
  lineWidth?: number;
  showInLegend?: boolean;
}

export interface ChartDomain {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface LineChartHandle {
  reset: () => void;
  setDomain: (domain: ChartDomain) => boolean;
}

interface Props {
  x: NumericArray;
  series: ChartSeries[];
  xLabel: string;
  yLabel: string;
  markerX?: number;
  includeZero?: boolean;
  scale?: "linear" | "log" | "symlog";
  height?: number;
  state?: "empty" | "loading" | "ready" | "error";
  message?: string;
  interactive?: boolean;
  onSelectX?: (value: number) => void;
  onCanvas?: (canvas: HTMLCanvasElement | null) => void;
}

interface Geometry {
  width: number;
  height: number;
  left: number;
  top: number;
  plotWidth: number;
  plotHeight: number;
  domain: ChartDomain;
}

export const LineChart = forwardRef<LineChartHandle, Props>(function LineChart({
  x,
  series,
  xLabel,
  yLabel,
  markerX,
  includeZero = false,
  scale = "linear",
  height = 360,
  state = "ready",
  message = "Awaiting a converged solution",
  interactive = false,
  onSelectX,
  onCanvas,
}, forwardedRef) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const geometryRef = useRef<Geometry | null>(null);
  const manualDomainRef = useRef<ChartDomain | null>(null);
  const pointerRef = useRef<{ id: number; x: number; y: number; domain: ChartDomain; moved: boolean } | null>(null);
  const drawRef = useRef<() => void>(() => undefined);

  useImperativeHandle(forwardedRef, () => ({
    reset() {
      manualDomainRef.current = null;
      drawRef.current();
    },
    setDomain(domain) {
      if (![domain.xMin, domain.xMax, domain.yMin, domain.yMax].every(Number.isFinite) ||
        domain.xMin >= domain.xMax || domain.yMin >= domain.yMax || (scale === "log" && domain.yMin <= 0)) return false;
      manualDomainRef.current = domain;
      drawRef.current();
      return true;
    },
  }), [scale]);

  useEffect(() => {
    onCanvas?.(canvasRef.current);
    return () => onCanvas?.(null);
  }, [onCanvas]);

  useEffect(() => {
    manualDomainRef.current = null;
  }, [scale, x]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const width = Math.max(260, canvas.clientWidth || 760);
      const logicalHeight = Math.max(180, canvas.clientHeight || height);
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(logicalHeight * ratio);
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, logicalHeight);
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, logicalHeight);
      if (state !== "ready") {
        geometryRef.current = null;
        return;
      }

      const compact = width < 560;
      const pad = compact
        ? { left: 58, right: 12, top: 42, bottom: 48 }
        : { left: 78, right: 18, top: 48, bottom: 56 };
      const plotWidth = width - pad.left - pad.right;
      const plotHeight = logicalHeight - pad.top - pad.bottom;
      const transform = createTransform(scale);
      const xValues = Array.from(x, Number).filter(Number.isFinite);
      const yValues = series.flatMap((line) => Array.from(line.values, Number)
        .filter((value) => Number.isFinite(value) && transform.valid(value))
        .map(transform.forward));
      const manual = manualDomainRef.current;
      const xDomain = manual ? [manual.xMin, manual.xMax] : undefined;
      const yDomain = manual ? [transform.forward(manual.yMin), transform.forward(manual.yMax)] : undefined;
      const xScale = createBoundedScale(xValues, compact ? 5 : 7, false, xDomain);
      const yScale = createBoundedScale(yValues, compact ? 5 : 7, includeZero && scale === "linear", yDomain);
      const domain: ChartDomain = {
        xMin: xScale.min,
        xMax: xScale.max,
        yMin: transform.inverse(yScale.min),
        yMax: transform.inverse(yScale.max),
      };
      geometryRef.current = { width, height: logicalHeight, left: pad.left, top: pad.top, plotWidth, plotHeight, domain };
      const mapX = (value: number) => pad.left + ((value - xScale.min) / (xScale.max - xScale.min)) * plotWidth;
      const mapY = (value: number) => pad.top + plotHeight - ((transform.forward(value) - yScale.min) / (yScale.max - yScale.min)) * plotHeight;

      context.font = "600 11px Inter, ui-sans-serif, system-ui, sans-serif";
      context.fillStyle = "#5e7077";
      for (const [index, tick] of xScale.ticks.entries()) {
        const position = mapX(tick);
        context.strokeStyle = tick === 0 ? "#b7c6ca" : "#e7edef";
        context.lineWidth = tick === 0 ? 1.2 : 1;
        drawLine(context, position, pad.top, position, pad.top + plotHeight);
        if (!compact || index % 2 === 0) {
          context.textAlign = "center";
          context.fillStyle = "#5e7077";
          context.fillText(formatChartTick(tick, xScale.step), position, pad.top + plotHeight + 19);
        }
      }
      for (const tick of yScale.ticks) {
        const position = pad.top + plotHeight - ((tick - yScale.min) / (yScale.max - yScale.min)) * plotHeight;
        context.strokeStyle = tick === 0 ? "#b7c6ca" : "#e7edef";
        context.lineWidth = tick === 0 ? 1.2 : 1;
        drawLine(context, pad.left, position, pad.left + plotWidth, position);
        context.textAlign = "right";
        context.fillStyle = "#5e7077";
        context.fillText(formatChartTick(transform.inverse(tick), scale === "linear" ? yScale.step : 0), pad.left - 9, position + 4);
      }

      context.strokeStyle = "#334a51";
      context.lineWidth = 1.25;
      drawLine(context, pad.left, pad.top + plotHeight, pad.left + plotWidth, pad.top + plotHeight);
      drawLine(context, pad.left, pad.top, pad.left, pad.top + plotHeight);
      context.save();
      context.beginPath();
      context.rect(pad.left, pad.top, plotWidth, plotHeight);
      context.clip();
      context.lineJoin = "round";
      context.lineCap = "round";
      for (const line of series) {
        context.strokeStyle = line.color;
        context.lineWidth = line.lineWidth ?? 2.5;
        context.setLineDash(line.dash ?? []);
        context.beginPath();
        let drawing = false;
        for (let index = 0; index < x.length; index += 1) {
          const xValue = Number(x[index]);
          const yValue = Number(line.values[index]);
          if (!Number.isFinite(xValue) || !Number.isFinite(yValue) || !transform.valid(yValue)) {
            drawing = false;
            continue;
          }
          const px = mapX(xValue);
          const py = mapY(yValue);
          if (drawing) context.lineTo(px, py);
          else context.moveTo(px, py);
          drawing = true;
        }
        context.stroke();
      }
      if (Number.isFinite(markerX)) {
        context.strokeStyle = "#c23853";
        context.lineWidth = 1.4;
        context.setLineDash([4, 4]);
        drawLine(context, mapX(markerX!), pad.top, mapX(markerX!), pad.top + plotHeight);
      }
      context.restore();
      context.setLineDash([]);

      context.fillStyle = "#20343b";
      context.font = `750 ${compact ? 11 : 12}px Inter, ui-sans-serif, system-ui, sans-serif`;
      context.textAlign = "center";
      drawScientificText(context, xLabel, pad.left + plotWidth / 2, logicalHeight - 8);
      context.save();
      context.translate(compact ? 15 : 18, pad.top + plotHeight / 2);
      context.rotate(-Math.PI / 2);
      drawScientificText(context, yLabel, 0, 0);
      context.restore();

      let legendX = pad.left;
      let legendY = compact ? 17 : 21;
      context.font = `750 ${compact ? 9 : 11}px Inter, ui-sans-serif, system-ui, sans-serif`;
      context.textAlign = "left";
      for (const line of series.filter((item) => item.showInLegend !== false)) {
        const required = 30 + measureScientificText(context, line.label);
        if (legendX + required > width - 8) {
          legendX = pad.left;
          legendY += compact ? 14 : 17;
        }
        context.strokeStyle = line.color;
        context.lineWidth = line.lineWidth ?? 2.5;
        context.setLineDash(line.dash ?? []);
        drawLine(context, legendX, legendY, legendX + 18, legendY);
        context.setLineDash([]);
        context.fillStyle = "#40555c";
        drawScientificText(context, line.label, legendX + 23, legendY + 4);
        legendX += required + 10;
      }
    };
    drawRef.current = draw;
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [height, includeZero, markerX, scale, series, state, x, xLabel, yLabel]);

  function chartPoint(event: React.PointerEvent<HTMLCanvasElement> | React.WheelEvent<HTMLCanvasElement>) {
    const geometry = geometryRef.current;
    const canvas = canvasRef.current;
    if (!geometry || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) * geometry.width) / rect.width;
    const py = ((event.clientY - rect.top) * geometry.height) / rect.height;
    const xFraction = clamp((px - geometry.left) / geometry.plotWidth, 0, 1);
    const yFraction = clamp((py - geometry.top) / geometry.plotHeight, 0, 1);
    const transform = createTransform(scale);
    const transformedYMin = transform.forward(geometry.domain.yMin);
    const transformedYMax = transform.forward(geometry.domain.yMax);
    return {
      x: geometry.domain.xMin + xFraction * (geometry.domain.xMax - geometry.domain.xMin),
      y: transform.inverse(transformedYMax - yFraction * (transformedYMax - transformedYMin)),
      xFraction,
      yFraction,
    };
  }

  function zoom(event: React.WheelEvent<HTMLCanvasElement>) {
    if (!interactive || state !== "ready") return;
    event.preventDefault();
    const geometry = geometryRef.current;
    const point = chartPoint(event);
    if (!geometry || !point) return;
    const factor = Math.exp(clamp(event.deltaY, -240, 240) * 0.0018);
    const xRange = (geometry.domain.xMax - geometry.domain.xMin) * factor;
    const transform = createTransform(scale);
    const yMinimum = transform.forward(geometry.domain.yMin);
    const yMaximum = transform.forward(geometry.domain.yMax);
    const yPoint = transform.forward(point.y);
    const yRange = (yMaximum - yMinimum) * factor;
    manualDomainRef.current = {
      xMin: point.x - point.xFraction * xRange,
      xMax: point.x + (1 - point.xFraction) * xRange,
      yMin: transform.inverse(yPoint - (1 - point.yFraction) * yRange),
      yMax: transform.inverse(yPoint + point.yFraction * yRange),
    };
    drawRef.current();
  }

  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!interactive || !geometryRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, domain: geometryRef.current.domain, moved: false };
  }

  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const start = pointerRef.current;
    const geometry = geometryRef.current;
    if (!start || !geometry || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.hypot(dx, dy) > 3) start.moved = true;
    const xShift = -(dx / geometry.plotWidth) * (start.domain.xMax - start.domain.xMin);
    const transform = createTransform(scale);
    const yMinimum = transform.forward(start.domain.yMin);
    const yMaximum = transform.forward(start.domain.yMax);
    const yShift = (dy / geometry.plotHeight) * (yMaximum - yMinimum);
    manualDomainRef.current = {
      xMin: start.domain.xMin + xShift,
      xMax: start.domain.xMax + xShift,
      yMin: transform.inverse(yMinimum + yShift),
      yMax: transform.inverse(yMaximum + yShift),
    };
    drawRef.current();
  }

  function pointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    const start = pointerRef.current;
    if (!start || start.id !== event.pointerId) return;
    pointerRef.current = null;
    if (!start.moved) {
      const point = chartPoint(event);
      if (point) onSelectX?.(point.x);
    }
  }

  function keyDown(event: React.KeyboardEvent<HTMLCanvasElement>) {
    if (!interactive) return;
    if (event.key === "Home" || event.key === "0") {
      manualDomainRef.current = null;
      drawRef.current();
      event.preventDefault();
    }
  }

  return (
    <div className={`chart-frame chart-${state}`} data-message={message} style={{ "--chart-height": `${height}px` } as React.CSSProperties}>
      <canvas
        ref={canvasRef}
        aria-label={`${yLabel} versus ${xLabel}`}
        tabIndex={interactive ? 0 : -1}
        onWheel={zoom}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={() => { pointerRef.current = null; }}
        onDoubleClick={() => { manualDomainRef.current = null; drawRef.current(); }}
        onKeyDown={keyDown}
      />
    </div>
  );
});

function createTransform(kind: Props["scale"]) {
  if (kind === "log") return {
    valid: (value: number) => value > 0,
    forward: (value: number) => Math.log10(value),
    inverse: (value: number) => 10 ** value,
  };
  if (kind === "symlog") return {
    valid: Number.isFinite,
    forward: (value: number) => Math.sign(value) * Math.log10(1 + Math.abs(value)),
    inverse: (value: number) => Math.sign(value) * (10 ** Math.abs(value) - 1),
  };
  return { valid: Number.isFinite, forward: (value: number) => value, inverse: (value: number) => value };
}

function drawLine(context: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
