// Run: POWERTOOLS_PWSH=/path/to/pwsh node --test tests/powertools-windows.test.mjs
// No AWS calls: native processes are intercepted by the fixture executable.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, after } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'powertools-windows-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const exportPath = join(dir, 'recipes.json');
const exportEnv = { ...process.env };
delete exportEnv.NODE_TEST_CONTEXT;
const exported = spawnSync(process.execPath, ['tests/fixtures/export-powertools.mjs', exportPath], {
  env: exportEnv,
  encoding: 'utf8',
  maxBuffer: 8 * 1024 * 1024,
});
assert.ifError(exported.error);
assert.equal(exported.status, 0, exported.stderr);
const { recipes, environmentExample } = JSON.parse(readFileSync(exportPath, 'utf8'));
const pwsh = process.env.POWERTOOLS_PWSH || 'pwsh';
const hasPowerShell =
  spawnSync(pwsh, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()']).status === 0;
const mock = readFileSync(new URL('./fixtures/powertools-aws-mock.cjs', import.meta.url), 'utf8');
writeFileSync(join(dir, 'aws'), `#!${process.execPath}\n${mock}`, { mode: 0o755 });
const baseEnv = {
  ...process.env,
  PATH: dir + delimiter + process.env.PATH,
  AWS_REGION: 'eu-west-1',
  AWS_DEFAULT_REGION: 'eu-west-1',
  REGION: 'eu-west-1',
  TAG_KEY: 'Project',
  TAG_VALUE: 'Équipe "quoted" O\'Brien $literal',
  NAME: 'test-app',
  ROLE_NAME: 'test-role',
  VPC_ID: 'vpc-test',
  SG_NAMES: 'app,worker',
  INSTANCE_ID: 'i-source',
  MOCK_CALLS: join(dir, 'calls.jsonl'),
};
function run(code, windows, recipe, overrides = {}) {
  writeFileSync(baseEnv.MOCK_CALLS, '');
  const env = { ...baseEnv };
  for (const variable of recipe?.env ?? [])
    if (!(variable.name in env)) env[variable.name] = String(variable.default ?? variable.example);
  Object.assign(env, overrides);
  const file = join(dir, windows ? 'test.ps1' : 'test.sh');
  const cwd = overrides.TEST_WORKDIR ?? mkdtempSync(join(dir, 'run-'));
  writeFileSync(file, code);
  const result = spawnSync(
    windows ? pwsh : 'bash',
    windows ? ['-NoProfile', '-NonInteractive', '-File', file] : [file],
    { cwd, env, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
  );
  assert.ifError(result.error);
  const calls = readFileSync(baseEnv.MOCK_CALLS, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(JSON.parse);
  return { ...result, calls, cwd };
}

// This also makes future recipes fail visibly when a Windows variant is missing.
test('every executable recipe and deployment mode has a Windows counterpart', () => {
  for (const recipe of recipes) {
    if (recipe.command) assert.ok(recipe.windowsCommand, recipe.id);
    for (const variant of [recipe, recipe.serviceOnly].filter(r => r?.templateFile)) {
      if (recipe.id !== 'service-ec2')
        assert.equal(variant.windowsCommand.split('\n').length, 3, recipe.id);
      assert.doesNotMatch(variant.windowsCommand, /Invoke-Aws|GetTempFileName|function /);
    }
    if (recipe.cliCommand) assert.ok(recipe.windowsCliCommand, recipe.id);
    if (recipe.serviceOnly) assert.ok(recipe.serviceOnly.windowsCommand, recipe.id);
  }
});

test('all generated Windows commands parse as native PowerShell', { skip: !hasPowerShell }, () => {
  const commands = recipes.flatMap(recipe =>
    [recipe.windowsCommand, recipe.windowsCliCommand, recipe.serviceOnly?.windowsCommand]
      .filter(Boolean)
      .map(code => ({ id: recipe.id, code })),
  );
  const path = join(dir, 'commands.json');
  writeFileSync(path, JSON.stringify(commands));
  const result = run(
    `$commands = Get-Content -Raw '${path}' | ConvertFrom-Json\nforeach ($command in $commands) {\n$tokens = $null; $issues = $null\n[System.Management.Automation.Language.Parser]::ParseInput($command.code, [ref]$tokens, [ref]$issues) | Out-Null\nif ($issues.Count) { throw "$($command.id): $issues" }\n}`,
    true,
  );
  assert.equal(result.status, 0, result.stderr);
});

test(
  'PowerShell environment examples preserve literal special characters',
  { skip: !hasPowerShell },
  () => {
    const value = baseEnv.TAG_VALUE;
    const result = run(environmentExample + '\n[Console]::Write($env:EXAMPLE)', true);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, value);
  },
);

for (const recipe of recipes.filter(recipe => recipe.cliCommand)) {
  test(`${recipe.id}: native CLI preserves Bash API payloads`, { skip: !hasPowerShell }, () => {
    const linux = run(recipe.cliCommand, false, recipe);
    const windows = run(recipe.windowsCliCommand, true, recipe);
    assert.equal(linux.status, 0, linux.stderr);
    assert.equal(windows.status, 0, windows.stderr);
    const payloads = result =>
      result.calls
        .filter(call => call.payload)
        .map(({ service, operation, payload }) => ({ service, operation, payload }));
    assert.deepEqual(payloads(windows), payloads(linux));
    const operations = result =>
      result.calls
        .filter(call => !['get-caller-identity', 'get'].includes(call.operation))
        .map(call => `${call.service} ${call.operation}`);
    assert.deepEqual(operations(windows), operations(linux));
  });
}

const downloadStub = `function curl.exe { if ($env:FAIL_DOWNLOAD) { $global:LASTEXITCODE = 22 } else { $global:LASTEXITCODE = 0 } }\n`;
for (const recipe of recipes.filter(recipe => recipe.templateFile)) {
  for (const deployment of [recipe, recipe.serviceOnly].filter(Boolean)) {
    test(
      `${deployment.templateFile}: short PowerShell submits matching parameters`,
      { skip: !hasPowerShell },
      () => {
        const result = run(downloadStub + deployment.windowsCommand, true, recipe, {
          TAG_VALUE: 'my project',
          SUBNET_IDS: 'subnet-a,subnet-b',
        });
        assert.equal(result.status, 0, result.stderr);
        const call = result.calls.find(call => call.operation === 'create-stack');
        assert.ok(call, result.stdout);
        assert.ok(call.args.includes(`file://${deployment.templateFile}`));
        assert.ok(call.args.includes('Key=Project,Value=my project'));
        const parameters = call.args.filter(arg => arg.startsWith('ParameterKey='));
        assert.deepEqual(
          parameters.map(p => p.split(',')[0].slice(13)).sort(),
          Object.keys(deployment.document.Parameters).sort(),
        );
        for (const key of ['SubnetIds', 'GroupNames']) {
          const parameter = parameters.find(p => p.startsWith(`ParameterKey=${key},`));
          if (parameter)
            assert.equal(
              parameter,
              `ParameterKey=${key},ParameterValue='${key === 'SubnetIds' ? 'subnet-a,subnet-b' : 'app,worker'}'`,
            );
        }
        if (recipe.templateFile === 'cloudfront.yaml') assert.ok(call.args.includes('us-east-1'));
      },
    );
  }
}

test(
  'required values, download failure and role lookup failure stop submission',
  { skip: !hasPowerShell },
  () => {
    const recipe = recipes.find(r => r.id === 'service-lambda');
    for (const overrides of [
      { NAME: '' },
      { TAG_KEY: '' },
      { ROLE_NAME: '' },
      { FAIL_DOWNLOAD: 'true' },
      { FAIL_OPERATION: 'get-role' },
    ]) {
      const result = run(downloadStub + recipe.windowsCommand, true, recipe, overrides);
      assert.notEqual(result.status, 0, JSON.stringify(overrides));
      assert.ok(!result.calls.some(call => call.operation === 'create-stack'));
    }
  },
);

test('optional defaults apply without overwriting explicit input', { skip: !hasPowerShell }, () => {
  const recipe = recipes.find(r => r.templateFile === 'asg.yaml');
  for (const value of ['', 'arm64']) {
    const result = run(downloadStub + recipe.windowsCommand, true, recipe, { ARCHITECTURE: value });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(
      result.calls
        .at(-1)
        .args.includes(`ParameterKey=Architecture,ParameterValue=${value || 'x86_64'}`),
    );
  }
});

test('direct AWS failures stop subsequent API calls', { skip: !hasPowerShell }, () => {
  const recipe = recipes.find(r => r.id === 'service-ecs');
  const result = run(recipe.windowsCliCommand, true, recipe, { FAIL_OPERATION: 'create-key' });
  assert.notEqual(result.status, 0);
  assert.equal(result.calls.at(-1).operation, 'create-key');
});

test(
  'EC2: subnet discovery and lookup failures behave identically on both shells',
  { skip: !hasPowerShell },
  () => {
    const recipe = recipes.find(r => r.id === 'service-ec2');
    for (const windows of [false, true]) {
      const code = windows
        ? downloadStub + recipe.windowsCommand
        : 'curl() { :; }\n' + recipe.command;
      const result = run(code, windows, recipe);
      assert.equal(result.status, 0, result.stderr);
      const lookup = result.calls.find(c => c.operation === 'describe-subnets');
      assert.ok(lookup.args.includes('Name=vpc-id,Values=vpc-test'));
      assert.ok(lookup.args.includes('Name=state,Values=available'));
      assert.match(
        lookup.args[lookup.args.indexOf('--query') + 1],
        /sort_by\(sort_by\(Subnets.*&SubnetId\), &AvailabilityZone\)/,
      );
      assert.ok(
        result.calls
          .find(c => c.operation === 'create-stack')
          .args.includes('ParameterKey=SubnetId,ParameterValue=subnet-first'),
      );
      for (const overrides of [
        { MOCK_SUBNET: 'None' },
        { MOCK_SUBNET: '' },
        { FAIL_OPERATION: 'describe-subnets' },
        { VPC_ID: '' },
      ]) {
        const failure = run(code, windows, recipe, overrides);
        assert.notEqual(failure.status, 0);
        assert.ok(!failure.calls.some(c => c.operation === 'create-stack'));
      }
    }
  },
);

test(
  'EC2: generates a usable local key, submits only its public key and prints SSH after readiness',
  { skip: !hasPowerShell },
  () => {
    const recipe = recipes.find(r => r.id === 'service-ec2');
    for (const windows of [false, true]) {
      const code = windows
        ? downloadStub + recipe.windowsCommand
        : 'curl() { :; }\n' + recipe.command;
      const result = run(code, windows, recipe);
      assert.equal(result.status, 0, result.stderr);
      const keyFile = join(result.cwd, 'powertools-ec2-test-app.key');
      const publicKey = readFileSync(keyFile + '.pub', 'utf8').trim();
      assert.match(publicKey, /^ssh-ed25519 /);
      assert.equal(statSync(keyFile).mode & 0o777, 0o600);
      const derived = spawnSync('ssh-keygen', ['-y', '-f', keyFile], { encoding: 'utf8' });
      assert.ifError(derived.error);
      assert.equal(derived.status, 0, derived.stderr);
      assert.equal(
        derived.stdout.trim().split(' ').slice(0, 2).join(' '),
        publicKey.split(' ').slice(0, 2).join(' '),
      );
      const submitted = result.calls.find(c => c.operation === 'create-stack');
      assert.ok(
        submitted.args.includes(`ParameterKey=PublicKeyMaterial,ParameterValue=${publicKey}`),
      );
      assert.doesNotMatch(JSON.stringify(result.calls), /PRIVATE KEY/);
      assert.deepEqual(
        result.calls.map(c => c.operation),
        [
          'describe-subnets',
          'create-stack',
          'wait',
          'describe-stacks',
          'wait',
          'describe-instances',
        ],
      );
      assert.match(result.stdout, /ssh -i "powertools-ec2-test-app.key" ec2-user@198\.51\.100\.20/);
      const originalKey = readFileSync(keyFile);
      const repeated = run(code, windows, recipe, { TEST_WORKDIR: result.cwd });
      assert.notEqual(repeated.status, 0);
      assert.deepEqual(readFileSync(keyFile), originalKey);
      assert.ok(!repeated.calls.some(c => c.operation === 'create-stack'));
      const failedWait = run(code, windows, recipe, { FAIL_OPERATION: 'wait' });
      assert.notEqual(failedWait.status, 0);
      assert.doesNotMatch(failedWait.stdout, /ssh -i/);
      assert.match(
        readFileSync(join(failedWait.cwd, 'powertools-ec2-test-app.key.pub'), 'utf8'),
        /^ssh-ed25519 /,
      );
    }
  },
);
