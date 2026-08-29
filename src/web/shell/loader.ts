// Loads a sub-app bundle from the store, on demand.
//
// The URLs come from the manifest, written into the shell HTML by the server,
// so the browser never fetches the manifest itself. Each bundle is imported
// once and cached: switching views twice must not fetch twice.

// From the CONTRACT specifier and not from "./subapp.ts". That relative import
// was the whole of §16: no file in the shell resolved "@pointer/subapp", so the
// matrix re-pointed a specifier the shell never used and the sub-app half of
// the contract was checked from one side only.
import type { AppAssets, AppMap } from "@pointer/blocks";
import type { SubApp } from "@pointer/subapp";

// Declared once, in the file that holds the whole server-to-shell surface. It
// used to be declared here AND in `html.ts`, with nothing comparing the two -
// which is how §11's rename got through.
export type { AppAssets, AppMap } from "@pointer/blocks";

export type { SubApp };

export function readAppMap(): AppMap {
  const el = document.getElementById("__APPS__");
  if (!el?.textContent) return {};
  try {
    return JSON.parse(el.textContent) as AppMap;
  } catch {
    return {};
  }
}

const stylesheets = new Set<string>();

function addStylesheet(href: string, integrity?: string): Promise<void> {
  if (stylesheets.has(href)) return Promise.resolve();
  stylesheets.add(href);
  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    if (integrity) {
      link.integrity = integrity;
      // Without this the browser refuses a cross-origin stylesheet carrying a
      // digest rather than checking it, and the sub-app renders unstyled. The
      // sub-app's script needs no equivalent: the import map carries its digest.
      link.crossOrigin = "anonymous";
    }
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`could not load ${href}`));
    document.head.append(link);
  });
}

const loading = new Map<string, Promise<SubApp>>();

/**
 * The sub-app's component, cached by name.
 *
 * A sub-app default-exports a component. The check is that it exported a
 * function at all: a Preact component is either a function or a class, and a
 * class is a function too.
 */
export function loadApp(name: string, assets: AppAssets): Promise<SubApp> {
  let pending = loading.get(name);
  if (pending) return pending;

  pending = (async () => {
    // The stylesheet first, so the app is never painted unstyled.
    if (assets.css) await addStylesheet(assets.css, assets.cssIntegrity);
    // A variable specifier, so the bundler leaves this as a real runtime
    // import of a file it has never seen.
    const mod = (await import(assets.js)) as { default?: unknown };
    if (typeof mod.default !== "function") {
      throw new Error(`${name} has no default export, so it is not a sub-app`);
    }
    return mod.default as SubApp;
  })();

  loading.set(name, pending);
  return pending;
}

/**
 * Drop a failed import so the next mount tries again.
 *
 * Only useful when the import itself REJECTED - a network failure or a digest
 * the browser refused. A module that loaded and then threw while rendering is
 * already evaluated, and the browser will not evaluate a module URL twice, so
 * forgetting it changes nothing. The error control says "mount again" rather
 * than "reload" for exactly that reason.
 */
export function forget(name: string): void {
  loading.delete(name);
}
