import { useLayoutEffect, useState } from "preact/hooks";
import type { SubAppProps } from "@pointer/subapp";
import styles from "./app.module.css";

const NS = "delta";

export default function Delta({ store }: SubAppProps) {
  const who = store.user();
  const rows = store.snapshot();
  const total = rows.reduce((n, [, v]) => n + v, 0);
  const peak = Math.max(1, ...rows.map(([, v]) => v));
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
