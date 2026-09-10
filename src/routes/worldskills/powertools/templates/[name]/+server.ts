import { error } from '@sveltejs/kit';
import { powertoolsGroups } from '../../recipes.mjs';
import { cloudFormationYaml } from '../../template-format.mjs';
import type { EntryGenerator, RequestHandler } from './$types';

export const prerender = true;
const templates = () =>
  powertoolsGroups()
    .flatMap(group => group.recipes)
    .filter(recipe => recipe.templateFile);
export const entries: EntryGenerator = () =>
  templates().map(recipe => ({ name: recipe.templateFile! }));
export const GET: RequestHandler = ({ params }) => {
  const recipe = templates().find(recipe => recipe.templateFile === params.name);
  if (!recipe?.document) error(404, 'Template not found');
  return new Response(cloudFormationYaml(recipe.document), {
    headers: {
      'Content-Type': 'application/yaml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${recipe.templateFile}"`,
    },
  });
};
