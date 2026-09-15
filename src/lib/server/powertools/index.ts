import { parse } from 'yaml';
import type { DefinitionGroup, ToolGroup } from '$lib/powertools/types';
import { creationCommands, securityCommand } from './commands';
import environment from './definitions/environment.yaml?raw';
import setup from './definitions/setup.yaml?raw';
import services from './definitions/services.yaml?raw';
import roles from './definitions/roles.yaml?raw';
import policies from './definitions/policies.yaml?raw';
import { infrastructureTools } from './infrastructure';

const definitions = [environment, setup, services, roles, policies]
  .flatMap(source => parse(source) as DefinitionGroup[])
  .map(group =>
    group.id === 'services'
      ? { ...group, recipes: [...group.recipes, ...infrastructureTools] }
      : group,
  );

export function powertoolsGroups(): ToolGroup[] {
  return definitions.map(group => ({
    id: group.id,
    title: group.title,
    recipes: group.recipes.map(
      ({ id, title, env, command, templateName, template, policy, cli }) => ({
        id,
        title,
        ...(env ? { env } : {}),
        ...(template && templateName
          ? creationCommands(
              template,
              templateName,
              (env ?? []).filter(v => !['TAG_KEY', 'TAG_VALUE'].includes(v.name)).map(v => v.name),
              cli === 'security' ? securityCommand(template) : cli === false ? false : undefined,
            )
          : command
            ? { command }
            : { document: policy }),
      }),
    ),
  }));
}
