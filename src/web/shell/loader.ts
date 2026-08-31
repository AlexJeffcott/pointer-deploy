import type { AppAssets, AppMap } from "@pointer/blocks";
import type { SubApp } from "@pointer/subapp";

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
      link.crossOrigin = "anonymous";
    }
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
    if (assets.css) await addStylesheet(assets.css, assets.cssIntegrity);
    const mod = (await import(assets.js)) as { default?: unknown };
    if (typeof mod.default !== "function") {
      throw new Error(`${name} has no default export, so it is not a sub-app`);
    }
    return mod.default as SubApp;
  })();

  loading.set(name, pending);
  return pending;
}

export function forget(name: string): void {
  loading.delete(name);
}
