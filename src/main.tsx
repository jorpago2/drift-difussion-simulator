import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ScientificUiProvider } from "@jorpago2/scientific-ui";
import App from "./App";
import "./carbon.scss";
import "./styles.css";
import "@jorpago2/scientific-ui/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("The application root is missing.");
createRoot(root).render(<StrictMode><ScientificUiProvider><App /></ScientificUiProvider></StrictMode>);
