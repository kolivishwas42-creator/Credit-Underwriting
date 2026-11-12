import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { applyTheme, savedTheme } from "./shared/theme";
import "./shared/styles/tokens.css";
import "./shared/styles/shell.css";
import "./shared/styles/agent-theme.css";
import "./shared/styles/result.css";

// the saved light / dark choice is applied before the first paint
applyTheme(savedTheme());

createRoot(document.getElementById("app")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
