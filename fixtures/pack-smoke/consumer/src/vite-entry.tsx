import { createProject } from "@vixeq/core";
import { StandaloneSequencePlayer } from "@vixeq/player-react";
import "@vixeq/player-react/styles.css";
import React from "react";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Pack smoke root element is missing.");
}

createRoot(root).render(
  <StandaloneSequencePlayer
    defaultProject={createProject({ stepCount: 8, trackCount: 1 })}
    showTransportControls={false}
  />,
);
