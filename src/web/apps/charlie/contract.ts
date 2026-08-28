// This app's conformance to the sub-app half of the contract.
//
// The consuming half needs no file: the app's own imports of "@pointer/subapp"
// are typechecked against whichever contract the matrix re-points that
// specifier at. This covers the other direction - what the shell renders.
//
// Never bundled. It is not an entrypoint of any build.

import type { SubApp } from "@pointer/subapp";
import App from "./index.tsx";

export const conforms: SubApp = App;
