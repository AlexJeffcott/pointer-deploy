// Reads namespaces it did not create. alpha and bravo live on the other view
// and are not loaded here, yet their counts are present: the store belongs to
// the shell, not to whichever bundle happens to be on screen.

import { render } from "preact";
import { countOf, increment, register, snapshot, user } from "@pointer/shell";
import styles from "./app.module.css";

const NS = "charlie";

function Charlie() {
  const who = user.value;
  return (
    <section class={styles.panel} style={{ borderTopColor: who.colour }} data-unit-marker={__UNIT_MARKER__}>
      <p class={styles.name}>{NS}</p>
      <p class={styles.count} style={{ color: who.colour }}>
        {countOf(NS)}
      </p>
      <button type="button" class={styles.button} onClick={() => increment(NS)}>
        +1
      </button>

      <p class={styles.heading}>Every namespace</p>
      <table class={styles.table}>
        <thead>
          <tr>
            <th>Namespace</th>
            <th style={{ textAlign: "right" }}>Count</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.value.map(([ns, n]) => (
            <tr key={ns} class={ns === NS ? styles.mine : undefined}>
              <td data-ns={ns}>{ns}</td>
              <td data-count-for={ns}>{n}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class={styles.who}>Read by {who.name}.</p>
    </section>
  );
}

export function mount(el: HTMLElement): () => void {
  register(NS);
  render(<Charlie />, el);
  return () => render(null, el);
}
