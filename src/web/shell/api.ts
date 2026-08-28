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
//
// --- The rule, decided on 2026-08-28 (TODO §15) ---------------------------
//
// 1. Shared state is DECLARED here. This file is the whole of what one sub-app
//    can say to another.
// 2. A sub-app publishes none. It receives the store and reads and writes what
//    the store already declares; it cannot add a value for another sub-app to
//    read. `build.ts` refuses any specifier outside SHARED, so an app-to-app
//    import is a build failure and not a bug nobody can observe.
// 3. An ADDITION here is additive and cheap. It mints a new contract, which
//    every unit must be rebuilt to claim - and it forces no republish, because
//    the shell goes on compiling against the retained contract and every
//    published unit keeps the set it was built with. Measured, not assumed:
//
//      | change            | shell x old | app x old | promote  |
//      | baseline          | pass        | pass      | allowed  |
//      | one export ADDED  | pass        | pass      | allowed  |
//      | one export REMOVED| fail        | pass      | refused  |
//
//    So a removal or a narrowing is the expensive change, not an addition.
//
// What rule 2 does NOT cover, and saying so is the point of writing it down:
// nothing stops alpha writing `window.__alpha` and bravo reading it, or the two
// agreeing through localStorage, a custom event or a data- attribute.
// `specifiersIn` in build.ts reads imports and nothing else. A scan of the
// emitted bundle for `window.`, `localStorage` and `dispatchEvent` could warn
// and could never prove - a computed property access defeats it - so the rule
// here is a rule and not a guarantee.
//
// Accepted and not fixed: `counters` is ONE signal holding a map, so there is
// no `Signal<number>` per namespace and a sub-app cannot hand "the alpha
// counter" to anything that takes a signal. The reason is below, at the signal.

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
