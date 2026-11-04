import * as React from "react";
import * as ReactDOM from "react-dom";
import * as jsx from "react/jsx-runtime";
import * as jsxDev from "react/jsx-dev-runtime";
import * as stay from "./StayHere";
import * as contract from "./bricks/contract";
// Prepared bundles resolve only this versioned namespace, sharing the host's React.
export const pluginAPI = { React, ReactDOM, jsx, jsxDev, contract, stay };
(globalThis as typeof globalThis & { __E2A2O_PLUGIN_V1__: typeof pluginAPI }).__E2A2O_PLUGIN_V1__ = pluginAPI;
