import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { serviceGroups } from '../src/routes/worldskills/generator/service-commands.mjs';
import {
  setupEnvironment,
  iamEnvironment,
  environmentHint,
  exampleExport,
} from '../src/routes/worldskills/generator/environment.mjs';
import { iamGroups } from '../src/routes/worldskills/generator/iam-commands.mjs';
import {
  deploymentCommand,
  loggingTemplate,
  eksLoggingCommand,
  eksLoggingConfiguration,
} from '../src/routes/worldskills/generator/generators.mjs';

const recipes = serviceGroups().flatMap(g => g.recipes);
test('all commands declare environment inputs with copyable examples; policies stay JSON only', () => {
  assert.equal(recipes.length, 15);
  for (const recipe of recipes) {
    assert.ok(!recipe.command.includes('\n'));
    assert.equal(spawnSync('bash', ['-n', '-c', recipe.command]).status, 0);
    assert.equal(new Set(recipe.env.map(v => v.name)).size, recipe.env.length);
    for (const v of recipe.env) {
      assert.ok(environmentHint(v).includes(`export ${v.name}=`));
      assert.equal(spawnSync('bash', ['-n', '-c', exampleExport(v)]).status, 0);
    }
    if (recipe.id !== 'services-install') {
      assert.ok(recipe.env.some(v => v.name === 'NAME' && v.required));
      assert.ok(recipe.env.length <= 2);
      assert.ok(recipe.env.every(v => ['NAME', 'ROLE_NAME'].includes(v.name)));
    }
  }
  for (const recipe of iamGroups().flatMap(g => g.recipes))
    assert.ok(
      iamEnvironment(recipe.id).every(
        v => !['REGION', 'AWS_PROFILE', 'IAM_GENERATOR', 'SOURCE_ARN'].includes(v.name),
      ),
    );
  for (const kind of ['security-groups', 'logging', 'waf', 'dlq', 'config', 'alarms']) {
    assert.ok(setupEnvironment(kind).length <= 2);
    assert.deepEqual(
      setupEnvironment(kind).map(v => v.name),
      setupEnvironment(kind, true).map(v => v.name),
    );
    assert.ok(!setupEnvironment(kind, true).some(v => v.name === 'STACK'));
  }
});

test('copied installer downloads runnable helper and exact canonical env catalog', () => {
  const work = mkdtempSync(join(tmpdir(), 'service-install-'));
  try {
    writeFileSync(
      join(work, 'curl'),
      '#!/usr/bin/env python3\nimport sys,shutil,os\nsrc=sys.argv[2].replace("https://megakuul.ch/",os.environ["STATIC_ROOT"]+"/")\nshutil.copyfile(src,sys.argv[sys.argv.index("-o")+1])\n',
    );
    chmodSync(join(work, 'curl'), 0o755);
    const helper = join(work, 'installed', 'generator.py');
    const env = {
      ...process.env,
      PATH: work + ':' + process.env.PATH,
      STATIC_ROOT: resolve('static'),
      SERVICE_GENERATOR: helper,
    };
    const install = spawnSync('bash', ['-c', recipes[0].command], { env, encoding: 'utf8' });
    assert.equal(install.status, 0, install.stderr);
    assert.equal(
      readFileSync(helper, 'utf8'),
      readFileSync('static/downloads/services/generator.py', 'utf8'),
    );
    assert.equal(
      readFileSync(join(work, 'installed', 'catalog.json'), 'utf8'),
      readFileSync('static/downloads/services/catalog.json', 'utf8'),
    );
    const run = spawnSync('bash', ['-c', recipes.find(r => r.id === 'service-lambda').command], {
      env: { ...env, NAME: '' },
      encoding: 'utf8',
    });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /Set NAME/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('CloudFormation uses exported settings and submits without waiting', () => {
  const work = mkdtempSync(join(tmpdir(), 'service-env-'));
  try {
    writeFileSync(
      join(work, 'aws'),
      '#!/usr/bin/env python3\nimport sys,os,json\nwith open(os.environ["CAPTURE"],"a") as f:f.write(json.dumps(sys.argv[1:])+"\\n")\nprint("{}")\n',
    );
    chmodSync(join(work, 'aws'), 0o755);
    const run = spawnSync('bash', ['-c', deploymentCommand(loggingTemplate(), 'logging')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: work + ':' + process.env.PATH,
        CAPTURE: join(work, 'calls'),
        AWS_REGION: 'us-east-2',
        NAME: 'my-logs',
        REGION: 'wrong-region',
        STACK: 'custom-stack',
        RETENTION: '90',
        TAG_KEY: 'Owner',
        TAG_VALUE: 'team',
      },
    });
    assert.equal(run.status, 0, run.stderr);
    const calls = readFileSync(join(work, 'calls'), 'utf8').trim().split('\n').map(JSON.parse);
    const call = calls.find(c => c[1] === 'create-stack');
    assert.equal(call[call.indexOf('--region') + 1], 'us-east-2');
    assert.equal(call[call.indexOf('--stack-name') + 1], 'generator-logging-my-logs');
    assert.ok(
      JSON.parse(call[call.indexOf('--parameters') + 1]).some(p => p.ParameterValue === '30'),
    );
    assert.ok(!calls.some(c => c.includes('wait')));
    assert.match(eksLoggingCommand(eksLoggingConfiguration()), /CLUSTER_NAME:\?Set CLUSTER_NAME/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
