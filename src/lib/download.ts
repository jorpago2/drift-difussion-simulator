export function downloadText(content: string, filename: string): void {
  downloadBlob(new Blob([content], { type: "text/csv;charset=utf-8" }), filename);
}

export function downloadCanvas(canvas: HTMLCanvasElement | null, filename: string): void {
  canvas?.toBlob((blob) => {
    if (blob) downloadBlob(blob, filename);
  }, "image/png");
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
