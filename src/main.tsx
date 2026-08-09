import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GlobalTheme } from "@carbon/react";
import App from "./App";
import "./carbon.scss";
import "./styles.css";
import "@jorpago2/scientific-ui/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("The application root is missing.");
document.documentElement.classList.add("cds--g10");

createRoot(root).render(<StrictMode><GlobalTheme theme="g10"><App /></GlobalTheme></StrictMode>);
