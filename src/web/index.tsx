import { render } from "preact";
import "./theme.css";
import { App } from "./App.tsx";
import { build, marker, readBuildInfo } from "./state.ts";

const root = document.getElementById("app");
if (!root) throw new Error("#app is missing from the shell");

build.value = readBuildInfo();
if (marker) document.documentElement.dataset.buildMarker = marker;

render(<App />, root);
