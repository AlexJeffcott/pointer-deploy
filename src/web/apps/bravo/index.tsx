import { useLayoutEffect, useState } from "preact/hooks";
import type { SubAppProps } from "@pointer/subapp";
import styles from "./app.module.css";

const NS = "bravo";

export default function Bravo({ store }: SubAppProps) {
  const who = store.user();
  const mine = store.countOf(NS);
  const [boom, setBoom] = useState(false);
  // Layout, not plain effect: registration must land BEFORE paint, or a panel
  // that lists every namespace draws one short for a frame - which is what a
  // visitor would see and what the totals scenario caught.
  useLayoutEffect(() => {
    store.register(NS);
  }, [store]);
  if (boom) throw new Error(`${NS} was asked to throw`);

  return (
    <section class={styles.panel} style={{ borderTopColor: who.colour }} data-unit-marker={__UNIT_MARKER__}>
      <p class={styles.name}>{NS}</p>
      <p class={styles.count} style={{ color: who.colour }}>
        {mine}
      </p>
      <div class={styles.row}>
        <button type="button" class={styles.button} onClick={() => store.increment(NS)}>
          +1
        </button>
        <button
          type="button"
          class={styles.button}
          disabled={mine === 0}
          onClick={() => store.increment(NS, -1)}
        >
          -1
        </button>
        <button
          type="button"
          class={styles.button}
          disabled={mine === 0}
          onClick={() => store.reset(NS)}
        >
          Reset
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
