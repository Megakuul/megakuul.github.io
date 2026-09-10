import { cloudFormationYaml } from '../src/routes/worldskills/powertools/template-format.mjs';
import { powertoolsGroups } from '../src/routes/worldskills/powertools/recipes.mjs';
export const recipes = powertoolsGroups()
  .flatMap(group => group.recipes)
  .filter(recipe => recipe.resourceTemplate)
  .map(recipe => ({
    ...recipe,
    ...(recipe.templateFile ? { yaml: cloudFormationYaml(recipe.document) } : {}),
  }));
if (process.argv[1]?.endsWith('native-powertools-data.mjs')) console.log(JSON.stringify(recipes));
