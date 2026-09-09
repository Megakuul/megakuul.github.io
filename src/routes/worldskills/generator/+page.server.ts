import { createHighlighter } from 'shiki';
import dracula from 'shiki/themes/dracula.mjs';
import { serviceGroups } from './service-commands.mjs';
import { iamEnvironment, setupEnvironment } from './environment.mjs';
import { iamGroups } from './iam-commands.mjs';
import collectorCode from './snippets/health-monitor.py?raw';
import directRenderer from './snippets/direct-render.py?raw';
import { directDeploymentCommand } from './direct-cli.mjs';
import type { PageServerLoad } from './$types';
import {
  alarmsTemplate,
  configTemplate,
  deploymentCommand,
  dlqTemplate,
  eksLoggingCommand,
  eksLoggingConfiguration,
  loggingTemplate,
  securityGroupsTemplate,
  wafTemplate,
} from './generators.mjs';

export const load: PageServerLoad = async () => {
  const highlighter = await createHighlighter({ themes: [dracula], langs: ['bash', 'json'] });
  try {
    const generators = [
      {
        id: 'security-groups-setup',
        title: 'Security groups · no ingress · outbound TCP 80/443 → 0.0.0.0/0',
        kind: 'security-groups',
        template: securityGroupsTemplate(),
      },
      {
        id: 'logging-setup',
        title: 'Logging destinations + roles · enable delivery in each service',
        kind: 'logging',
        template: loggingTemplate(),
      },
      {
        id: 'waf-setup',
        title: 'ALB WAF · 100,000 / IP / 5 min · SQLi + bad inputs: Count',
        kind: 'waf',
        template: wafTemplate(),
      },
      {
        id: 'dlq-setup',
        title: 'DLQ · standard SQS + async Lambda · 14 days',
        kind: 'dlq',
        template: dlqTemplate(),
      },
      {
        id: 'config-setup',
        title: 'AWS Config · enable recorder · continuous recording',
        kind: 'config',
        template: configTemplate(),
      },
      {
        id: 'alarms-setup',
        title: 'Alarms · all DLQs + Lambda error rate · automatic discovery',
        kind: 'alarms',
        template: alarmsTemplate(collectorCode),
      },
    ];
    const iam = iamGroups();
    return {
      groups: [
        {
          id: 'setup',
          title: 'Setup',
          recipes: [
            ...generators.map(generator => {
              const command = deploymentCommand(generator.template, generator.kind);
              const json = JSON.stringify(generator.template, null, 2);
              const cliCommand = directDeploymentCommand(
                generator.template,
                generator.kind,
                directRenderer,
              );
              return {
                id: generator.id,
                env: setupEnvironment(generator.kind),
                cliEnv: setupEnvironment(generator.kind, true),
                jsonOnly: false,
                title: generator.title,
                command,
                cliCommand,
                cliHtml: highlighter.codeToHtml(cliCommand, { lang: 'bash', theme: 'dracula' }),
                json,
                jsonTitle: 'CloudFormation JSON',
                commandHtml: highlighter.codeToHtml(command, { lang: 'bash', theme: 'dracula' }),
                jsonHtml: highlighter.codeToHtml(json, { lang: 'json', theme: 'dracula' }),
              };
            }),
            (() => {
              const configuration = eksLoggingConfiguration();
              const command = eksLoggingCommand(configuration);
              const json = JSON.stringify(configuration, null, 2);
              return {
                id: 'eks-logging-setup',
                env: setupEnvironment('eks'),
                cliEnv: null,
                jsonOnly: false,
                title: 'EKS · control-plane logs · all 5 types',
                command,
                json,
                cliCommand: null,
                cliHtml: null,
                jsonTitle: 'Logging JSON',
                commandHtml: highlighter.codeToHtml(command, { lang: 'bash', theme: 'dracula' }),
                jsonHtml: highlighter.codeToHtml(json, { lang: 'json', theme: 'dracula' }),
              };
            })(),
          ],
        },
        ...[...serviceGroups(), ...iam].map(group => ({
          id: group.id,
          title: group.title,
          recipes: group.recipes.map(recipe => {
            const command = recipe.command ?? '';
            const json =
              'document' in recipe && recipe.document
                ? JSON.stringify(recipe.document, null, 2)
                : null;
            return {
              id: recipe.id,
              env: 'env' in recipe ? recipe.env : iamEnvironment(recipe.id),
              cliEnv: null,
              jsonOnly: !command,
              title: recipe.title,
              command,
              commandHtml: highlighter.codeToHtml(command, { lang: 'bash', theme: 'dracula' }),
              json,
              cliCommand: null,
              cliHtml: null,
              jsonTitle: 'jsonTitle' in recipe ? (recipe.jsonTitle ?? 'Policy JSON') : 'JSON',
              jsonHtml: json
                ? highlighter.codeToHtml(json, { lang: 'json', theme: 'dracula' })
                : null,
            };
          }),
        })),
      ].sort((a, b) => (a.id === 'iam-environment' ? -1 : b.id === 'iam-environment' ? 1 : 0)),
    };
  } finally {
    highlighter.dispose();
  }
};
