import { useLayoutEffect, useState } from "preact/hooks";
import type { SubAppProps } from "@pointer/subapp";
import styles from "./app.module.css";

const NS = "charlie";

export default function Charlie({ store }: SubAppProps) {
  const who = store.user();
  const rows = store.snapshot();
  const total = rows.reduce((n, [, v]) => n + v, 0);
  const service = store.service();
  const going = service.fields.filter((f) => f.going !== null);
  const showTotals = store.flags().showTotals;
  // Two numbers that should match, produced on opposite sides of a network.
  // A page that only ever showed its own sum could not tell you the boundary
  // was there at all.
  const said = store.stats().total;
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
              <td data-ns={ns}>{store.labelFor(ns).title}</td>
              <td data-count-for={ns}>{n}</td>
            </tr>
          ))}
        </tbody>
        {showTotals ? (
          <tfoot data-totals>
            <tr>
              <td>total</td>
              <td data-total={total} style={{ textAlign: "right" }}>
                {total}
              </td>
            </tr>
          </tfoot>
        ) : null}
      </table>
      <p class={styles.caption} data-source={service.state}>
        {service.base === ""
          ? "No service was named, so every count above is this page's own."
          : service.state === "ok"
            ? `Read over ${service.calling} at ${service.readAt?.slice(11, 19)}Z · ${service.fields.length - going.length} of ${service.fields.length} fields current`
            : service.state === "failed"
              ? `The service did not answer: ${service.error}. The counts above are this page's own.`
              : "The service has not answered yet."}
      </p>
      <p class={styles.agree} data-agrees={String(said === total)}>
        {said === total
          ? `The service counts ${said} too.`
          : `The service counts ${said}, and this page counts ${total}.`}
      </p>
      <p class={styles.who}>
        Read by <b data-initials={who.initials}>{who.initials}</b> ({who.name}).
      </p>
    </section>
  );
}
