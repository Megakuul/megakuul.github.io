export type CommandPlatform = 'linux' | 'windows';

export function powershellQuote(value: string) {
  return "'" + value.replaceAll("'", "''") + "'";
}
