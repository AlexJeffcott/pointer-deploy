export type Greeting = {
    text: string;
    audience: string;
};
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
    greeting(): Greeting;
    setGreeting(patch: Partial<Greeting>): void;
    service(): ServiceReport;
    setService(report: ServiceReport): void;
    goingAway(path: string): FieldSunset | null;
};
export declare const DEFAULT_GREETING: Greeting;
export declare const NO_SERVICE: ServiceReport;
export declare function createStore(initial?: Partial<Greeting>): ShellStore;
