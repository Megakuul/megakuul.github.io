import {
  ECRClient,
  BatchDeleteImageCommand,
  BatchGetImageCommand,
  CreateRepositoryCommand,
  DeleteRepositoryCommand,
  DescribeImageScanFindingsCommand,
  DescribeImagesCommand,
  DescribeRepositoriesCommand,
  PutImageCommand,
  PutImageTagMutabilityCommand,
  PutLifecyclePolicyCommand,
  StartImageScanCommand,
} from '@aws-sdk/client-ecr';
import {
  CodeBuildClient,
  BatchGetBuildsCommand,
  ListBuildsForProjectCommand,
  StartBuildCommand,
} from '@aws-sdk/client-codebuild';
import { escapeHtml } from './local-logs.mjs';

const ecr = new ECRClient({});
const codebuild = new CodeBuildClient({});
const REPOSITORY = /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const TAG = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const PATH = /^[A-Za-z0-9_./-]+$/;
const VERSION = /^[A-Za-z0-9_./@:-]{0,200}$/;

function validate(value, pattern, name) {
  value = String(value ?? '');
  if (!pattern.test(value) || value.includes('..')) throw new Error('Invalid ' + name);
  return value;
}

function http(event = {}) {
  if (!event.requestContext?.http && !event.httpMethod) return null;
  return {
    method: event.requestContext?.http?.method ?? event.httpMethod,
    path: event.rawPath ?? event.path ?? '/',
    body:
      event.body == null
        ? ''
        : event.isBase64Encoded
          ? Buffer.from(event.body, 'base64').toString()
          : event.body,
  };
}

function authorized(event) {
  const password = process.env.ECR_MANAGER_PASSWORD;
  if (!password) return true;
  const user = process.env.ECR_MANAGER_USER ?? 'ecr';
  const expected = 'Basic ' + Buffer.from(user + ':' + password).toString('base64');
  return (event.headers?.authorization ?? event.headers?.Authorization) === expected;
}

function json(value, statusCode = 200) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(value, (_, item) => (item instanceof Date ? item.toISOString() : item)),
  };
}

function html(body, statusCode = 200, headers = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
    body,
  };
}

function inlineJson(value) {
  return JSON.stringify(value)
    .replaceAll('&', '\\u0026')
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e');
}

async function repositories(signal) {
  const result = [];
  let nextToken;
  do {
    const page = await ecr.send(new DescribeRepositoriesCommand({ maxResults: 100, nextToken }), {
      abortSignal: signal,
    });
    result.push(...(page.repositories ?? []));
    nextToken = page.nextToken;
  } while (nextToken);
  return result.sort((a, b) => a.repositoryName.localeCompare(b.repositoryName));
}

async function images(repositoryName) {
  const result = [];
  let nextToken;
  do {
    const page = await ecr.send(
      new DescribeImagesCommand({ repositoryName, maxResults: 100, nextToken }),
    );
    result.push(...(page.imageDetails ?? []));
    nextToken = page.nextToken;
  } while (nextToken && result.length < Number(process.env.ECR_MANAGER_MAX_IMAGES ?? 1000));
  return result.sort((a, b) => new Date(b.imagePushedAt ?? 0) - new Date(a.imagePushedAt ?? 0));
}

async function builds(signal) {
  const projectName = process.env.ECR_CODEBUILD_PROJECT;
  if (!projectName) return [];
  try {
    const listed = await codebuild.send(
      new ListBuildsForProjectCommand({ projectName, sortOrder: 'DESCENDING' }),
      { abortSignal: signal },
    );
    const ids = (listed.ids ?? []).slice(0, 15);
    if (!ids.length) return [];
    return (
      (await codebuild.send(new BatchGetBuildsCommand({ ids }), { abortSignal: signal })).builds ??
      []
    );
  } catch (error) {
    console.error('Could not load CodeBuild builds', error);
    return [];
  }
}

function imageId(input) {
  if (input.imageDigest) return { imageDigest: input.imageDigest };
  return { imageTag: validate(input.imageTag, TAG, 'image tag') };
}

