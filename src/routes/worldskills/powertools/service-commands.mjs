import catalog from '../../../../static/downloads/services/catalog.json' with { type: 'json' };
import { securityCommand } from './operation-templates.mjs';
import { serviceTemplate } from './service-templates.mjs';
import { creationCommands } from './native-commands.mjs';
import { tagEnvironment } from './environment.mjs';
export function serviceGroups() {
  return [
    {
      id: 'services',
      title: 'Create services',
      recipes: catalog.services.map(service => {
        const document = serviceTemplate(service.id);
        const inputs = service.env.map(v => v.name);
        return {
          id: `service-${service.id}`,
          title: service.title,
          ...creationCommands(
            document,
            service.id,
            inputs,
            service.id === 'security' ? securityCommand() : undefined,
          ),
          env: [...service.env, ...tagEnvironment],
        };
      }),
    },
  ];
}
