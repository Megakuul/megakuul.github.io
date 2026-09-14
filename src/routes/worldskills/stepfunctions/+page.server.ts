import { createHighlighter } from 'shiki';
import dracula from 'shiki/themes/dracula.mjs';
import { groups } from './stepfunctions.snippets';
import type { PageServerLoad } from './$types';

export const prerender = true;
export const trailingSlash = 'always';
export const load: PageServerLoad = async () => {
  const highlighter = await createHighlighter({ themes: [dracula], langs: ['json'] });
  const highlight = (raw: string) => ({
    raw,
    html: highlighter.codeToHtml(raw, { lang: 'json', theme: 'dracula' }),
  });
  const json = (value: unknown) => highlight(JSON.stringify(value, null, 2));
  try {
    return {
      groups: groups.map(group => ({
        ...group,
        snippets: group.snippets.map(snippet => ({
          ...snippet,
          definition: highlight(snippet.code),
          examples: snippet.examples.map(example => ({
            title: example.title,
            input: json(example.input),
            output: json(example.output),
          })),
          extra: (snippet.extra ?? []).map(block => ({ title: block.title, ...json(block.value) })),
        })),
      })),
    };
  } finally {
    highlighter.dispose();
  }
};