async function action(input) {
  const repositoryName = input.repositoryName
    ? validate(input.repositoryName, REPOSITORY, 'repository name')
    : undefined;

  if (input.action === 'listRepositories') return { repositories: await repositories() };
  if (input.action === 'listImages') return { images: await images(repositoryName) };

  if (input.action === 'createRepository') {
    return ecr.send(
      new CreateRepositoryCommand({
        repositoryName,
        imageTagMutability: input.imageTagMutability === 'IMMUTABLE' ? 'IMMUTABLE' : 'MUTABLE',
        imageScanningConfiguration: { scanOnPush: Boolean(input.scanOnPush) },
        encryptionConfiguration: input.kmsKey
          ? { encryptionType: 'KMS', kmsKey: input.kmsKey }
          : { encryptionType: 'AES256' },
      }),
    );
  }

  if (input.action === 'deleteRepository') {
    return ecr.send(new DeleteRepositoryCommand({ repositoryName, force: Boolean(input.force) }));
  }

  if (input.action === 'deleteImage') {
    return ecr.send(new BatchDeleteImageCommand({ repositoryName, imageIds: [imageId(input)] }));
  }

  if (input.action === 'retagImage') {
    const current = await ecr.send(
      new BatchGetImageCommand({
        repositoryName,
        imageIds: [imageId(input)],
        acceptedMediaTypes: [
          'application/vnd.docker.distribution.manifest.v2+json',
          'application/vnd.oci.image.manifest.v1+json',
          'application/vnd.docker.distribution.manifest.list.v2+json',
          'application/vnd.oci.image.index.v1+json',
        ],
      }),
    );
    const image = current.images?.[0];
    if (!image?.imageManifest)
      throw new Error(current.failures?.[0]?.failureReason ?? 'Image not found');
    return ecr.send(
      new PutImageCommand({
        repositoryName,
        imageManifest: image.imageManifest,
        imageManifestMediaType: image.imageManifestMediaType,
        imageTag: validate(input.newTag, TAG, 'new image tag'),
      }),
    );
  }

  if (input.action === 'startScan') {
    return ecr.send(new StartImageScanCommand({ repositoryName, imageId: imageId(input) }));
  }

  if (input.action === 'scanFindings') {
    return ecr.send(
      new DescribeImageScanFindingsCommand({
        repositoryName,
        imageId: imageId(input),
        maxResults: 100,
      }),
    );
  }

  if (input.action === 'setMutability') {
    return ecr.send(
      new PutImageTagMutabilityCommand({
        repositoryName,
        imageTagMutability: input.imageTagMutability === 'IMMUTABLE' ? 'IMMUTABLE' : 'MUTABLE',
      }),
    );
  }

  if (input.action === 'setLifecycle') {
    const policy = typeof input.policy === 'string' ? JSON.parse(input.policy) : input.policy;
    return ecr.send(
      new PutLifecyclePolicyCommand({
        repositoryName,
        lifecyclePolicyText: JSON.stringify(policy),
      }),
    );
  }

  if (input.action === 'startBuild') {
    const projectName = process.env.ECR_CODEBUILD_PROJECT;
    if (!projectName) throw new Error('ECR_CODEBUILD_PROJECT is not configured');
    const sourceVersion = input.sourceVersion
      ? validate(input.sourceVersion, VERSION, 'source version')
      : undefined;
    const dockerfile = validate(input.dockerfile || 'Dockerfile', PATH, 'Dockerfile path');
    const context = validate(input.context || '.', PATH, 'build context');
    const imageTag = validate(input.imageTag || 'latest', TAG, 'image tag');
    return codebuild.send(
      new StartBuildCommand({
        projectName,
        sourceVersion,
        environmentVariablesOverride: [
          { name: 'ECR_REPOSITORY', value: repositoryName, type: 'PLAINTEXT' },
          { name: 'IMAGE_TAG', value: imageTag, type: 'PLAINTEXT' },
          { name: 'DOCKERFILE', value: dockerfile, type: 'PLAINTEXT' },
          { name: 'BUILD_CONTEXT', value: context, type: 'PLAINTEXT' },
        ],
      }),
    );
  }

  throw new Error('Unknown action');
}

