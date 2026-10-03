import { mdsvex } from 'mdsvex';
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import autoslug from 'rehype-slug';
import autolink from 'rehype-autolink-headings';
import autotoc from 'remark-toc';
import { createHighlighter } from 'shiki';
import dracula from 'shiki/themes/dracula.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)));

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: [
    vitePreprocess(),
    mdsvex({
      extensions: ['.svx', '.md'],
      highlight: {
        highlighter: async (code, lang) => {
          const highlighter = await createHighlighter({ theme: dracula, langs: [lang] });
          const html = highlighter.codeToHtml(code, { lang: lang, theme: dracula });
          // the html is embedded into a js template literal, escape everything that would
          // either break it (backtick, ${) or silently vanish from the output (backslash).
          const escaped = html.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
          return '{@html `' + escaped + '`}';
        },
      },
      layout: {
        projects: `${projectRoot}/src/routes/projects/project.layout.svelte`,
        concepts: `${projectRoot}/src/routes/concepts/concept.layout.svelte`,
        worldskills: `${projectRoot}/src/routes/worldskills/worldskills.layout.svelte`,
      },
      remarkPlugins: [[autotoc, { heading: 'Table of Contents', tight: true }]],
      rehypePlugins: [autoslug, autolink],
    }),
  ],

  kit: {
    adapter: adapter({
      precompress: false,
      strict: true,
    }),
  },

  extensions: ['.svelte', '.svx', '.md'],
};

export default config;
