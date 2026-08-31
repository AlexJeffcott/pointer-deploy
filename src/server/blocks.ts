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
  /**
   * When this unit started being served on this channel, as an ISO instant.
   *
   * Absent where nothing recorded it: the oldest entry a channel still keeps,
   * and every build the catalogue contributed that this channel never served.
   */
  since?: string;
};

export type VersionsBlock = Record<string, VersionOption[]>;
