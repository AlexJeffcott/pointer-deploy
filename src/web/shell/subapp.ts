import type { ComponentType } from "preact";
import type { ShellStore } from "@pointer/shell";

export type SubAppProps = { store: ShellStore };

export type SubApp = ComponentType<SubAppProps>;
