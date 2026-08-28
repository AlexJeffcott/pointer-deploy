// A self-contained sub-app. Its own bundle, its own stylesheet, loaded from the
// object store when its view first appears.
//
// It imports NOTHING from the shell at runtime. The store arrives as a prop, so
// the only shell import is a type, and a type-only import is erased before the
// bundle exists. Preact's JSX runtime is the one bare specifier left, resolved
// by the import map to the shell's copy - which is still what keeps one Preact
// and one signals runtime on the page.

import { useEffect, useState } from "preact/hooks";
import type { SubAppProps } from "@pointer/subapp";
import styles from "./app.module.css";

const NS = "alpha";

export default function Alpha({ store }: SubAppProps) {
  const who = store.user();
  const [boom, setBoom] = useState(false);
  useEffect(() => {
    store.register(NS);
  }, [store]);
  // Thrown during render, so the loader's boundary catches it. A throw from
  // inside the click handler would reach no boundary at all.
  if (boom) throw new Error(`${NS} was asked to throw`);

  return (
    <section class={styles.panel} style={{ borderTopColor: who.colour }} data-unit-marker={__UNIT_MARKER__}>
      <p class={styles.name}>{NS}</p>
      <p class={styles.count} style={{ color: who.colour }}>
        {store.countOf(NS)}
      </p>
      <div class={styles.row}>
        <button type="button" class={styles.button} onClick={() => store.increment(NS)}>
          +1
        </button>
        <button type="button" class={styles.button} onClick={() => store.increment(NS, 5)}>
          +5
        </button>
        <button type="button" class={styles.button} onClick={() => store.increment(NS, 10)}>
          +10
        </button>
        <button
          type="button"
          class={styles.button}
          data-throw={NS}
          onClick={() => setBoom(true)}
        >
          Throw
        </button>
      </div>
      <p class={styles.who}>Counting for {who.name}.</p>
    </section>
  );
}
