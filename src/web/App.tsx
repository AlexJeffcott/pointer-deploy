import { build, clicks, shortCommit } from "./state.ts";
import styles from "./App.module.css";

export function App() {
  const info = build.value;

  return (
    <main class={styles.main}>
      <h1 class={styles.title}>pointer-deploy</h1>
      <p class={styles.lede}>
        This page was assembled by a Bun server that holds none of its files. Every
        script and stylesheet here came from the build the channel points at.
      </p>

      <section class={styles.section}>
        <h2 class={styles.heading}>Client</h2>
        <button type="button" class={styles.button} onClick={() => clicks.value++}>
          Clicked {clicks} {clicks.value === 1 ? "time" : "times"}
        </button>
      </section>

      <section class={styles.section}>
        <h2 class={styles.heading}>Build</h2>
        {info ? (
          <dl class={styles.facts}>
            <dt>Build</dt>
            <dd data-build-id={info.buildId}>{info.buildId}</dd>
            <dt>Channel</dt>
            <dd>{info.channel}</dd>
            <dt>Region</dt>
            <dd>{info.region}</dd>
            <dt>Commit</dt>
            <dd>{shortCommit}</dd>
            <dt>Published</dt>
            <dd>{info.publishedAt}</dd>
          </dl>
        ) : (
          <p class={styles.missing}>
            The shell carried no build information. The server did not read a manifest.
          </p>
        )}
      </section>
    </main>
  );
}
