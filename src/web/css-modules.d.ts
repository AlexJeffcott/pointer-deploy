declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}

// Imported for its side effect alone - the bundler takes the file and emits it
// beside the shell, and nothing in the module is read. TypeScript 5 says
// nothing about a side-effect import of a module it cannot find; 7 refuses it
// (TS2882). Declared here so the file is named under both, even though it
// exports nothing. `*.module.css` above is the longer pattern, so it still
// wins for the files it matches.
declare module "*.css";
