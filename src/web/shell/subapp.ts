// The other half of the contract: what a sub-app hands back.
//
// A component, not a `mount(el)` function. The reason is measured and is in the
// TODO under §7: a sub-app that renders into its own root cannot have its
// errors caught by the shell, and a Provider in the shell reaches nothing
// inside it, because Preact context travels down the vnode tree. One tree fixes
// both.
//
// `ComponentType` is the one vendor type the contract references. The emitted
// declaration REFERENCES it rather than inlining it, so the hash does not cover
// what Preact means by it - see §9, which pins it.

import type { ComponentType } from "preact";
// By SPECIFIER and not by relative path. The emitted declaration carries this
// line verbatim, and a contract directory holds shell.d.ts - not api.ts - so a
// relative import would name a file that does not exist wherever the matrix
// re-points these. The specifier is re-pointed too, so the two halves find each
// other inside a contract directory exactly as they do at HEAD.
import type { ShellStore } from "@pointer/shell";

/** Everything a sub-app is given. One prop, so adding a second is additive. */
export type SubAppProps = { store: ShellStore };

/**
 * A sub-app's default export.
 *
 * No teardown function: a component is unmounted by being removed from the
 * tree, and anything it needs to undo belongs in its own `useEffect` cleanup.
 */
export type SubApp = ComponentType<SubAppProps>;
