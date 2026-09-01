import { useLayoutEffect, useState } from "preact/hooks";
import type { SubAppProps } from "@pointer/subapp";
import styles from "./app.module.css";

const NS = "delta";

export default function Delta({ store }: SubAppProps) {
  const who = store.user();
  const rows = store.snapshot();
  const total = rows.reduce((n, [, v]) => n + v, 0);
  const peak = Math.max(1, ...rows.map(([, v]) => v));
  // The shares below are a claim about the whole set of counters. While the
  // service has not answered, this page holds only what happened in this tab,
  // so the bars are drawn as what they are: a partial reading, not a total.
  const service = store.service();
  const settled = service.base === "" || service.state === "ok";
  const showShares = store.flags().showShares;
  const busiest = store.stats().busiest;
  const [boom, setBoom] = useState(false);
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
      <div class={settled ? styles.bars : `${styles.bars} ${styles.stale}`} data-bars={settled ? "settled" : service.state}>
        {rows.map(([ns, n]) => (
          <div key={ns} class={ns === busiest ? `${styles.bar} ${styles.busiest}` : styles.bar}>
            <span data-ns={ns}>
              <span class={styles.emoji}>{store.labelFor(ns).emoji}</span>
              {store.labelFor(ns).title}
            </span>
            <span class={styles.track}>
              <span
                class={styles.fill}
                style={{ width: `${(n / peak) * 100}%`, background: who.colour }}
              />
            </span>
            <span data-count-for={ns}>{n}</span>
            {showShares ? (
              <span class={styles.share} data-share-for={ns}>
                {total > 0 ? `${Math.round((n / total) * 100)}%` : "-"}
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <p class={styles.total} data-total={total}>
        {total} across {rows.length} namespaces, for {who.name}.
        {busiest ? (
          <span data-busiest={busiest}> The service says {store.labelFor(busiest).title} is busiest.</span>
        ) : null}
        {settled ? null : (
          <span class={styles.stalenote} data-stale={service.state}>
            {" "}
            {service.state === "failed"
              ? `The service did not answer, so this is what this tab counted: ${service.error}`
              : "The service has not answered yet, so this is what this tab counted."}
          </span>
        )}
      </p>
    </section>
  );
}
