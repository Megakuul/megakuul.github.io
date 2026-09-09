import catalog from '../../../../static/downloads/services/catalog.json' with { type: 'json' };

export const serviceHelperEnv = {
  name: 'SERVICE_GENERATOR',
  required: false,
  example: '$HOME/.cache/megakuul/services/generator.py',
  default: '$HOME/.cache/megakuul/services/generator.py',
  hint: 'Install service commands once first. Requires AWS CLI v2, Python 3.9+ and curl.',
};

export function serviceGroups() {
  return [
    {
      id: 'services',
      title: 'Create services',
      recipes: [
        {
          id: 'services-install',
          title: 'Install service commands · AWS CLI v2 + Python 3.9+',
          command:
            'SERVICE_DIR=$(dirname "${SERVICE_GENERATOR:-$HOME/.cache/megakuul/services/generator.py}") && mkdir -p "$SERVICE_DIR" && curl -fsSL https://megakuul.ch/downloads/services/generator.py -o "$SERVICE_DIR/generator.py.tmp" && curl -fsSL https://megakuul.ch/downloads/services/catalog.json -o "$SERVICE_DIR/catalog.json.tmp" && mv "$SERVICE_DIR/catalog.json.tmp" "$SERVICE_DIR/catalog.json" && mv "$SERVICE_DIR/generator.py.tmp" "${SERVICE_GENERATOR:-$HOME/.cache/megakuul/services/generator.py}"',
          env: [],
        },
        ...catalog.services.map(service => ({
          id: `service-${service.id}`,
          title: service.title,
          command: `python3 "\${SERVICE_GENERATOR:-$HOME/.cache/megakuul/services/generator.py}" ${service.id}`,
          env: service.env,
        })),
      ],
    },
  ];
}
