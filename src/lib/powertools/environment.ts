import type { EnvVariable } from './types';
import { powershellQuote, type CommandPlatform } from './platform';
export function exampleExport(v: EnvVariable, platform: CommandPlatform = 'linux') {
  if (platform === 'windows') return `$env:${v.name} = ${powershellQuote(v.example)}`;
  return `export ${v.name}=${"'" + v.example.replaceAll("'", "'\"'\"'") + "'"}`;
}
export function environmentHint(v: EnvVariable, platform: CommandPlatform = 'linux') {
  return `${v.required ? 'Required' : `Default: ${v.default}`}\n${exampleExport(v, platform)}${v.hint ? '\n' + v.hint : ''}\nClick to copy example`;
}
