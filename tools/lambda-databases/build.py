#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUTPUT = ROOT / 'static/downloads'
EXAMPLES = ROOT / 'src/routes/worldskills/lambda/database-examples'
subprocess.run(['npm', 'ci', '--prefix', str(HERE), '--cache', '/tmp/megakuul-db-npm-cache', '--ignore-scripts', '--omit=optional'], check=True)
package = json.loads((HERE / 'package.json').read_text())
manifest = {
    'runtimes': ['nodejs22.x', 'nodejs24.x'],
    'architectures': ['x86_64', 'arm64'],
    'oracleMode': 'thin',
    'dependencies': package['dependencies'],
    'scope': 'AWS-managed database and analytics services',
    'sources': {
        '@opensearch-project/opensearch': 'https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-clients.html',
        '@aws-sdk/client-redshift-data': 'https://docs.aws.amazon.com/redshift-data/latest/APIReference/API_BatchExecuteStatement.html',
        '@aws-sdk/client-athena': 'https://docs.aws.amazon.com/athena/latest/APIReference/API_StartQueryExecution.html',
        'pg': 'https://node-postgres.com/features/queries',
        'mysql2': 'https://sidorares.github.io/node-mysql2/docs',
        'mssql': 'https://github.com/tediousjs/node-mssql',
        'oracledb': 'https://node-oracledb.readthedocs.io/en/latest/user_guide/sql_execution.html',
        'mongodb': 'https://www.mongodb.com/docs/drivers/node/current/crud/',
        'redis': 'https://redis.io/docs/latest/develop/clients/nodejs/',
        'cassandra-driver': 'https://docs.datastax.com/en/developer/nodejs-driver/4.8/',
        'memcache-client': 'https://github.com/electrode-io/memcache',
        '@aws/aurora-dsql-node-postgres-connector': 'https://github.com/awslabs/aurora-dsql-connectors',
    },
}
manifest_bytes = (json.dumps(manifest, indent=2) + '\n').encode()
files = {}
for path in sorted((HERE / 'node_modules').rglob('*')):
    if not path.is_file():
        continue
    name = path.relative_to(HERE).as_posix()
    # Oracle Thin needs no native client; retain JS/WASM and third-party licenses.
    if name.startswith('node_modules/oracledb/build/') or '/.bin/' in name:
        continue
    if path.suffix in ('.node', '.so', '.dll', '.dylib'):
        raise RuntimeError('Unexpected native dependency: ' + name)
    files[name] = path.read_bytes()
for name in ('package.json', 'package-lock.json', 'index.mjs'):
    files[name] = (HERE / name).read_bytes()
files['manifest.json'] = manifest_bytes
for path in sorted(EXAMPLES.glob('*')):
    files['examples/' + path.name] = path.read_bytes()
for path in sorted((HERE / 'certs').glob('*.pem')):
    files['certs/' + path.name] = path.read_bytes()
OUTPUT.mkdir(exist_ok=True, parents=True)
for kind in ('function', 'layer'):
    target = OUTPUT / ('nodejs-databases-' + kind + '.zip')
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, content in sorted(files.items()):
            destination = 'nodejs/' + name if kind == 'layer' and not name.startswith('certs/') else name
            info = zipfile.ZipInfo(destination, date_time=(2026, 9, 9, 0, 0, 0))
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, content, compresslevel=9)
    size = target.stat().st_size
    if size > 50 * 1024 * 1024 or sum(map(len, files.values())) > 250 * 1024 * 1024:
        raise RuntimeError('Lambda upload limit exceeded')
    print(f'{target.name}: {size / 1024 / 1024:.1f} MiB zipped, {sum(map(len, files.values())) / 1024 / 1024:.1f} MiB extracted')
checksums = '\n'.join(hashlib.sha256((OUTPUT / ('nodejs-databases-' + kind + '.zip')).read_bytes()).hexdigest() + '  nodejs-databases-' + kind + '.zip' for kind in ('function', 'layer')) + '\n'
(OUTPUT / 'nodejs-databases.sha256').write_text(checksums)
(OUTPUT / 'nodejs-databases.manifest.json').write_bytes(manifest_bytes)
