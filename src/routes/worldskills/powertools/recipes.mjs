// @ts-nocheck
import { serviceGroups } from './service-commands.mjs';
import { iamGroups } from './iam-commands.mjs';
import { eksCommand } from './operation-templates.mjs';
import { setupEnvironment } from './environment.mjs';
import { creationCommands } from './native-commands.mjs';
import { collectorCode } from './runtime-code.mjs';
import {
  alarmsTemplate,
  configTemplate,
  dlqTemplate,
  loggingTemplate,
  securityGroupsTemplate,
  wafTemplate,
} from './powertools.mjs';
/** @typedef {{id:string,title:string,command?:string,cliCommand?:string,cfnTagNote?:string|null,templateFile?:string,env?:Array<{name:string,example:string,required:boolean,hint?:string}>,resourceTemplate?:any,document?:any,documentTitle?:string}} Recipe */
/** @returns {Array<{id:string,title:string,recipes:Recipe[]}>} */
export function powertoolsGroups() {
  const iam = iamGroups();
  const setup = [
    [
      'security-groups',
      'Security groups · no ingress · outbound TCP 80/443',
      securityGroupsTemplate(),
    ],
    ['logging', 'Logging destinations + service roles · 30 days', loggingTemplate()],
    ['waf', 'WAF · high rate limit · managed checks: Count', wafTemplate()],
    ['dlq', 'DLQ · account / region sources · encrypted · 14 days', dlqTemplate()],
    ['config', 'AWS Config · continuous recording', configTemplate()],
    [
      'alarms',
      'Alarms · all DLQs + Lambda error rate · monitoring Lambda',
      alarmsTemplate(collectorCode),
    ],
  ];
  const groups = [
    iam[0],
    {
      id: 'setup',
      title: 'Setup',
      recipes: setup.map(([kind, title, document]) => ({
        id: `${kind}-setup`,
        title,
        ...creationCommands(
          document,
          kind,
          kind === 'security-groups' ? ['VPC_ID', 'SG_NAMES'] : ['NAME'],
        ),
        env: setupEnvironment(kind),
      })),
    },
    {
      id: 'existing-services',
      title: 'Configure existing services',
      recipes: [
        {
          id: 'eks-setup',
          title: 'EKS · all control-plane logs · 30 days',
          command: eksCommand(),
          env: setupEnvironment('eks'),
        },
      ],
    },
    ...serviceGroups(),
    ...iam.slice(1),
  ];
  return groups;
}
