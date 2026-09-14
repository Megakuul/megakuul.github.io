import { createHighlighter } from 'shiki';
import dracula from 'shiki/themes/dracula.mjs';
import { pipelines } from '$lib/server/codepipeline/presets';
import { inputs, deployCommand, sourceCommand } from '$lib/server/codepipeline/downloads';
import { cloudFormationYaml } from '$lib/server/powertools/cloudformation';
import type { PageServerLoad } from './$types';

export const prerender = true;
export const trailingSlash = 'always';
export const load: PageServerLoad = async () => {
  const highlighter = await createHighlighter({ themes: [dracula], langs: ['bash', 'yaml'] });
  const highlight = (raw: string, lang = 'bash') => ({
    raw,
    html: highlighter.codeToHtml(raw, { lang, theme: 'dracula' }),
  });
  try {
    return {
      inputs,
      pipelines: pipelines.map(p => ({
        id: p.id,
        title: p.title,
        variants: p.variants.map(v => ({
          provider: v.provider,
          file: v.file,
          command: highlight(deployCommand(p, v.provider)),
          template: highlight(cloudFormationYaml(v.template), 'yaml'),
          source: highlight(sourceCommand(p, v.provider)),
        })),
      })),
    };
  } finally {
    highlighter.dispose();
  }
};
