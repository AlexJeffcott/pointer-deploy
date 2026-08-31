import { createContext } from "preact";
import type { ShellStore } from "./api.ts";

export const StoreContext = createContext<ShellStore | null>(null);
