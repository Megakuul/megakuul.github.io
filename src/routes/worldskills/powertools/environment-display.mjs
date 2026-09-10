/** @param {import('./environment.mjs').EnvVariable} v */
export function exampleExport(v) {
  return `export ${v.name}=${"'" + v.example.replaceAll("'", "'\"'\"'") + "'"}`;
}
/** @param {import('./environment.mjs').EnvVariable} v */
export function environmentHint(v) {
  return `${v.required ? 'Required' : `Default: ${v.default}`}\n${exampleExport(v)}${v.hint ? '\n' + v.hint : ''}\nClick to copy example`;
}
