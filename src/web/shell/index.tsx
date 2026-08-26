import { render } from "preact";
import "../theme.css";
import { Shell } from "./Shell.tsx";

const root = document.getElementById("app");
if (!root) throw new Error("#app is missing from the shell");

render(<Shell />, root);
