import iam from '../../../../static/downloads/iam/catalog.json' with { type: 'json' };
/** @typedef {{name:string,example:string,required:boolean,default?:string|number,hint?:string}} EnvVariable */
/** @type {EnvVariable[]} */
export const tagEnvironment = [
  { name: 'TAG_KEY', example: 'Project', required: true },
  { name: 'TAG_VALUE', example: 'my-app', required: true },
];
/** @param {string} kind @param {boolean} [_cli] @returns {EnvVariable[]} */
export function setupEnvironment(kind, _cli = false) {
  return [
    ...(kind === 'security-groups'
      ? [
          { name: 'VPC_ID', example: 'vpc-0123456789abcdef0', required: true },
          { name: 'SG_NAMES', example: 'app,worker,database', required: true },
        ]
      : kind === 'eks'
        ? [{ name: 'CLUSTER_NAME', example: 'my-cluster', required: true }]
        : [{ name: 'NAME', example: `quickstart-${kind}`, required: true }]),
    ...tagEnvironment,
  ];
}
/** @param {string} id @returns {EnvVariable[]} */
export function iamEnvironment(id) {
  const role = iam.roles.find(r => `iam-role-${r.id}` === id);
  const examples = { CLUSTER_NAME: 'my-cluster', NAMESPACE: 'app', SERVICE_ACCOUNT: 'worker' };
  return [
    { name: 'ROLE_NAME', example: 'my-app-role', required: true },
    ...(role?.inputs ?? []).map(i => ({
      name: i.env,
      example: examples[/** @type {keyof typeof examples} */ (i.env)],
      required: true,
    })),
    ...tagEnvironment,
  ];
}
export { exampleExport, environmentHint } from './environment-display.mjs';
