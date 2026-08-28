export type User = {
    name: string;
    colour: string;
};
export type Counts = ReadonlyArray<readonly [string, number]>;
export type ShellStore = {
    user(): User;
    setName(name: string): void;
    setColour(colour: string): void;
    register(ns: string): void;
    increment(ns: string, by?: number): void;
    countOf(ns: string): number;
    reset(ns: string): void;
    snapshot(): Counts;
};
export declare function createStore(initial?: Partial<User>): ShellStore;
