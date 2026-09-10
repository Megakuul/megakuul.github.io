import { cloudFormationYaml } from '$lib/server/powertools/cloudformation';
import { createHighlighter } from 'shiki';
import dracula from 'shiki/themes/dracula.mjs';
import { powertoolsGroups } from '$lib/server/powertools';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async () => {
  const highlighter = await createHighlighter({
    themes: [dracula],
    langs: ['bash', 'json', 'yaml'],
  });
  try {
    return {
      groups: powertoolsGroups().map(group => ({
        id: group.id,
        title: group.title,
        recipes: group.recipes.map(recipe => {
          const command = recipe.command ?? '',
            cliCommand = recipe.cliCommand ?? null,
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
            id: recipe.id,
            title: recipe.title,
            env: recipe.env ?? [],
            cliEnv: null,
            documentOnly: !command,
            command,
            cliCommand,
            cfnTagNote: recipe.cfnTagNote ?? null,
            commandHtml: highlighter.codeToHtml(
              recipe.templateFile
                ? command.replace(' && aws cloudformation ', '\naws cloudformation ')
                : command,
              { lang: 'bash', theme: 'dracula' },
            ),
            cliHtml: cliCommand
              ? highlighter.codeToHtml(cliCommand, { lang: 'bash', theme: 'dracula' })
              : null,
            documentCode,
            documentLanguage,
            documentTitle: recipe.documentTitle ?? 'Policy JSON',
            documentHtml: documentCode
              ? highlighter.codeToHtml(documentCode, { lang: documentLanguage, theme: 'dracula' })
              : null,
          };
        }),
      })),
    };
  } finally {
    highlighter.dispose();
  }
};
