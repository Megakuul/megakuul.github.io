import { createHighlighter } from 'shiki';
import dracula from 'shiki/themes/dracula.mjs';
import { groups, type Block } from './appsync.snippets';
import type { PageServerLoad } from './$types';

export const prerender = true;
export const trailingSlash = 'always';
export const load: PageServerLoad = async () => {
  const highlighter = await createHighlighter({
    themes: [dracula],
    langs: ['javascript', 'graphql', 'json', 'sql'],
  });
  const highlight = (block: Block) => ({
    ...block,
    html: highlighter.codeToHtml(block.code, { lang: block.lang, theme: 'dracula' }),
  });
  try {
    return {
      groups: groups.map(group => ({
        ...group,
        snippets: group.snippets.map(snippet => ({
          ...snippet,
          blocks: snippet.blocks.map(highlight),
          extra: snippet.extra.map(highlight),
        })),
      })),
    };
  } finally {
    highlighter.dispose();
  }
};
