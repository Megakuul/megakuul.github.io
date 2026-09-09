import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  eksLoggingCommand,
  eksLoggingConfiguration,
} from '../src/routes/worldskills/generator/generators.mjs';

for (const scenario of ['new', 'enabled', 'denied', 'failed']) {
  test('EKS logging command: ' + scenario, t => {
    const work = mkdtempSync(join(tmpdir(), 'eks-generator-'));
    t.after(() => rmSync(work, { recursive: true, force: true }));
    writeFileSync(
      join(work, 'aws'),
      `#!/usr/bin/env python3
import json,os,pathlib,sys
args=sys.argv[1:]; root=pathlib.Path(os.environ['EKS_CAPTURE']); scenario=os.environ['EKS_SCENARIO']
with (root/'calls').open('a') as f: f.write(json.dumps(args)+'\\n')
operation=args[1]
if operation=='create-log-group' and scenario in ('enabled','denied'):
    print('An error occurred ('+('ResourceAlreadyExistsException' if scenario=='enabled' else 'AccessDeniedException')+')',file=sys.stderr)
    sys.exit(254)
elif operation=='describe-cluster':
    query=args[args.index('--query')+1]
    if query=='cluster.arn': print('arn:aws:eks:eu-central-1:123456789012:cluster/my-cluster')
    elif query.startswith('length'): print('5' if scenario=='enabled' else '0')
    else: print('{}')
elif operation=='update-cluster-config': print('update-123')
elif operation=='describe-update':
    print('Failed' if scenario=='failed' else 'Successful')
`,
      { mode: 0o755 },
    );
    const config = eksLoggingConfiguration();
    const command = eksLoggingCommand(config);
    assert.equal(command.includes('\n'), false);
    const result = spawnSync('bash', ['-c', command], {
      encoding: 'utf8',
      env: {
        ...process.env,
        AWS_REGION: 'eu-central-1',
        NAME: '',
        PATH: work + ':' + process.env.PATH,
        EKS_CAPTURE: work,
        CLUSTER_NAME: 'my-cluster',
        EKS_SCENARIO: scenario,
        TAG_KEY: 'Project = Team',
        TAG_VALUE: 'analytics / test',
      },
    });
    assert.equal(result.status, ['denied', 'failed'].includes(scenario) ? 1 : 0, result.stderr);
    const calls = readFileSync(join(work, 'calls'), 'utf8').trim().split('\n').map(JSON.parse);
    const create = calls.find(args => args[1] === 'create-log-group');
    assert.equal(create[create.indexOf('--log-group-name') + 1], '/aws/eks/my-cluster/cluster');
    assert.ok(create.includes('--deletion-protection-enabled'));
    assert.deepEqual(JSON.parse(create[create.indexOf('--tags') + 1]), {
      'Project = Team': 'analytics / test',
    });
    if (scenario === 'denied') {
      assert.match(result.stderr, /AccessDeniedException/);
      assert.equal(calls.length, 2);
      return;
    }
    const tag = calls.find(args => args[1] === 'tag-resource');
    assert.equal(
      tag[tag.indexOf('--resource-arn') + 1],
      'arn:aws:logs:eu-central-1:123456789012:log-group:/aws/eks/my-cluster/cluster',
    );
    assert.deepEqual(JSON.parse(tag[tag.indexOf('--tags') + 1]), {
      'Project = Team': 'analytics / test',
    });
    const protection = calls.find(args => args[1] === 'put-log-group-deletion-protection');
    assert.equal(
      protection[protection.indexOf('--log-group-identifier') + 1],
      '/aws/eks/my-cluster/cluster',
    );
    assert.ok(protection.includes('--deletion-protection-enabled'));
    const retention = calls.find(args => args[1] === 'put-retention-policy');
    assert.equal(retention[retention.indexOf('--retention-in-days') + 1], '30');
    const update = calls.find(args => args[1] === 'update-cluster-config');
    if (scenario === 'enabled') assert.equal(update, undefined);
    else {
      assert.deepEqual(JSON.parse(update[update.indexOf('--logging') + 1]), config);
      assert.ok(calls.some(args => args[1] === 'describe-update'));
    }
    if (scenario === 'failed') assert.doesNotMatch(result.stdout, /Log group:/);
    else assert.match(result.stdout, /Log group: \/aws\/eks\/my-cluster\/cluster/);
  });
}
