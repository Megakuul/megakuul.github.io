import { cloudFormationYaml } from '$lib/server/powertools/cloudformation';
import { createHighlighter } from 'shiki';
import dracula from 'shiki/themes/dracula.mjs';
import { powertoolsGroups } from '$lib/server/powertools';
import type { Recipe } from '$lib/powertools/types';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async () => {
  const highlighter = await createHighlighter({
    themes: [dracula],
    langs: ['bash', 'json', 'yaml'],
  });
  const render = (recipe: Pick<Recipe, 'command' | 'templateFile' | 'document' | 'cfnTagNote'>) => {
    const command = recipe.command ?? '',
      documentLanguage = recipe.templateFile ? 'yaml' : 'json',
      documentCode = recipe.document
        ? documentLanguage === 'yaml'
          ? cloudFormationYaml(recipe.document)
          : JSON.stringify(recipe.document, null, 2)
        : null;
    return {
      templateFile: recipe.templateFile ?? null,
      templateUrl: recipe.templateFile
        ? `/worldskills/powertools/templates/${recipe.templateFile}`
        : null,
      command,
      cfnTagNote: recipe.cfnTagNote ?? null,
      commandHtml: highlighter.codeToHtml(
        recipe.templateFile
          ? command.replace(' && aws cloudformation ', '\naws cloudformation ')
          : command,
        { lang: 'bash', theme: 'dracula' },
      ),
      documentCode,
      documentLanguage,
      documentHtml: documentCode
        ? highlighter.codeToHtml(documentCode, { lang: documentLanguage, theme: 'dracula' })
        : null,
    };
  };
  try {
    return {
      groups: powertoolsGroups().map(group => ({
        id: group.id,
        title: group.title,
        recipes: group.recipes.map(recipe => ({
          ...render(recipe),
          id: recipe.id,
          title: recipe.title,
          env: recipe.env ?? [],
          cliEnv: null,
          documentOnly: !recipe.command,
          cliCommand: recipe.cliCommand ?? null,
          cliHtml: recipe.cliCommand
            ? highlighter.codeToHtml(recipe.cliCommand, { lang: 'bash', theme: 'dracula' })
            : null,
          serviceOnly: recipe.serviceOnly ? render(recipe.serviceOnly) : null,
          documentTitle: recipe.documentTitle ?? 'Policy JSON',
        })),
      })),
    };
  } finally {
    highlighter.dispose();
  }
};
