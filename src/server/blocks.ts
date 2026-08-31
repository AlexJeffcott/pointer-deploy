export type BuildInfo = {
  buildId: string;
  commit: string;
  publishedAt: string;
  channel: string;
  region: string;
  units?: Record<string, { unitId: string; commit: string; marker: string }>;
  contract?: string;
  apiBase?: string;
};

export type AppAssets = {
  js: string;
  css?: string;
  cssIntegrity?: string;
};

export type AppMap = Record<string, AppAssets>;

export type VersionOption = {
  unitId: string;
  marker: string;
  current: boolean;
  live: boolean;
  deployed: boolean;
  disabled: boolean;
};

export type VersionsBlock = Record<string, VersionOption[]>;
