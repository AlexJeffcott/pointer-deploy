import { useLayoutEffect, useState } from "preact/hooks";
import type { SubAppProps } from "@pointer/subapp";
import styles from "./app.module.css";

const NS = "alpha";

export default function Alpha({ store }: SubAppProps) {
  const who = store.user();
  // The colour on this border comes from user.colour, so a deprecation of that
  // field is a fact about this panel and is said here rather than only on /api.
  const colour = store.goingAway("user.colour");
  // The buttons this panel draws are the service's, not this bundle's. A step
  // changed on the service changes what alpha offers, with nothing rebuilt.
  const { step, max } = store.limits();
  const mine = store.countOf(NS);
  const full = mine >= max;
  const [boom, setBoom] = useState(false);
  useLayoutEffect(() => {
    store.register(NS);
  }, [store]);
  if (boom) throw new Error(`${NS} was asked to throw`);

  return (
    <section class={styles.panel} style={{ borderTopColor: who.colour }} data-unit-marker={__UNIT_MARKER__}>
      <p class={styles.name}>{NS}</p>
      {/* The count is this paragraph's whole text, and has to stay that way:
          three checks read `p:nth-of-type(2)` to know what this panel shows.
          The ceiling goes in its own element rather than beside the number. */}
      <p class={styles.count} style={{ color: who.colour }}>
        {mine}
      </p>
      <p class={styles.of} data-max={max}>
        of {max}
      </p>
      <div class={styles.row}>
        <button
          type="button"
          class={styles.button}
          disabled={full}
          onClick={() => store.increment(NS)}
        >
          +1
        </button>
        <button
          type="button"
          class={styles.button}
          data-step={step}
          disabled={full}
          onClick={() => store.increment(NS, step)}
        >
          +{step}
        </button>
        <button
          type="button"
          class={styles.button}
          data-step={step * 2}
          disabled={full}
          onClick={() => store.increment(NS, step * 2)}
        >
          +{step * 2}
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
        Counting for {who.name}.
        {colour ? (
          <span class={styles.going} data-going="user.colour">
            {" "}
            The service retires <code>user.colour</code> on {colour.sunset}
            {colour.instead ? ` in favour of ${colour.instead}` : ", with nothing named to replace it"}.
          </span>
        ) : null}
      </p>
    </section>
  );
}
