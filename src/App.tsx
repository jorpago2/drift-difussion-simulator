import { BjtLab } from "./labs/BjtLab";
import { PnLab } from "./labs/PnLab";

export default function App() {
  const Lab = location.pathname.toLowerCase().endsWith("bjt.html") ? BjtLab : PnLab;
  return <Lab />;
}
