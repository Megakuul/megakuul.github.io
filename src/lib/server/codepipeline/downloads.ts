import { pipelines, type PipelinePreset, type SourceProvider } from './presets';
import { cloudFormationYaml } from '$lib/server/powertools/cloudformation';
import type { EnvVariable } from '$lib/powertools/types';
import { globalWafTemplate } from '$lib/server/powertools/security';

const root = 'https://megakuul.ch/worldskills/codepipeline/files/';
export const inputs: EnvVariable[] = [
  {
    name: 'NAME',
    example: 'my-pipeline',
    required: true,
    hint: '1–20 lowercase letters, digits or hyphens; start with a letter.',
  },
  { name: 'TAG_KEY', example: 'Project', required: true },
  { name: 'TAG_VALUE', example: 'worldskills', required: true },
];
export function deployCommand(p: PipelinePreset, provider: SourceProvider) {
  const file = `${p.id}-${provider.toLowerCase()}.yaml`;
  const web = ['ec2', 'ecs', 'ecs-bluegreen'].includes(p.id);
  const edge = ['s3', 'ec2'].includes(p.id);
  const edgeDeploy = edge
    ? `curl -fsSL ${root}edge-waf.yaml -o edge-waf.yaml && aws cloudformation deploy --region us-east-1 --stack-name "cp-$NAME-edge" --template-file edge-waf.yaml --parameter-overrides "TagKey=$TAG_KEY" "TagValue=$TAG_VALUE" --tags "$TAG_KEY=$TAG_VALUE" --no-fail-on-empty-changeset && EDGE_WAF=$(aws cloudformation describe-stacks --region us-east-1 --stack-name "cp-$NAME-edge" --query 'Stacks[0].Outputs[?OutputKey==\`WebACLArn\`].OutputValue | [0]' --output text) && [[ "$EDGE_WAF" == arn:aws:wafv2:us-east-1:*:global/webacl/* ]] && `
    : '';
  const discover = web
    ? `CF_PREFIX=$(aws ec2 describe-managed-prefix-lists --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing --query 'PrefixLists[0].PrefixListId' --output text) && [[ "$CF_PREFIX" == pl-* ]] && CF_AZS=$(aws ec2 describe-availability-zones --filters Name=zone-type,Values=availability-zone Name=state,Values=available --query "join(',', AvailabilityZones[?ZoneId!='use1-az3' && ZoneId!='usw1-az2' && ZoneId!='apne1-az3' && ZoneId!='cac1-az3'].ZoneName | [:2])" --output text) && [[ "$CF_AZS" == *,* ]] && `
    : '';
  return `: "\${NAME:?Set NAME}" "\${TAG_KEY:?Set TAG_KEY}" "\${TAG_VALUE:?Set TAG_VALUE}" && [[ "$NAME" =~ ^[a-z][a-z0-9-]{0,19}$ ]] && ${discover}${edgeDeploy}curl -fsSL ${root}${file} -o ${file} && aws cloudformation deploy --stack-name "cp-$NAME" --template-file ${file} --parameter-overrides "TagKey=$TAG_KEY" "TagValue=$TAG_VALUE"${web ? ' "CloudFrontPrefixList=$CF_PREFIX" "CloudFrontAzs=$CF_AZS"' : ''}${edge ? ' "EdgeWebACL=$EDGE_WAF"' : ''} --tags "$TAG_KEY=$TAG_VALUE" --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset`;
}
export function sourceCommand(p: PipelinePreset, provider: SourceProvider) {
  const file = `${p.id}-${provider.toLowerCase()}-source.sh`;
  return `curl -fsSL ${root}${file} -o ${file} && bash ${file}`;
}
export function sourceScript(p: PipelinePreset, provider: SourceProvider) {
  const header = `#!/bin/bash
set -euo pipefail
: "\${NAME:?Set NAME}"
export AWS_PAGER=""
d=$(mktemp -d)
trap 'rm -rf "$d"' EXIT
curl -fsSL ${root}${p.id}-source.zip -o "$d/source.zip"
`;
  if (provider === 'S3')
    return (
      header +
      `bucket=$(aws cloudformation describe-stacks --stack-name "cp-$NAME" --query "Stacks[0].Outputs[?OutputKey=='SourceBucketName'].OutputValue | [0]" --output text)
aws s3 cp "$d/source.zip" "s3://$bucket/source.zip"
`
    );
  return (
    header +
    `REPOSITORY=$(aws cloudformation describe-stacks --stack-name "cp-$NAME" --query "Stacks[0].Outputs[?OutputKey=='RepositoryName'].OutputValue | [0]" --output text)
export REPOSITORY
if parent=$(aws codecommit get-branch --repository-name "$REPOSITORY" --branch-name main --query branch.commitId --output text 2>"$d/error"); then
  export PARENT_COMMIT="$parent"
elif grep -q 'BranchDoesNotExistException' "$d/error"; then
  export PARENT_COMMIT=""
else
  cat "$d/error" >&2
  exit 1
fi
python3 - "$d/source.zip" > "$d/commit.json" <<'PY'
import base64, json, os, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    files = [{"filePath": name, "fileMode": "EXECUTABLE" if name.endswith(".sh") else "NORMAL", "fileContent": base64.b64encode(archive.read(name)).decode()} for name in archive.namelist() if not name.endswith("/")]
request = {"repositoryName": os.environ["REPOSITORY"], "branchName": "main", "commitMessage": "Starter source", "putFiles": files}
if os.environ["PARENT_COMMIT"]:
    request["parentCommitId"] = os.environ["PARENT_COMMIT"]
print(json.dumps(request))
PY
aws codecommit create-commit --cli-binary-format base64 --cli-input-json "file://$d/commit.json"
`
  );
}

