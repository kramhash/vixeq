import React from "react";
import { renderToString } from "react-dom/server";
import { createProject } from "@vixeq/core";
import { StandaloneSequencePlayer } from "@vixeq/player-react";

const html = renderToString(
  React.createElement(StandaloneSequencePlayer, {
    defaultProject: createProject({ stepCount: 8, trackCount: 1 }),
    showTransportControls: false,
  }),
);

if (!html.includes("vixeq-player")) {
  throw new Error("Expected packed player-react SSR render to include the player root class.");
}
