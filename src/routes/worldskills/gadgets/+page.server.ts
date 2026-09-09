import { createHighlighter } from 'shiki';
import dracula from 'shiki/themes/dracula.mjs';
import type { PageServerLoad } from './$types';
import javascript from './snippets/simple-router.mjs?raw';
import python from './snippets/simple_router.py?raw';

export const prerender = true;
export const trailingSlash = 'always';

export const load: PageServerLoad = async () => {
  const highlighter = await createHighlighter({
    themes: [dracula],
    langs: ['javascript', 'python'],
  });
  try {
    return {
      examples: [
        { id: 'javascript', title: 'Node.js', filename: 'index.mjs', code: javascript },
        { id: 'python', title: 'Python', filename: 'index.py', code: python },
      ].map(example => ({
        ...example,
        html: highlighter.codeToHtml(example.code, { lang: example.id, theme: 'dracula' }),
      })),
    };
  } finally {
    highlighter.dispose();
  }
};
