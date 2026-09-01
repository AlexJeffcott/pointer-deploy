import type { SubAppProps } from "@pointer/subapp";
import styles from "./app.module.css";

const NS = "echo";

/**
 * What is inside the service, as the service says it, §26.
 *
 * It fetches nothing. The shell owns the one read and hands the reading down
 * with the store, so this panel can be rolled back to a build from last month
 * and still be shown today's service - which is the whole claim the project
 * makes about units, applied to the one surface with no compiler behind it.
 *
 * No counter is registered here on purpose. This panel reports on the service
 * and takes no part in the shared state, so the totals views count four
 * namespaces whether anybody has opened this view or not.
 */
export default function Echo({ store }: SubAppProps) {
  const who = store.user();
  const report = store.service();
  const going = report.fields.filter((f) => f.going !== null).length;
  // The one field of the service's own bookkeeping this panel reads: when the
  // counters it is reporting on last moved, as the SERVICE saw it.
  const updatedAt = store.stats().updatedAt;

  return (
    <section class={styles.panel} style={{ borderTopColor: who.colour }} data-unit-marker={__UNIT_MARKER__}>
      <p class={styles.name}>{NS}</p>

      {report.base === "" ? (
        <p class={styles.blank} data-service-state="none">
          This origin names no service, so there is nothing to read. The page runs
          on the store's own defaults.
        </p>
      ) : (
        <>
          <p class={styles.base}>
            <code data-service-base={report.base}>{report.base}</code>
            <span class={styles[report.state]} data-service-state={report.state}>
              {report.state === "ok" ? "read" : report.state}
            </span>
          </p>

          <p class={styles.heading}>Versions</p>
          <p class={styles.serves} data-serves={report.serves.join(",")}>
            {report.serves.length === 0
              ? "none reported"
              : report.serves.map((v) => (
                  <span
                    key={v}
                    class={v === report.calling ? styles.calling : styles.version}
                    data-version={v}
                  >
                    {v}
                    {v === report.calling ? " · this shell calls it" : ""}
                  </span>
                ))}
          </p>
          {report.serves.length > 0 && !report.serves.includes(report.calling) ? (
            <p class={styles.warn} data-api-gone={report.calling}>
              This shell calls {report.calling}, and the service no longer answers it.
            </p>
          ) : null}

          <p class={styles.heading}>
            Fields in {report.calling}
            {report.fields.length > 0 ? ` · ${going} of ${report.fields.length} going away` : ""}
          </p>
          {report.fields.length === 0 ? (
            <p class={styles.blank} data-no-schema>
              {report.state === "ok"
                ? "This deploy answers the version and publishes no schema for it."
                : "Not read yet."}
            </p>
          ) : (
            <table class={styles.table}>
              <tbody>
                {report.fields.map((f) => (
                  <tr key={f.path} class={f.going ? styles.dying : undefined}>
                    <td data-field={f.path}>{f.path}</td>
                    <td class={styles.type}>{f.type}</td>
                    <td>
                      {f.going ? (
                        <span data-going={f.path} title={f.going.reason}>
                          gone {f.going.sunset}
                          {f.going.instead ? ` → ${f.going.instead}` : " · nothing to move to"}
                        </span>
                      ) : (
                        <span class={styles.fine}>current</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {report.fields.some((f) => f.going) ? (
            <ul class={styles.reasons}>
              {report.fields
                .filter((f) => f.going)
                .map((f) => (
                  <li key={f.path} data-reason-for={f.path}>
                    <b>{f.path}</b>: {f.going!.reason} (said {f.going!.since})
                  </li>
                ))}
            </ul>
          ) : null}

          <p class={styles.heading}>Routes</p>
          <ul class={styles.routes}>
            {report.routes.length === 0 ? (
              <li class={styles.blank}>none published</li>
            ) : (
              report.routes.map((r) => (
                <li key={`${r.method} ${r.path}`} data-route={`${r.method} ${r.path}`}>
                  <span class={styles.method}>{r.method}</span> {r.path}
                </li>
              ))
            )}
          </ul>

          <p class={styles.who}>
            {report.readAt ? `Read at ${report.readAt.slice(11, 19)}Z.` : "Not read yet."}
            {updatedAt ? (
              <>
                {" "}
                The service last moved a counter at{" "}
                <span data-counters-updated={updatedAt}>{updatedAt.slice(11, 19)}Z</span>.
              </>
            ) : null}
            {report.headerSunset ? (
              <>
                {" "}
                A data response carried <code data-header-sunset={report.headerSunset}>Sunset:{" "}
                {report.headerSunset}</code>.
              </>
            ) : null}
            {report.error ? (
              <>
                {" "}
                <span class={styles.warn} data-service-error={report.error}>
                  {report.error}
                </span>
              </>
            ) : null}
          </p>
        </>
      )}
    </section>
  );
}
