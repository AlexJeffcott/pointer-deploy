import { computed, signal } from "@preact/signals";

export type User = { name: string; colour: string };

export type Counts = ReadonlyArray<readonly [string, number]>;

export type ShellStore = {
  user(): User;
  setName(name: string): void;
  setColour(colour: string): void;
  register(ns: string): void;
  increment(ns: string, by?: number): void;
  countOf(ns: string): number;
  reset(ns: string): void;
  snapshot(): Counts;
};

export function createStore(initial?: Partial<User>): ShellStore {
  const user = signal<User>({
    name: initial?.name ?? "Alex",
    colour: initial?.colour ?? "#1f5fd0",
  });

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
