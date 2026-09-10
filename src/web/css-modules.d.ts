declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}

// Imported for its side effect alone - the bundler takes the file and emits it
// beside the shell, and nothing in the module is read. TypeScript 7 refuses a
// side-effect import of a module it cannot find (TS2882) where 5 said nothing,
// so the file has to be declared even though it exports nothing.
declare module "*.css";
