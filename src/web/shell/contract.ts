import type * as Contract from "@pointer/shell";
import type { SubAppProps } from "@pointer/subapp";
import * as actual from "./api.ts";

export const provides: typeof Contract = actual;

declare const store: Contract.ShellStore;
export const passes: SubAppProps = { store };
