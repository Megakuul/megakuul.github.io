import type { ToolDefinition } from '../../powertools/types';
import { exampleExport } from '../../powertools/environment';

export function windowsSetupCommand(recipe: ToolDefinition): string {
  if (!recipe.command) return '';
  if (recipe.id === 'iam-environment-setup' || recipe.id === 'iam-change-role') {
    return (recipe.env ?? []).map(variable => exampleExport(variable, 'windows')).join('\n');
  }
  // The setup cards use plain AWS invocations. Share their arguments and operations.
  if (!['ecs-account-setup', 'parameter-store-intelligent-tiering'].includes(recipe.id)) {
    throw Error('Missing Windows setup renderer: ' + recipe.id);
  }
  return recipe.command.replace(/"\$([A-Z_]+)"/g, '$env:$1');
}
