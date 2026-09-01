import { useLayoutEffect, useState } from "preact/hooks";
import type { SubAppProps } from "@pointer/subapp";
import styles from "./app.module.css";

const NS = "bravo";

/**
 * Whole days from now to a sunset date, negative once it has passed.
 *
 * Computed here rather than taken from the store. The store carries the date
 * the service published; how long that leaves is a reading this panel makes
 * when it draws, and a number baked in at hydrate would be wrong by the time
 * anybody looked at it.
 */
const daysTo = (sunset: string): number =>
  Math.ceil((Date.parse(`${sunset}T00:00:00Z`) - Date.now()) / 86_400_000);

export default function Bravo({ store }: SubAppProps) {
  const who = store.user();
  const mine = store.countOf(NS);
  const { max, allowNegative } = store.limits();
  const going = store.goingAway("user.colour");
  const left = going ? daysTo(going.sunset) : null;
  const [boom, setBoom] = useState(false);
  useLayoutEffect(() => {
    store.register(NS);
  }, [store]);
  if (boom) throw new Error(`${NS} was asked to throw`);

  return (
    <section class={styles.panel} style={{ borderTopColor: who.colour }} data-unit-marker={__UNIT_MARKER__}>
      <p class={styles.name}>
        {NS}
        {left === null ? null : (
          <span
            class={left <= 30 ? `${styles.badge} ${styles.urgent}` : styles.badge}
            data-sunset-days={left}
            title={going!.reason}
          >
            {left < 0 ? `user.colour went ${-left} days ago` : `user.colour: ${left} days`}
          </span>
        )}
      </p>
      <p class={styles.count} style={{ color: who.colour }}>
        {mine}
      </p>
      <div class={styles.row}>
        <button
          type="button"
          class={styles.button}
          disabled={mine >= max}
          onClick={() => store.increment(NS)}
        >
          +1
        </button>
        {/* Not drawn at all when the service says no, rather than drawn and
            disabled: a control that is never usable is not a control, and the
            difference has to be visible from across the room. */}
        {allowNegative ? (
          <button
            type="button"
            class={styles.button}
            data-allow-negative
            onClick={() => store.increment(NS, -1)}
          >
            -1
          </button>
        ) : null}
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
      <p class={styles.who}>
        Counting for {who.name}. {allowNegative ? "It may go below zero." : "It may not go below zero."}
      </p>
    </section>
  );
}
