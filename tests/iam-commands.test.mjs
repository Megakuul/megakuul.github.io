import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { iamGroups } from '../src/routes/worldskills/generator/iam-commands.mjs';
import catalog from '../static/downloads/iam/catalog.json' with { type: 'json' };
const groups = iamGroups();
const snippets = groups.flatMap(g => g.recipes);

test('roles remain commands and service policies are standalone scoped JSON', () => {
  assert.equal(new Set(snippets.map(s => s.id)).size, snippets.length);
  for (const snippet of snippets.filter(s => s.command)) {
    assert.equal(snippet.command.includes('\n'), false);
    assert.equal(spawnSync('bash', ['-n', '-c', snippet.command]).status, 0, snippet.id);
    assert.doesNotMatch(snippet.command, / policy | attach/);
  }
  const policies = snippets.filter(s => !s.command);
  assert.equal(policies.length, catalog.policies.length);
  for (const snippet of policies) {
    assert.equal(snippet.document.Version, '2012-10-17');
    assert.ok(snippet.document.Statement.length);
    assert.doesNotMatch(JSON.stringify(snippet.document), /\$\{[A-Z_]+\}/);
  }
  assert.equal(
    snippets.find(s => s.id === 'iam-access-sqs-send').document.Statement[0].Resource,
    'arn:aws:sqs:eu-central-1:111122223333:my-queue',
  );
  assert.match(
    JSON.stringify(snippets.find(s => s.id === 'iam-access-redshift-data').document),
    /\$\{aws:userid\}/,
  );
  for (const role of catalog.roles) {
    const snippet = snippets.find(s => s.id === `iam-role-${role.id}`);
    assert.deepEqual(snippet.document.TrustPolicy, role.trust);
    assert.deepEqual(snippet.document.ManagedPolicyArns, role.managedPolicies);
    assert.deepEqual(snippet.document.CustomerManagedPolicy.PolicyDocument, catalog.emptyPolicy);
  }
});

test('copied setup installs exact sources, preserves environment, and runs a role preview with AWS CLI', t => {
  const work = mkdtempSync(join(tmpdir(), 'iam-commands-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const helper = join(work, 'cache with spaces', 'generator.py');
  writeFileSync(
    join(work, 'curl'),
    `#!/usr/bin/env python3
import pathlib,shutil,sys
url=next(a for a in sys.argv if a.startswith('https://'))
root=pathlib.Path(${JSON.stringify(new URL('../static/downloads/iam/', import.meta.url).pathname)})
shutil.copyfile(root/url.rsplit('/',1)[-1],sys.argv[sys.argv.index('-o')+1])
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(work, 'aws'),
    `#!/usr/bin/env python3
import json,sys
assert sys.argv[1:3]==['sts','get-caller-identity'],sys.argv
print(json.dumps({'Account':'111122223333','Arn':'arn:aws:iam::111122223333:user/operator'}))
`,
    { mode: 0o755 },
  );
  const setup = snippets.find(s => s.id === 'iam-environment-setup').command;
  const install = snippets.find(s => s.id === 'iam-install').command;
  const preview = snippets.find(s => s.id === 'iam-role-lambda').command + ' --json';
  const result = spawnSync('bash', ['-c', `${setup} && ${install} && ${preview}`], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: work + ':' + process.env.PATH,
      IAM_GENERATOR: helper,
      ROLE_NAME: 'chosen-role',
      AWS_REGION: 'eu-central-1',
      TAG_KEY: 'Team',
      TAG_VALUE: 'data / test',
      RESOURCE_ARN: 'arn:aws:sqs:eu-central-1:111122223333:chosen-queue',
      PYTHONDONTWRITEBYTECODE: '1',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    JSON.parse(result.stdout).CustomerManagedPolicy.PolicyName,
    'chosen-role-permissions',
  );
  assert.deepEqual(
    JSON.parse(result.stdout).CustomerManagedPolicy.PolicyDocument,
    catalog.emptyPolicy,
  );
  assert.equal(
    readFileSync(helper, 'utf8'),
    readFileSync(new URL('../static/downloads/iam/generator.py', import.meta.url), 'utf8'),
  );
  assert.deepEqual(JSON.parse(readFileSync(join(work, 'cache with spaces/catalog.json'))), catalog);
});
