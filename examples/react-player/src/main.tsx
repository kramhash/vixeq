import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@viseq/player-react/styles.css";
import "./styles.css";

createRoot(document.querySelector("#root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
