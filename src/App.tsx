import { BjtLab } from "./labs/BjtLab";
import { PnLab } from "./labs/PnLab";

export default function App() {
  return location.pathname.toLowerCase().endsWith("bjt.html") ? <BjtLab /> : <PnLab />;
}