/** Deterministic ZIP of the tiny starter source trees, including executable hook modes. */
export function sourceZip(files: Record<string, string>): Uint8Array<ArrayBuffer> {
  const chunks: Uint8Array[] = [],
    directory: Uint8Array[] = [];
  const encoder = new TextEncoder();
  let offset = 0;
  for (const [path, contents] of Object.entries(files)) {
    const name = encoder.encode(path),
      data = encoder.encode(contents);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = new Uint8Array(30),
      central = new Uint8Array(46);
    const h = new DataView(header.buffer),
      c = new DataView(central.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(12, 33, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, name.length, true);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 0x0314, true);
    c.setUint16(6, 20, true);
    c.setUint16(14, 33, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(38, ((path.endsWith('.sh') ? 0o100755 : 0o100644) << 16) >>> 0, true);
    c.setUint32(42, offset, true);
    chunks.push(header, name, data);
    directory.push(central, name);
    offset += header.length + name.length + data.length;
  }
  const indexSize = directory.reduce((n, data) => n + data.length, 0),
    end = new Uint8Array(22),
    e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, directory.length / 2, true);
  e.setUint16(10, directory.length / 2, true);
  e.setUint32(12, indexSize, true);
  e.setUint32(16, offset, true);
  const bytes = new Uint8Array(offset + indexSize + end.length);
  let cursor = 0;
  for (const chunk of [...chunks, ...directory, end]) {
    bytes.set(chunk, cursor);
    cursor += chunk.length;
  }
  return bytes;
}
export function downloads() {
  return [
    {
      name: 'edge-waf.yaml',
      type: 'application/yaml',
      body: cloudFormationYaml(globalWafTemplate()),
    },
    ...pipelines.flatMap(p => [
      ...p.variants.flatMap(v => [
        { name: v.file, type: 'application/yaml', body: cloudFormationYaml(v.template) },
        {
          name: `${p.id}-${v.provider.toLowerCase()}-source.sh`,
          type: 'text/x-shellscript',
          body: sourceScript(p, v.provider),
        },
      ]),
      { name: `${p.id}-source.zip`, type: 'application/zip', body: sourceZip(p.source) },
    ]),
  ];
}
