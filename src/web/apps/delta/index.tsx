import { render } from "preact";
import { countOf, increment, register, snapshot, user } from "@pointer/shell";
import styles from "./app.module.css";

const NS = "delta";

function Delta() {
  const who = user.value;
  const rows = snapshot.value;
  const total = rows.reduce((n, [, v]) => n + v, 0);
  const peak = Math.max(1, ...rows.map(([, v]) => v));

  return (
    <section class={styles.panel} style={{ borderTopColor: who.colour }} data-unit-marker={__UNIT_MARKER__}>
      <p class={styles.name}>{NS}</p>
      <p class={styles.count} style={{ color: who.colour }}>
        {countOf(NS)}
      </p>
      <button type="button" class={styles.button} onClick={() => increment(NS)}>
        +1
      </button>

      <p class={styles.heading}>Share of every count</p>
      <div class={styles.bars}>
        {rows.map(([ns, n]) => (
          <div key={ns} class={styles.bar}>
            <span data-ns={ns}>{ns}</span>
            <span class={styles.track}>
              <span
                class={styles.fill}
                style={{ width: `${(n / peak) * 100}%`, background: who.colour }}
              />
            </span>
            <span data-count-for={ns}>{n}</span>
            {/* Outside data-count-for, which is read as a bare number, and
                after the track, whose child span is the bar being measured. */}
            <span class={styles.share} data-share-for={ns}>
              {total > 0 ? `${Math.round((n / total) * 100)}%` : "-"}
            </span>
          </div>
        ))}
      </div>
      <p class={styles.total} data-total={total}>
        {total} across {rows.length} namespaces, for {who.name}.
      </p>
    </section>
  );
}

export function mount(el: HTMLElement): () => void {
  register(NS);
  render(<Delta />, el);
  return () => render(null, el);
}
