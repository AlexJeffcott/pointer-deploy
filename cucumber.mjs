export default {
  paths: ["features/**/*.feature"],
  import: ["features/support/*.ts", "features/steps/*.ts"],
  format: ["summary", "progress"],
  formatOptions: { snippetInterface: "async-await" },
};
