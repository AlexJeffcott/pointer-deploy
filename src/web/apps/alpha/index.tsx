// A self-contained sub-app. Its own bundle, its own stylesheet, loaded from the
// object store when its view first appears.
//
// It imports Preact and the shell store as bare specifiers. Those are marked
// external at build time and resolved by the shell's import map, so this file
// shares one Preact instance and one store with everything else on the page.

import { render } from "preact";
import { countOf, increment, register, user } from "@pointer/shell";
import styles from "./app.module.css";

const NS = "alpha";

function Alpha() {
  const who = user.value;
  return (
    <section class={styles.panel} style={{ borderTopColor: who.colour }} data-unit-marker={__UNIT_MARKER__}>
      <p class={styles.name}>{NS}</p>
      <p class={styles.count} style={{ color: who.colour }}>
        {countOf(NS)}
      </p>
      <div class={styles.row}>
        <button type="button" class={styles.button} onClick={() => increment(NS)}>
          +1
        </button>
        <button type="button" class={styles.button} onClick={() => increment(NS, 5)}>
          +5
        </button>
      </div>
      <p class={styles.who}>Counting for {who.name}.</p>
    </section>
  );
}

export function mount(el: HTMLElement): () => void {
  register(NS);
  render(<Alpha />, el);
  return () => render(null, el);
}
