import { render } from "preact";
import { countOf, counters, increment, register, user } from "@pointer/shell";
import styles from "./app.module.css";

const NS = "bravo";

function Bravo() {
  const who = user.value;
  const mine = countOf(NS);
  return (
    <section class={styles.panel} style={{ borderTopColor: who.colour }} data-unit-marker={__UNIT_MARKER__}>
      <p class={styles.name}>{NS}</p>
      <p class={styles.count} style={{ color: who.colour }}>
        {mine}
      </p>
      <div class={styles.row}>
        <button type="button" class={styles.button} onClick={() => increment(NS)}>
          +1
        </button>
        <button
          type="button"
          class={styles.button}
          disabled={mine === 0}
          onClick={() => increment(NS, -1)}
        >
          -1
        </button>
        <button
          type="button"
          class={styles.button}
          disabled={mine === 0}
          onClick={() => {
            counters.value = { ...counters.value, [NS]: 0 };
          }}
        >
          Reset
        </button>
      </div>
      <p class={styles.who}>Counting for {who.name}.</p>
    </section>
  );
}

export function mount(el: HTMLElement): () => void {
  register(NS);
  render(<Bravo />, el);
  return () => render(null, el);
}
