import iam from '../../../../static/downloads/iam/catalog.json' with { type: 'json' };
import { shellQuote } from './generators.mjs';

/** @typedef {{name: string, example: string, required: boolean, default?: string | number, hint?: string}} EnvVariable */
/** @param {string} name @param {string} example @param {string | undefined} [fallback] @param {string} [hint] @returns {EnvVariable} */
const variable = (name, example, fallback, hint = '') => ({
  name,
  example,
  required: fallback === undefined,
  default: fallback,
  hint,
});
/** @param {string} kind @param {boolean} [cli] @returns {EnvVariable[]} */
export function setupEnvironment(kind, cli = false) {
  if (kind === 'security-groups')
    return [
      variable('VPC_ID', 'vpc-0123456789abcdef0'),
      variable('SG_NAMES', 'app,worker,database', 'app,worker,database'),
    ];
  if (kind === 'eks') return [variable('CLUSTER_NAME', 'my-cluster')];
  return [
    variable(
      'NAME',
      `quickstart-${kind}${cli ? '-cli' : ''}`,
      `quickstart-${kind}${cli ? '-cli' : ''}`,
    ),
  ];
}
const roleName = variable(
  'ROLE_NAME',
  'my-app-role',
  undefined,
  'Reused by Lambda, Step Functions and role commands.',
);
const examples = { CLUSTER_NAME: 'my-cluster', NAMESPACE: 'app', SERVICE_ACCOUNT: 'worker' };
/** @param {string} id @returns {EnvVariable[]} */
export function iamEnvironment(id) {
  if (id.startsWith('iam-access-') || id === 'iam-install') return [];
  if (id === 'iam-environment-setup')
    return [
      variable('TAG_KEY', 'Project', 'Project'),
      variable('TAG_VALUE', 'my-app', 'quickstart'),
    ];
  if (id === 'iam-extra-tags')
    return [variable('TAGS_JSON', '{"Environment":"test","Owner":"me"}', '{}')];
  if (id === 'iam-change-role') return [roleName];
  const role = iam.roles.find(r => `iam-role-${r.id}` === id);
  const inputs =
    role?.inputs ??
    (id === 'iam-eks-associate'
      ? [{ env: 'CLUSTER_NAME' }, { env: 'NAMESPACE' }, { env: 'SERVICE_ACCOUNT' }]
      : []);
  return [
    roleName,
    ...inputs.map(input =>
      variable(
        input.env,
        examples[/** @type {keyof typeof examples} */ (input.env)],
        undefined,
        'Prompted if omitted.',
      ),
    ),
  ];
}
/** @param {EnvVariable} variable */
export function exampleExport(variable) {
  return `export ${variable.name}=${shellQuote(variable.example)}`;
}
/** @param {EnvVariable} variable */
export function environmentHint(variable) {
  return `${variable.required ? 'Required' : `Optional · default: ${variable.default}`}\n${exampleExport(variable)}${variable.hint ? '\n' + variable.hint : ''}\nClick to copy example`;
}
