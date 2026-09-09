import { createHighlighter } from 'shiki';
import dracula from 'shiki/themes/dracula.mjs';
import type { PageServerLoad } from './$types';
import parameters from './snippets/parameters.sh?raw';
import permissions from './snippets/permissions.sh?raw';
import lambdaDeploy from './snippets/lambda-deploy.sh?raw';
import lambdaHandler from './snippets/lambda_handler.py?raw';
import ecsDeploy from './snippets/ecs-deploy.sh?raw';
import eksDeploy from './snippets/eks-deploy.sh?raw';
import read from './snippets/read.sh?raw';
import readNode from './snippets/read.mjs?raw';
import endpoint from './snippets/vpc-endpoint.sh?raw';

export const load: PageServerLoad = async () => {
  const highlighter = await createHighlighter({
    themes: [dracula],
    langs: ['bash', 'python', 'javascript'],
  });
  const groups = [
    {
      id: 'setup',
      title: 'Setup',
      snippets: [
        { id: 'parameters', title: 'Parameters', lang: 'bash', code: parameters },
        { id: 'permissions', title: 'IAM read policy', lang: 'bash', code: permissions },
      ],
    },
    {
      id: 'lambda',
      title: 'Lambda',
      snippets: [
        {
          id: 'lambda-deploy',
          title: 'Deploy extension · ZIP function',
          lang: 'bash',
          code: lambdaDeploy,
        },
        {
          id: 'lambda-handler',
          title: 'Read configuration · Python handler',
          lang: 'python',
          code: lambdaHandler,
        },
      ],
    },
    {
      id: 'ecs',
      title: 'ECS',
      snippets: [
        {
          id: 'ecs-deploy',
          title: 'Deploy sidecar · awsvpc service',
          lang: 'bash',
          code: ecsDeploy,
        },
      ],
    },
    {
      id: 'eks',
      title: 'EKS',
      snippets: [
        { id: 'eks-deploy', title: 'Deploy sidecar · IRSA', lang: 'bash', code: eksDeploy },
      ],
    },
    {
      id: 'read',
      title: 'Read configuration · ECS / EKS',
      snippets: [
        { id: 'read-curl', title: 'curl · configuration / feature flag', lang: 'bash', code: read },
        { id: 'read-node', title: 'Node.js · request handler', lang: 'javascript', code: readNode },
      ],
    },
    {
      id: 'network',
      title: 'Private networking',
      snippets: [
        {
          id: 'vpc-endpoint',
          title: 'AppConfig data endpoint · optional',
          lang: 'bash',
          code: endpoint,
        },
      ],
    },
  ];
  try {
    return {
      groups: groups.map(group => ({
        ...group,
        snippets: group.snippets.map(snippet => ({
          ...snippet,
          html: highlighter.codeToHtml(snippet.code, { lang: snippet.lang, theme: 'dracula' }),
        })),
      })),
    };
  } finally {
    highlighter.dispose();
  }
};
