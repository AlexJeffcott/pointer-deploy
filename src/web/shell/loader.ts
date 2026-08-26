// Loads a sub-app bundle from the store, on demand.
//
// The URLs come from the manifest, written into the shell HTML by the server,
// so the browser never fetches the manifest itself. Each bundle is imported
// once and cached: switching views twice must not fetch twice.

export type AppAssets = { js: string; css?: string };
export type AppMap = Record<string, AppAssets>;

export type SubApp = {
  /** Renders into el. Returns a function that removes what it rendered. */
  mount(el: HTMLElement): () => void;
};

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

function addStylesheet(href: string): Promise<void> {
  if (stylesheets.has(href)) return Promise.resolve();
  stylesheets.add(href);
  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`could not load ${href}`));
    document.head.append(link);
  });
}

const loading = new Map<string, Promise<SubApp>>();

export function loadApp(name: string, assets: AppAssets): Promise<SubApp> {
  let pending = loading.get(name);
  if (pending) return pending;

  pending = (async () => {
    // The stylesheet first, so the app is never painted unstyled.
    if (assets.css) await addStylesheet(assets.css);
    // A variable specifier, so the bundler leaves this as a real runtime
    // import of a file it has never seen.
    const mod = (await import(assets.js)) as Partial<SubApp>;
    if (typeof mod.mount !== "function") {
      throw new Error(`${name} does not export mount()`);
    }
    return mod as SubApp;
  })();

  loading.set(name, pending);
  return pending;
}
