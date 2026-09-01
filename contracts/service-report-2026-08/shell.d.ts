export type User = {
    name: string;
    colour: string;
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
    setName(name: string): void;
    setColour(colour: string): void;
    register(ns: string): void;
    increment(ns: string, by?: number): void;
    countOf(ns: string): number;
    reset(ns: string): void;
    snapshot(): Counts;
    service(): ServiceReport;
    setService(report: ServiceReport): void;
    goingAway(path: string): FieldSunset | null;
};
export declare const NO_SERVICE: ServiceReport;
export declare function createStore(initial?: Partial<User>): ShellStore;
