import catalog from '../../../../static/downloads/iam/catalog.json' with { type: 'json' };

const runner = 'python3 "${IAM_GENERATOR:-$HOME/.cache/megakuul/iam/generator.py}"';

/** @param {object} value @param {Record<string, string | undefined>} context */
function resolveExample(value, context) {
  return JSON.parse(
    JSON.stringify(value).replace(/\$\{([A-Z_]+)\}/g, (_, key) => {
      if (typeof context[key] !== 'string') throw new Error(`Missing IAM example input: ${key}`);
      return JSON.stringify(context[key]).slice(1, -1);
    }),
  );
}

/** @returns {Array<{id: string, title: string, recipes: Array<{id: string, title: string, command?: string, document?: object, jsonTitle?: string}>}>} */
export function iamGroups() {
  return [
    {
      id: 'iam-environment',
      title: 'Environment',
      recipes: [
        {
          id: 'iam-environment-setup',
          title: 'Tags · reused by every command',
          command: 'export TAG_KEY="${TAG_KEY:-Project}" TAG_VALUE="${TAG_VALUE-quickstart}"',
        },
        {
          id: 'iam-install',
          title: '2 · Install role commands',
          command:
            'IAM_DIR=$(dirname "${IAM_GENERATOR:-$HOME/.cache/megakuul/iam/generator.py}") && mkdir -p "$IAM_DIR" && curl -fsSL https://megakuul.ch/downloads/iam/generator.py -o "$IAM_DIR/generator.py.tmp" && curl -fsSL https://megakuul.ch/downloads/iam/catalog.json -o "$IAM_DIR/catalog.json.tmp" && mv "$IAM_DIR/catalog.json.tmp" "$IAM_DIR/catalog.json" && mv "$IAM_DIR/generator.py.tmp" "${IAM_GENERATOR:-$HOME/.cache/megakuul/iam/generator.py}"',
        },
        {
          id: 'iam-change-role',
          title: 'Role name · bound policy: ROLE_NAME-permissions',
          command: 'export ROLE_NAME=my-worker-role',
        },
        {
          id: 'iam-extra-tags',
          title: 'Additional tags · roles + services',
          command: 'export TAGS_JSON=\'{"Environment":"test","Owner":"me"}\'',
        },
        {
          id: 'iam-menu',
          title: 'Select role preset',
          command: `${runner} role`,
        },
      ],
    },
    {
      id: 'iam-roles',
      title: 'IAM · role + empty policy',
      recipes: catalog.roles.map(role => ({
        id: `iam-role-${role.id}`,
        title: role.title,
        command: `${runner} role ${role.id}`,
        document: {
          TrustPolicy: role.trust,
          ManagedPolicyArns: role.managedPolicies,
          CustomerManagedPolicy: {
            PolicyName: '${ROLE_NAME}-permissions',
            Path: '/generator/',
            PolicyDocument: catalog.emptyPolicy,
          },
        },
        jsonTitle: 'Trust + permissions JSON',
      })),
    },
    {
      id: 'iam-manage',
      title: 'IAM · roles',
      recipes: [
        {
          id: 'iam-list-attached',
          title: 'Show attached policies',
          command: `${runner} list`,
        },
        {
          id: 'iam-eks-associate',
          title: 'EKS · associate Pod Identity role · agent must be installed',
          command: `${runner} pod-association`,
        },
      ],
    },
    ...[...new Set(catalog.policies.map(policy => policy.group))].map(group => ({
      id: `iam-access-${group.toLowerCase().replace(/[^a-z]+/g, '-')}`,
      title: `Policies · ${group}`,
      recipes: catalog.policies
        .filter(policy => policy.group === group)
        .map(policy => ({
          id: `iam-access-${policy.id}`,
          title: policy.title,
          document: resolveExample(policy.policy, { ...catalog.exampleContext, ...policy.example }),
        })),
    })),
  ];
}