function dashboard(model) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ECR Manager</title><style>
:root{color-scheme:dark;--bg:#0d0f13;--panel:#151820;--line:#303640;--muted:#9299a6;--text:#edf1f7;--blue:#7cc4ff;--red:#ff7d8d}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 system-ui,sans-serif}button,input,select,textarea{font:inherit}.app{max-width:1500px;margin:auto;padding:22px}.head{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}.head h1{margin:0;font-size:32px}.grid{display:grid;grid-template-columns:280px minmax(0,1fr);gap:14px}.panel{border:1px solid var(--line);background:var(--panel);border-radius:12px;overflow:hidden}.panel-head{padding:13px 15px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:8px}.repos{max-height:70vh;overflow:auto}.repo{display:block;width:100%;border:0;border-bottom:1px solid #282d36;background:transparent;color:inherit;text-align:left;padding:12px 14px;cursor:pointer}.repo:hover,.repo.active{background:#202630}.repo span{display:block;color:var(--muted);font-size:11px}.content{display:grid;gap:14px}.form{display:flex;gap:8px;flex-wrap:wrap;padding:13px 15px}.input,.btn,textarea,select{border:1px solid var(--line);background:#101319;color:inherit;border-radius:8px;padding:8px 10px}.input{min-width:150px}.btn{cursor:pointer}.btn:hover{border-color:#596373}.primary{background:#245a87;border-color:#3979ab}.danger{color:#ffabb6;border-color:#60313a}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px 12px;border-bottom:1px solid #292e37;vertical-align:top}th{font-size:11px;color:var(--muted);text-transform:uppercase}.table{overflow:auto}.muted{color:var(--muted)}.tabs{display:flex;border-bottom:1px solid var(--line)}.tab{border:0;background:transparent;color:var(--muted);padding:11px 14px;cursor:pointer}.tab.active{color:var(--text);border-bottom:2px solid var(--blue)}.section{padding:15px}.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.fields label{display:grid;gap:5px;color:var(--muted);font-size:12px}.fields input,.fields textarea,.fields select{width:100%}textarea{min-height:130px;resize:vertical;font:12px/1.5 ui-monospace,monospace}.code{white-space:pre-wrap;word-break:break-all;background:#0b0d11;border:1px solid #292f39;border-radius:8px;padding:12px;font:12px/1.5 ui-monospace,monospace}.status{padding:5px 8px;border-radius:999px;background:#242a34;font-size:11px}.error{margin:0 0 12px;padding:10px;border:1px solid #67323d;color:#ffb2bd;border-radius:8px}.empty{padding:40px;text-align:center;color:var(--muted)}@media(max-width:850px){.grid{grid-template-columns:1fr}.repos{display:flex;overflow:auto}.repo{min-width:220px}.fields{grid-template-columns:1fr}}@media(max-width:520px){.app{padding:12px}.form>*{width:100%}}
</style></head><body><main class="app"><header class="head"><h1>ECR Manager</h1><a class="btn" href="${escapeHtml(model.logsPath)}">Local logs</a><span class="muted">${model.region}</span></header><div id="error"></div><div class="grid"><aside class="panel"><div class="panel-head"><b>Repositories</b><button class="btn" id="refresh">Refresh</button></div><div class="form"><input class="input" id="new-repo" placeholder="repository/name"><button class="btn primary" id="create-repo">Create</button></div><div class="repos" id="repos"></div></aside><section class="content"><article class="panel"><div class="panel-head"><div><b id="repo-title">Select a repository</b><div class="muted" id="repo-uri"></div></div><div><button class="btn" id="mutability">Toggle immutability</button> <button class="btn danger" id="delete-repo">Delete repository</button></div></div><div class="tabs"><button class="tab active" data-tab="images">Images</button><button class="tab" data-tab="build">Build</button><button class="tab" data-tab="lifecycle">Lifecycle</button><button class="tab" data-tab="builds">Builds</button></div><div id="view"></div></article></section></div></main><script id="model" type="application/json">${inlineJson(model)}</script><script>
const model=JSON.parse(document.getElementById('model').textContent),$=id=>document.getElementById(id);let repo=model.repositories[0],images=[],tab='images';const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const size=n=>n>1073741824?(n/1073741824).toFixed(2)+' GB':n>1048576?(n/1048576).toFixed(1)+' MB':n>1024?(n/1024).toFixed(1)+' KB':n+' B';async function api(body){const response=await fetch('/web/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),value=await response.json();if(!response.ok||!value.ok)throw new Error(value.error?.message||'Request failed');return value.result}function fail(error){$('error').innerHTML='<div class="error">'+h(error.message)+'</div>'}function clear(){ $('error').innerHTML='' }function renderRepos(){$('repos').innerHTML=model.repositories.length?model.repositories.map(r=>'<button class="repo '+(repo?.repositoryName===r.repositoryName?'active':'')+'" data-repo="'+h(r.repositoryName)+'"><b>'+h(r.repositoryName)+'</b><span>'+h(r.imageTagMutability)+' · '+new Date(r.createdAt).toLocaleDateString()+'</span></button>').join(''):'<div class="empty">No repositories</div>';$('repos').querySelectorAll('button').forEach(x=>x.onclick=()=>select(model.repositories.find(r=>r.repositoryName===x.dataset.repo)))}async function select(value){repo=value;images=[];renderRepos();$('repo-title').textContent=repo.repositoryName;$('repo-uri').textContent=repo.repositoryUri;await loadImages();render()}async function loadImages(){if(!repo)return;try{clear();images=(await api({action:'listImages',repositoryName:repo.repositoryName})).images}catch(error){fail(error)}}function imageKey(image){return image.imageTags?.[0]?{imageTag:image.imageTags[0]}:{imageDigest:image.imageDigest}}function renderImages(){if(!repo)return '<div class="empty">Select a repository</div>';if(!images.length)return '<div class="empty">No images</div>';return '<div class="table"><table><thead><tr><th>Tags</th><th>Digest</th><th>Pushed</th><th>Size</th><th>Scan</th><th></th></tr></thead><tbody>'+images.map((image,i)=>'<tr><td>'+h((image.imageTags||[]).join(', ')||'untagged')+'</td><td>'+h(image.imageDigest?.slice(0,19))+'…</td><td>'+new Date(image.imagePushedAt).toLocaleString()+'</td><td>'+size(image.imageSizeInBytes||0)+'</td><td>'+h(image.imageScanStatus?.status||'—')+'</td><td><button class="btn" data-scan="'+i+'">Scan</button> <button class="btn" data-findings="'+i+'">Findings</button> <button class="btn" data-retag="'+i+'">Retag</button> <button class="btn danger" data-delete="'+i+'">Delete</button></td></tr>').join('')+'</tbody></table></div>'}function renderBuild(){return '<div class="section"><div class="fields"><label>Image tag<input id="build-tag" value="latest"></label><label>Source version<input id="source-version" placeholder="branch, tag, or commit"></label><label>Dockerfile<input id="dockerfile" value="Dockerfile"></label><label>Build context<input id="context" value="."></label></div><p><button class="btn primary" id="start-build">Start build</button></p></div>'}function renderLifecycle(){const sample={rules:[{rulePriority:1,description:'Keep 20 images',selection:{tagStatus:'any',countType:'imageCountMoreThan',countNumber:20},action:{type:'expire'}}]};return '<div class="section"><textarea id="lifecycle">'+h(JSON.stringify(sample,null,2))+'</textarea><p><button class="btn primary" id="save-lifecycle">Save lifecycle policy</button></p></div>'}function renderBuilds(){return '<div class="table"><table><thead><tr><th>Build</th><th>Status</th><th>Started</th><th>Duration</th></tr></thead><tbody>'+model.builds.map(b=>'<tr><td>'+h(b.id)+'</td><td><span class="status">'+h(b.buildStatus)+'</span></td><td>'+new Date(b.startTime).toLocaleString()+'</td><td>'+h(b.endTime?Math.round((new Date(b.endTime)-new Date(b.startTime))/1000)+' s':'running')+'</td></tr>').join('')+'</tbody></table></div>'}function render(){document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));$('view').innerHTML=tab==='images'?renderImages():tab==='build'?renderBuild():tab==='lifecycle'?renderLifecycle():renderBuilds();$('view').querySelectorAll('[data-delete]').forEach(x=>x.onclick=()=>runImage('deleteImage',Number(x.dataset.delete)));$('view').querySelectorAll('[data-scan]').forEach(x=>x.onclick=()=>runImage('startScan',Number(x.dataset.scan)));$('view').querySelectorAll('[data-findings]').forEach(x=>x.onclick=()=>findings(Number(x.dataset.findings)));$('view').querySelectorAll('[data-retag]').forEach(x=>x.onclick=()=>retag(Number(x.dataset.retag)));if($('start-build'))$('start-build').onclick=startBuild;if($('save-lifecycle'))$('save-lifecycle').onclick=saveLifecycle}async function runImage(action,index){if(action==='deleteImage'&&!confirm('Delete this image and all of its tags?'))return;try{clear();const key=action==='deleteImage'?{imageDigest:images[index].imageDigest}:imageKey(images[index]);await api({action,repositoryName:repo.repositoryName,...key});await loadImages();render()}catch(error){fail(error)}}async function findings(index){try{const result=await api({action:'scanFindings',repositoryName:repo.repositoryName,...imageKey(images[index])});$('view').innerHTML='<div class="section"><button class="btn" id="back">Back</button><h3>Scan findings</h3><div class="code">'+h(JSON.stringify(result,null,2))+'</div></div>';$('back').onclick=render}catch(error){fail(error)}}async function retag(index){const newTag=prompt('New tag');if(!newTag)return;try{await api({action:'retagImage',repositoryName:repo.repositoryName,newTag,...imageKey(images[index])});await loadImages();render()}catch(error){fail(error)}}async function startBuild(){try{const result=await api({action:'startBuild',repositoryName:repo.repositoryName,imageTag:$('build-tag').value,sourceVersion:$('source-version').value,dockerfile:$('dockerfile').value,context:$('context').value});alert('Started '+result.build.id);location.reload()}catch(error){fail(error)}}async function saveLifecycle(){try{await api({action:'setLifecycle',repositoryName:repo.repositoryName,policy:$('lifecycle').value});alert('Saved')}catch(error){fail(error)}}$('create-repo').onclick=async()=>{try{await api({action:'createRepository',repositoryName:$('new-repo').value,scanOnPush:true});location.reload()}catch(error){fail(error)}};$('delete-repo').onclick=async()=>{if(!repo||!confirm('Delete '+repo.repositoryName+' and every image?'))return;try{await api({action:'deleteRepository',repositoryName:repo.repositoryName,force:true});location.reload()}catch(error){fail(error)}};$('mutability').onclick=async()=>{if(!repo)return;try{await api({action:'setMutability',repositoryName:repo.repositoryName,imageTagMutability:repo.imageTagMutability==='IMMUTABLE'?'MUTABLE':'IMMUTABLE'});location.reload()}catch(error){fail(error)}};$('refresh').onclick=()=>location.reload();document.querySelectorAll('.tab').forEach(x=>x.onclick=()=>{tab=x.dataset.tab;render()});renderRepos();render();if(repo)select(repo);
</script></body></html>`;
}

export async function ecrManager(event, context = {}) {
  const request = http(event);
  if (
    !request ||
    (request.path !== '/web' && request.path !== '/web/' && request.path !== '/web/api')
  )
    return null;
  if (!authorized(event))
    return html('<h1>Authentication required</h1>', 401, {
      'www-authenticate': 'Basic realm="ECR manager"',
    });

  if (request.method === 'GET') {
    try {
      return html(
        dashboard({
          repositories: await repositories(context.gadgetAbortSignal),
          builds: await builds(context.gadgetAbortSignal),
          region: process.env.AWS_REGION,
          logsPath: request.path.replace(/\/$/, '') + '/logs',
        }),
      );
    } catch (error) {
      console.error('ECR dashboard failed', error);
      return html(
        '<h1>' +
          escapeHtml(error.name) +
          '</h1><pre>' +
          escapeHtml(error.message) +
          '</pre><a href="' +
          escapeHtml(request.path.replace(/\/$/, '') + '/logs') +
          '">View local logs</a>',
        500,
      );
    }
  }

  if (request.method === 'POST' && request.path === '/web/api') {
    try {
      return json({ ok: true, result: await action(JSON.parse(request.body || '{}')) });
    } catch (error) {
      console.error('ECR action failed', error);
      return json({ ok: false, error: { name: error.name, message: error.message } }, 400);
    }
  }

  return json(
    { ok: false, error: { name: 'MethodNotAllowed', message: 'Method not allowed' } },
    405,
  );
}
