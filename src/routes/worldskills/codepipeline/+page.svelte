<script lang="ts">
  import SidebarNav from '../SidebarNav.svelte';
  import { exampleExport, environmentHint } from '$lib/powertools/environment';

  let { data } = $props();
  let selected = $state<Record<string, number>>({});
  let copiedId = $state('');
  let copyError = $state('');
  let menuOpen = $state(false);
  let items = $derived(data.pipelines.map(p => ({ id: p.id, title: p.title, level: 0 })));
  async function copy(id: string, raw: string) {
    try {
      await navigator.clipboard.writeText(raw);
      copiedId = id;
      copyError = '';
      setTimeout(() => {
        if (copiedId === id) copiedId = '';
      }, 1500);
    } catch {
      copyError = 'Clipboard unavailable. Select and copy the code.';
    }
  }
</script>

<svelte:head>
  <title>CodePipeline | Megakuul</title>
  <meta
    name="description"
    content="CloudFormation pipeline presets: S3, CodeCommit, builds, ECR, ECS, EC2, Lambda and CodeDeploy with scoped roles and approval."
  />
  <link rel="canonical" href="https://megakuul.ch/worldskills/codepipeline" />
</svelte:head>

<div class="sticky top-0 z-30 border-b border-white/5 bg-[rgb(17,16,16)]/90 backdrop-blur-md">
  <div class="mx-auto flex max-w-350 items-center gap-3 px-4 py-3">
    <a href="/worldskills" class="shrink-0 text-sm text-slate-400 hover:text-white">← worldskills</a
    >
    <h1 class="min-w-0 flex-1 truncate text-lg font-bold">CodePipeline</h1>
    <button
      class="copy-button lg:hidden"
      aria-expanded={menuOpen}
      onclick={() => (menuOpen = !menuOpen)}>Contents</button
    >
  </div>
</div>

{#snippet code(title: string, html: string)}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Code needs keyboard scrolling.) -->
  <div class="code-wrap overflow-x-auto" tabindex="0" role="region" aria-label={title}>
    {@html html}
  </div>
{/snippet}

<div class="mx-auto flex w-full max-w-350 gap-8 px-4" style="--sidebar-active-border: #94a3b8">
  <SidebarNav {items} bind:menuOpen />
  <main class="min-w-0 flex-1 space-y-4 py-6">
    <p class="text-xs text-slate-400">
      Deploy, then upload a source revision. Every pipeline requires approval.
    </p>
    {#each data.pipelines as pipeline}
      {@const variant = pipeline.variants[selected[pipeline.id] ?? 0]}
      <article
        id={pipeline.id}
        class="min-w-0 scroll-mt-24 overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]"
      >
        <div class="flex items-center justify-between gap-3 border-b border-white/5 px-4 py-2.5">
          <h2 class="min-w-0 text-sm font-semibold">{pipeline.title}</h2>
          <div class="flex shrink-0 items-center gap-2">
            <a
              class="copy-button"
              href="/worldskills/codepipeline/files/{variant.file}"
              download={variant.file}
              aria-label={`Download ${variant.file}`}>Download</a
            >
            <button
              class="copy-button"
              aria-label={`Copy ${pipeline.title} command`}
              onclick={() => copy(pipeline.id, variant.command.raw)}
              >{copiedId === pipeline.id ? 'Copied ✓' : 'Copy'}</button
            >
          </div>
        </div>
        <div
          class="flex flex-wrap items-center gap-2 border-b border-white/5 px-4 py-2"
          role="group"
          aria-label={`${pipeline.title} source`}
        >
          {#each pipeline.variants as option, i}
            <button
              class="copy-button"
              aria-pressed={(selected[pipeline.id] ?? 0) === i}
              onclick={() => (selected[pipeline.id] = i)}>{option.provider}</button
            >
          {/each}
          <a
            class="ml-auto text-xs text-slate-400 underline hover:text-white"
            href="https://docs.aws.amazon.com/codepipeline/latest/userguide/action-reference.html"
            >AWS reference</a
          >
        </div>
        <div
          class="flex flex-wrap gap-1.5 border-b border-white/5 px-4 py-2"
          role="group"
          aria-label="Environment variables (* required)"
        >
          {#each data.inputs as variable}
            <button
              class="env-variable required"
              title={environmentHint(variable)}
              aria-label={`${variable.name}: ${environmentHint(variable)}`}
              onclick={() => copy(`${pipeline.id}-${variable.name}`, exampleExport(variable))}
            >
              {variable.name} *{copiedId === `${pipeline.id}-${variable.name}` ? ' ✓' : ''}
            </button>
          {/each}
        </div>
        {@render code(`${pipeline.title} command`, variant.command.html)}
        <details class="border-t border-white/10">
          <summary class="cursor-pointer px-4 py-2.5 text-sm text-slate-300">Source</summary>
          <div class="flex flex-wrap items-center justify-between gap-2 px-4 pb-2">
            <span class="text-xs text-slate-400"
              >{variant.provider === 'S3' ? 'source.zip' : 'main'} · uploads the starter revision</span
            >
            <div class="flex gap-2">
              <a
                class="copy-button"
                href="/worldskills/codepipeline/files/{pipeline.id}-source.zip"
                download>Starter ZIP</a
              >
              <button
                class="copy-button"
                aria-label={`Copy ${pipeline.title} source command`}
                onclick={() => copy(`${pipeline.id}-source`, variant.source.raw)}
                >{copiedId === `${pipeline.id}-source` ? 'Copied ✓' : 'Copy'}</button
              >
            </div>
          </div>
          {@render code(`${pipeline.title} source`, variant.source.html)}
        </details>
        <details class="border-t border-white/10">
          <summary class="cursor-pointer px-4 py-2.5 text-sm text-slate-300"
            >CloudFormation YAML</summary
          >
          <div class="flex justify-end px-4 pb-2">
            <button
              class="copy-button"
              aria-label={`Copy ${pipeline.title} YAML`}
              onclick={() => copy(`${pipeline.id}-yaml`, variant.template.raw)}
              >{copiedId === `${pipeline.id}-yaml` ? 'Copied ✓' : 'Copy YAML'}</button
            >
          </div>
          {@render code(`${pipeline.title} YAML`, variant.template.html)}
        </details>
      </article>
    {/each}
    {#if copyError}<p role="status" class="text-sm text-amber-300">{copyError}</p>{/if}
  </main>
</div>

<style>
  .env-variable {
    cursor: pointer;
    border: 1px solid rgb(255 255 255 / 12%);
    border-radius: 4px;
    padding: 0.2rem 0.4rem;
    color: #94a3b8;
    font: 0.7rem monospace;
    overflow-wrap: anywhere;
  }
  .env-variable.required {
    color: #cbd5e1;
    border-color: rgb(255 255 255 / 25%);
  }
  .env-variable:hover,
  .env-variable:focus-visible {
    color: white;
    outline: 1px solid #94a3b8;
  }

  .copy-button {
    display: inline-flex;
    align-items: center;
    border: 1px solid rgb(255 255 255 / 0.1);
    border-radius: 0.5rem;
    background: rgb(255 255 255 / 0.03);
    padding: 0.35rem 0.65rem;
    font-size: 0.75rem;
    cursor: pointer;
  }
  .copy-button:hover {
    background: rgb(255 255 255 / 0.08);
  }
  .code-wrap :global(pre.shiki) {
    margin: 0;
    padding: 1rem;
    font-family: 'Fira Code', monospace;
    font-size: 0.8rem;
    line-height: 1.55;
    background: transparent !important;
  }
</style>
