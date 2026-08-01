import { useEffect, useRef } from "react";
import { formatChartTick } from "../plot-utils.js";
import type { NumericArray } from "../types";

interface Props {
  values?: NumericArray;
  nx?: number;
  ny?: number;
  lengthUm?: number;
  heightUm?: number;
  label: string;
  diverging?: boolean;
  transform?: (value: number, index: number) => number;
}

export function Heatmap({ values, nx = 0, ny = 0, lengthUm = 1, heightUm = 1, label, diverging = false, transform }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const width = Math.max(280, canvas.clientWidth || 640);
      const height = Math.max(220, canvas.clientHeight || 280);
      const ratio = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.fillStyle = "#fff";
      context.fillRect(0, 0, width, height);
      if (!values || !nx || !ny) return;
      const pad = width < 520 ? { left: 52, right: 12, top: 30, bottom: 45 } : { left: 62, right: 16, top: 32, bottom: 48 };
      const plotWidth = width - pad.left - pad.right;
      const plotHeight = height - pad.top - pad.bottom;
      const plotted = Float64Array.from(values, (value, index) => transform ? transform(value, index) : value);
      let minimum = Infinity;
      let maximum = -Infinity;
      for (const value of plotted) {
        if (!Number.isFinite(value)) continue;
        minimum = Math.min(minimum, value);
        maximum = Math.max(maximum, value);
      }
      if (diverging) {
        const extent = Math.max(Math.abs(minimum), Math.abs(maximum), Number.MIN_VALUE);
        minimum = -extent;
        maximum = extent;
      }
      if (!(maximum > minimum)) maximum = minimum + 1;
      const pixels = document.createElement("canvas");
      pixels.width = nx;
      pixels.height = ny;
      const pixelContext = pixels.getContext("2d");
      if (!pixelContext) return;
      const image = pixelContext.createImageData(nx, ny);
      for (let index = 0; index < plotted.length; index += 1) {
        const fraction = clamp((plotted[index]! - minimum) / (maximum - minimum), 0, 1);
        const color = diverging ? divergingColor(fraction) : sequentialColor(fraction);
        image.data[index * 4] = color[0]!;
        image.data[index * 4 + 1] = color[1]!;
        image.data[index * 4 + 2] = color[2]!;
        image.data[index * 4 + 3] = 255;
      }
      pixelContext.putImageData(image, 0, 0);
      context.imageSmoothingEnabled = false;
      context.drawImage(pixels, pad.left, pad.top, plotWidth, plotHeight);
      context.font = "600 10px Inter, ui-sans-serif, system-ui, sans-serif";
      context.fillStyle = "#5e7077";
      for (let tick = 0; tick <= 4; tick += 1) {
        const x = pad.left + (tick * plotWidth) / 4;
        const y = pad.top + (tick * plotHeight) / 4;
        context.strokeStyle = "rgb(255 255 255 / 0.35)";
        drawLine(context, x, pad.top, x, pad.top + plotHeight);
        drawLine(context, pad.left, y, pad.left + plotWidth, y);
        context.textAlign = "center";
        context.fillText(formatChartTick((tick * lengthUm) / 4, lengthUm / 4), x, pad.top + plotHeight + 17);
        context.textAlign = "right";
        context.fillText(formatChartTick((tick * heightUm) / 4, heightUm / 4), pad.left - 7, y + 3);
      }
      context.strokeStyle = "#334a51";
      context.strokeRect(pad.left, pad.top, plotWidth, plotHeight);
      context.fillStyle = "#40555c";
      context.font = "700 11px Inter, ui-sans-serif, system-ui, sans-serif";
      context.textAlign = "center";
      context.fillText("x (µm)", pad.left + plotWidth / 2, height - 7);
      context.textAlign = "left";
      context.fillText(`${label}: ${minimum.toExponential(2)} to ${maximum.toExponential(2)}`, pad.left, 15);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [diverging, heightUm, label, lengthUm, nx, ny, transform, values]);

  return <canvas ref={canvasRef} className="heatmap-canvas" aria-label={label} />;
}

function sequentialColor(value: number) {
  return [Math.round(237 - 200 * value), Math.round(246 - 82 * value), Math.round(248 - 96 * value)];
}

function divergingColor(value: number) {
  if (value < 0.5) {
    const scaled = value * 2;
    return [Math.round(46 + 209 * scaled), Math.round(105 + 150 * scaled), Math.round(155 + 100 * scaled)];
  }
  const scaled = (value - 0.5) * 2;
  return [255, Math.round(255 - 172 * scaled), Math.round(255 - 194 * scaled)];
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
