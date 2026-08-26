// Re-export entries for the import map.
//
// Sub-apps are built separately and mark these bare specifiers external, so the
// browser resolves them through the shell's import map to these files. All four
// are built in ONE Bun.build with splitting: true, so Preact's own code lands in
// a shared chunk and every entry references it. One instance, so a signal the
// shell owns re-renders a component a sub-app owns.
export * from "preact";
