// Reads namespaces it did not create. alpha and bravo live on the other view
// and are not loaded here, yet their counts are present: the store belongs to
// the shell, not to whichever bundle happens to be on screen.

import { useLayoutEffect, useState } from "preact/hooks";
import type { SubAppProps } from "@pointer/subapp";
import styles from "./app.module.css";

const NS = "charlie";

export default function Charlie({ store }: SubAppProps) {
  const who = store.user();
  const rows = store.snapshot();
  const total = rows.reduce((n, [, v]) => n + v, 0);
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
        {store.countOf(NS)}
      </p>
      <div class={styles.row}>
        <button type="button" class={styles.button} onClick={() => store.increment(NS)}>
          +1
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

      <p class={styles.heading}>Every namespace</p>
      <table class={styles.table}>
        <thead>
          <tr>
            <th>Namespace</th>
            <th style={{ textAlign: "right" }}>Count</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([ns, n]) => (
            <tr key={ns} class={ns === NS ? styles.mine : undefined}>
              <td data-ns={ns}>{ns}</td>
              <td data-count-for={ns}>{n}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {/* No data-ns here on purpose: the totals view asserts on the set of
              namespaces it lists, and a total is not one of them. */}
          <tr>
            <td>total</td>
            <td data-total={total} style={{ textAlign: "right" }}>
              {total}
            </td>
          </tr>
        </tfoot>
      </table>
      <p class={styles.who}>Read by {who.name}.</p>
    </section>
  );
}
