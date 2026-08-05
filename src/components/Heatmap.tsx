import { useEffect, useMemo, useRef, useState } from "react";
import type { Config, Data, Layout } from "plotly.js";
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

type PlotlyModule = typeof import("plotly.js-cartesian-dist-min").default;

export function Heatmap({ values, nx = 0, ny = 0, lengthUm = 1, heightUm = 1, label, diverging = false, transform }: Props) {
  const plotRef = useRef<HTMLDivElement>(null);
  const plotlyRef = useRef<PlotlyModule | null>(null);
  const [plotly, setPlotly] = useState<PlotlyModule | null>(null);

  const data = useMemo<Data[]>(() => {
    if (!values || !nx || !ny || values.length !== nx * ny) return [];
    const plotted = Array.from(values, (value, index) => transform ? transform(Number(value), index) : Number(value));
    let minimum = Math.min(...plotted.filter(Number.isFinite));
    let maximum = Math.max(...plotted.filter(Number.isFinite));
    if (diverging) {
      const extent = Math.max(Math.abs(minimum), Math.abs(maximum), Number.MIN_VALUE);
      minimum = -extent;
      maximum = extent;
    }
    return [{
      type: "heatmap",
      x: Array.from({ length: nx }, (_, index) => nx > 1 ? index * lengthUm / (nx - 1) : 0),
      y: Array.from({ length: ny }, (_, index) => ny > 1 ? index * heightUm / (ny - 1) : 0),
      z: Array.from({ length: ny }, (_, row) => plotted.slice(row * nx, (row + 1) * nx)),
      zmin: minimum,
      zmax: maximum > minimum ? maximum : minimum + 1,
      zmid: diverging ? 0 : undefined,
      colorscale: diverging
        ? [[0, "#053061"], [0.2, "#4393c3"], [0.4, "#d1e5f0"], [0.5, "#f7f7f7"], [0.6, "#fddbc7"], [0.8, "#d6604d"], [1, "#67001f"]]
        : "Cividis",
      colorbar: { title: { text: label }, thickness: 12 },
      hovertemplate: `x: %{x:.4g} µm<br>y: %{y:.4g} µm<br>${label}: %{z:.4g}<extra></extra>`,
    }];
  }, [diverging, heightUm, label, lengthUm, nx, ny, transform, values]);

  useEffect(() => {
    let cancelled = false;
    void import("plotly.js-cartesian-dist-min").then((module) => {
      if (cancelled) return;
      plotlyRef.current = module.default;
      setPlotly(module.default);
    });
    return () => {
      cancelled = true;
      if (plotlyRef.current && plotRef.current) plotlyRef.current.purge(plotRef.current);
    };
  }, []);

  useEffect(() => {
    const element = plotRef.current;
    if (!plotly || !element) return;
    const layout: Partial<Layout> = {
      autosize: true,
      height: 260,
      margin: { l: 58, r: 68, t: 12, b: 48 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "#ffffff",
      font: { family: "Inter, Arial, sans-serif", size: 10, color: "#40555c" },
      xaxis: { title: { text: "x (µm)" }, gridcolor: "rgba(255,255,255,.35)", showline: true, linecolor: "#9fb0b5" },
      yaxis: { title: { text: "y (µm)" }, autorange: "reversed", gridcolor: "rgba(255,255,255,.35)", showline: true, linecolor: "#9fb0b5" },
    };
    const config: Partial<Config> = { displaylogo: false, responsive: true, scrollZoom: true, modeBarButtonsToRemove: ["lasso2d", "select2d"], toImageButtonOptions: { format: "png", filename: "field-map", width: 1200, height: 700, scale: 1 } };
    void plotly.react(element, data, layout, config);
  }, [data, plotly]);

  return <div ref={plotRef} className="heatmap-plot" role="img" aria-label={label} />;
}
