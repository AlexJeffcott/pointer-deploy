export declare const buildMarker: string;
export type User = {
    name: string;
    colour: string;
};
export declare const user: import("@preact/signals-core").Signal<User>;
export declare function setName(name: string): void;
export declare function setColour(colour: string): void;
export declare const counters: import("@preact/signals-core").Signal<Record<string, number>>;
export declare function register(ns: string): void;
export declare function increment(ns: string, by?: number): void;
export declare function countOf(ns: string): number;
export declare const snapshot: import("@preact/signals-core").ReadonlySignal<[string, number][]>;
export declare const route: import("@preact/signals-core").Signal<string>;
export declare function navigate(path: string): void;
