import { powershellQuote } from '../../powertools/platform';

export function requiredEnvironment(names: string[]) {
  if (!names.length) return '';
  return `foreach ($key in ${[...new Set(names)].map(powershellQuote).join(',')}) { if ([string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($key))) { throw "Set $key" } }`;
}

/** Direct API recipes use ordinary commands, with native failures stopping the chain. */
export function powershellScript(body: string[], inputs: string[] = []) {
  return [
    "if ($PSVersionTable.PSVersion -lt [version]'7.4') { throw 'Direct AWS CLI recipes require PowerShell 7.4+ and jq. Use the CloudFormation command in Windows PowerShell 5.1.' }",
    requiredEnvironment(inputs),
    "$ErrorActionPreference = 'Stop'; $PSNativeCommandUseErrorActionPreference = $true; $PSNativeCommandArgumentPassing = 'Standard'",
    "$env:AWS_PAGER = ''; $env:AWS_DEFAULT_OUTPUT = 'json'",
    ...body,
  ]
    .filter(Boolean)
    .join('\n');
}
