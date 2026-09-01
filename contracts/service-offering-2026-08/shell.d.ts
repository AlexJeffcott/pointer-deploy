export type Theme = {
    colour: string;
    dark: boolean;
};
export type User = {
    name: string;
    colour: string;
    initials: string;
    theme: Theme;
};
export type Limits = {
    step: number;
    max: number;
    allowNegative: boolean;
};
export type Label = {
    title: string;
    emoji: string;
};
export type Labels = Record<string, Label>;
export type Flags = {
    showShares: boolean;
    showTotals: boolean;
    compact: boolean;
};
export type Stats = {
    total: number;
    busiest: string | null;
    updatedAt: string;
};
export type Motd = {
    text: string;
    level: "info" | "warn";
    until: string;
} | null;
export type Settings = {
    limits: Limits;
    labels: Labels;
    flags: Flags;
    stats: Stats;
    motd: Motd;
};
export type Counts = ReadonlyArray<readonly [string, number]>;
export type ServiceRoute = {
    method: string;
    path: string;
};
export type FieldSunset = {
    since: string;
    sunset: string;
    reason: string;
    instead: string | null;
};
export type ServiceField = {
    path: string;
    type: string;
    going: FieldSunset | null;
};
export type ServiceReport = {
    base: string;
    state: "unread" | "ok" | "failed";
    serves: readonly string[];
    calling: string;
    routes: readonly ServiceRoute[];
    fields: readonly ServiceField[];
    headerSunset: string | null;
    error: string | null;
    readAt: string | null;
};
export type ShellStore = {
    user(): User;
    setUser(next: User): void;
    setName(name: string): void;
    setColour(colour: string): void;
    register(ns: string): void;
    increment(ns: string, by?: number): void;
    countOf(ns: string): number;
    reset(ns: string): void;
    snapshot(): Counts;
    limits(): Limits;
    labelFor(ns: string): Label;
    flags(): Flags;
    stats(): Stats;
    motd(): Motd;
    setSettings(next: Partial<Settings>): void;
    service(): ServiceReport;
    setService(report: ServiceReport): void;
    goingAway(path: string): FieldSunset | null;
};
export declare const DEFAULTS: Settings;
export declare const NO_SERVICE: ServiceReport;
export declare function createStore(initial?: Partial<User>): ShellStore;
