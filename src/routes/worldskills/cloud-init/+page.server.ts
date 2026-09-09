import { createHighlighter } from 'shiki';
import dracula from 'shiki/themes/dracula.mjs';
import type { PageServerLoad } from './$types';
import { cloudConfigs, commands, policies, operations } from './snippets.mjs';

const files = import.meta.glob('../../../../static/downloads/cloud-init/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
});
export const load: PageServerLoad = async () => {
  const groups = [
    { id: 'launch-ec2', title: 'Launch EC2', snippets: commands },
    {
      id: 'user-data',
      title: 'User data · Amazon Linux 2023 · edit values in YAML',
      snippets: cloudConfigs.map(snippet => ({
        ...snippet,
        lang: 'yaml',
        code: files['../../../../static/downloads/cloud-init/' + snippet.file] as string,
      })),
    },
    { id: 'instance-permissions', title: 'Instance role · policies', snippets: policies },
    { id: 'operations', title: 'On instance', snippets: operations },
  ];
  const highlighter = await createHighlighter({
    themes: [dracula],
    langs: ['bash', 'yaml', 'json'],
  });
  try {
    return {
      groups: groups.map(group => ({
        ...group,
        snippets: group.snippets.map(snippet => ({
          ...snippet,
          download:
            'download' in snippet && typeof snippet.download === 'string' ? snippet.download : null,
          html: highlighter.codeToHtml(snippet.code, { lang: snippet.lang, theme: 'dracula' }),
        })),
      })),
    };
  } finally {
    highlighter.dispose();
  }
};
