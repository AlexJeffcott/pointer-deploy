import { useState } from "preact/hooks";
import type { SubAppProps } from "@pointer/subapp";
import styles from "./app.module.css";

/**
 * The whole application, for now.
 *
 * It owns no state. The greeting belongs to the shell, arrives as a prop, and
 * is written back through the same store - so this bundle and the frame stay
 * one page while being deployed on separate days.
 */
export default function Hello({ store }: SubAppProps) {
  const { text, audience } = store.greeting();
  // The audience on this line comes from greeting.audience, so a deprecation of
  // that field is a fact about this panel and is said here as well as on
  // /service.
  const going = store.goingAway("greeting.audience");
  const [boom, setBoom] = useState(false);
  if (boom) throw new Error("hello was asked to throw");

  return (
    <section class={styles.panel} data-unit-marker={__UNIT_MARKER__}>
      {/* The greeting is this paragraph's whole text and has to stay that way:
          the checks read it to know what this panel shows. */}
      <p class={styles.greeting} data-greeting>
        {audience ? `${text}, ${audience}` : text}
      </p>

      <div class={styles.row}>
        <label class={styles.label} for="audience">
          Audience
        </label>
        <input
          id="audience"
          class={styles.input}
          type="text"
          value={audience}
          onInput={(e: Event) =>
            store.setGreeting({ audience: (e.currentTarget as HTMLInputElement).value })
          }
        />
        <button
          type="button"
          class={styles.button}
          data-throw="hello"
          onClick={() => setBoom(true)}
        >
          Throw
        </button>
      </div>

      {going ? (
        <p class={styles.going} data-going="greeting.audience">
          The service retires <code>greeting.audience</code> on {going.sunset}
          {going.instead ? ` in favour of ${going.instead}` : ", with nothing named to replace it"}.
        </p>
      ) : null}
    </section>
  );
}
