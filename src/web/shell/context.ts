// The one channel a sub-app reaches the store through.
//
// `null` is the default on purpose: it is what lets AsyncAppLoader tell
// "nobody has provided a store" from "one is already provided above me". A
// non-null default would make a missing Provider silently work with the wrong
// store, which is the failure this whole change exists to remove.

import { createContext } from "preact";
import type { ShellStore } from "./api.ts";

export const StoreContext = createContext<ShellStore | null>(null);
