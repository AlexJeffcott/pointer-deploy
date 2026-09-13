export type Task = {
    id: string;
    title: string;
    column: string;
    due: string | null;
    tags: readonly string[];
    createdAt: string;
};
export type Column = {
    id: string;
    label: string;
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
export type PlannerReport = {
    state: "unread" | "stored" | "unstored";
    schemaVersion: number | null;
    pending: boolean;
    error: string | null;
    readAt: string | null;
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
    tasks(): readonly Task[];
    columns(): readonly Column[];
    addTask(title: string): void;
    moveTask(id: string, column: string): void;
    setDue(id: string, due: string | null): void;
    setTags(id: string, tags: readonly string[]): void;
    removeTask(id: string): void;
    loadTasks(tasks: readonly Task[]): void;
    planner(): PlannerReport;
    setPlanner(report: PlannerReport): void;
    service(): ServiceReport;
    setService(report: ServiceReport): void;
    goingAway(path: string): FieldSunset | null;
};
export declare const NO_PLANNER: PlannerReport;
export declare const NO_SERVICE: ServiceReport;
export declare function createStore(initial?: readonly Task[]): ShellStore;
