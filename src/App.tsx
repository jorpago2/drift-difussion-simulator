import { BjtLab } from "./labs/BjtLab";
import { PnLab } from "./labs/PnLab";

export default function App() {
  const Lab = location.pathname.toLowerCase().endsWith("bjt.html") ? BjtLab : PnLab;
  return <div className="min-h-dvh bg-ui-canvas-muted font-ui-body text-ui-ink"><Lab /></div>;
}
