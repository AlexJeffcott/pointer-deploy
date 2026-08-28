// The shell's shared state, and the type a sub-app is handed.
//
// A sub-app receives this as a PROP. It does not import it at runtime: the only
// import it needs is the type, and a type-only import is erased before the
// bundle exists. That is the whole difference from the module-level singleton
// this replaced - a test constructs a second store with `createStore` and
// passes it in, which a module-level export could never allow.
//
// Deliberately NO `Signal<T>` in the surface. Every accessor reads a signal's
// `.value` inside itself, and that subscribes whichever component is rendering,
// so reactivity survives without `@preact/signals` appearing in the contract at
// all. `ComponentType` in subapp.ts is then the ONLY vendor type the contract
// references, and pinning one is a job small enough to do - see the TODO, §9.

import { computed, signal } from "@preact/signals";

export type User = { name: string; colour: string };

/** Every namespace and its count, in a stable order. */
export type Counts = ReadonlyArray<readonly [string, number]>;

/**
 * What the shell provides and a sub-app consumes.
 *
 * Accessors rather than fields: a field would have to be a signal to stay
 * reactive, and a signal in this type puts a vendor package into the contract
 * hash. A call reads the signal internally and subscribes the caller.
 */
export type ShellStore = {
  user(): User;
  setName(name: string): void;
  setColour(colour: string): void;
  /** Make a namespace visible at zero before anyone increments it. */
  register(ns: string): void;
  increment(ns: string, by?: number): void;
  countOf(ns: string): number;
  reset(ns: string): void;
  snapshot(): Counts;
};

/**
 * One independent store.
 *
 * The shell makes one and provides it. Nothing else in the application calls
 * this; a test does, to hand a sub-app a store it controls.
 */
export function createStore(initial?: Partial<User>): ShellStore {
  const user = signal<User>({
    name: initial?.name ?? "Alex",
    colour: initial?.colour ?? "#1f5fd0",
  });

  // One signal holding the whole map, rather than a signal per namespace: a
  // sub-app that wants to list every namespace it did not create needs the set
  // of keys to be reactive too.
  const counters = signal<Record<string, number>>({});

  const snapshot = computed<Counts>(() =>
    Object.entries(counters.value).sort(([a], [b]) => a.localeCompare(b)),
  );

  return {
    user: () => user.value,
    setName: (name) => {
      user.value = { ...user.value, name };
    },
    setColour: (colour) => {
      user.value = { ...user.value, colour };
    },
    register: (ns) => {
      if (ns in counters.value) return;
      counters.value = { ...counters.value, [ns]: 0 };
    },
    increment: (ns, by = 1) => {
      counters.value = { ...counters.value, [ns]: (counters.value[ns] ?? 0) + by };
    },
    countOf: (ns) => counters.value[ns] ?? 0,
    reset: (ns) => {
      counters.value = { ...counters.value, [ns]: 0 };
    },
    snapshot: () => snapshot.value,
  };
}
