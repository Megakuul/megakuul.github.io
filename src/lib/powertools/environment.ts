import type { EnvVariable } from './types';
export function exampleExport(v: EnvVariable) {
  return `export ${v.name}=${"'" + v.example.replaceAll("'", "'\"'\"'") + "'"}`;
}
export function environmentHint(v: EnvVariable) {
  return `${v.required ? 'Required' : `Default: ${v.default}`}\n${exampleExport(v)}${v.hint ? '\n' + v.hint : ''}\nClick to copy example`;
}
