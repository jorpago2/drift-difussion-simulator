import { Column, Grid } from "@carbon/react";
import { BjtLab } from "./labs/BjtLab";
import { PnLab } from "./labs/PnLab";

export default function App() {
  const Lab = location.pathname.toLowerCase().endsWith("bjt.html") ? BjtLab : PnLab;
  return <Grid fullWidth condensed className="app-shell"><Column sm={4} md={8} lg={16} className="app-shell-column"><Lab /></Column></Grid>;
}
