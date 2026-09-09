<script lang="ts">
  import { exampleExport, environmentHint } from './environment.mjs';
  import SidebarNav from '../SidebarNav.svelte';

  let { data } = $props();
  let menuOpen = $state(false);
  let copiedId = $state('');
  let copyError = $state('');
  let cliModes = $state<Record<string, boolean>>({});
  let items = $derived(
    data.groups.flatMap(group => [
      { id: group.id, title: group.title, level: 0 },
      ...group.recipes.map(snippet => ({ id: snippet.id, title: snippet.title, level: 1 })),
    ]),
  );

  async function copy(id: string, code: string) {
    try {
      await navigator.clipboard.writeText(code);
      copiedId = id;
      copyError = '';
      setTimeout(() => {
        if (copiedId === id) copiedId = '';
      }, 1500);
    } catch {
      copiedId = '';
      copyError = 'Clipboard unavailable. Select and copy the code.';
    }
  }
</script>

<svelte:head>
  <title>Generator | Megakuul</title>
  <meta
    name="description"
    content="Tagged AWS service and role generators with environment inputs and scoped IAM policy JSON."
  />
  <link rel="canonical" href="https://megakuul.ch/worldskills/generator" />
</svelte:head>

<div class="sticky top-0 z-30 border-b border-white/5 bg-[rgb(17,16,16)]/90 backdrop-blur-md">
  <div class="mx-auto flex max-w-350 items-center gap-3 px-4 py-3">
    <a href="/worldskills" class="shrink-0 text-sm text-slate-400 hover:text-white">← worldskills</a
    >
    <h1 class="min-w-0 flex-1 truncate text-lg font-bold">Generator</h1>
    <button
      class="copy-button lg:hidden"
      aria-expanded={menuOpen}
      onclick={() => (menuOpen = !menuOpen)}>Contents</button
    >
  </div>
</div>

<div class="mx-auto flex w-full max-w-350 gap-8 px-4">
  <SidebarNav {items} bind:menuOpen />
  <main class="min-w-0 flex-1 space-y-8 py-6">
    {#each data.groups as group}
      <section aria-labelledby={group.id}>
        <h2 id={group.id} class="mb-3 scroll-mt-24 text-2xl font-bold">{group.title}</h2>
        <div class="space-y-4">
          {#each group.recipes as snippet}
            <article
              id={snippet.id}
              class="min-w-0 scroll-mt-24 overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]"
            >
              <div
                class="flex items-center justify-between gap-3 border-b border-white/5 px-4 py-2.5"
              >
                <h3 class="text-sm font-semibold">{snippet.title}</h3>
                <button
                  class="copy-button shrink-0"
                  aria-label={`Copy ${snippet.title} ${snippet.jsonOnly ? 'JSON' : 'command'}`}
                  onclick={() =>
                    copy(
                      snippet.id + '-command',
                      snippet.jsonOnly
                        ? snippet.json!
                        : cliModes[snippet.id] && snippet.cliCommand
                          ? snippet.cliCommand
                          : snippet.command,
                    )}>{copiedId === snippet.id + '-command' ? 'Copied ✓' : 'Copy'}</button
                >
              </div>
              {#if snippet.cliCommand}
                <div
                  class="flex gap-2 border-b border-white/5 px-4 py-2"
                  role="group"
                  aria-label={`${snippet.title} deployment method`}
                >
                  <button
                    class="copy-button"
                    aria-pressed={!cliModes[snippet.id]}
                    onclick={() => (cliModes[snippet.id] = false)}>CloudFormation</button
                  >
                  <button
                    class="copy-button"
                    aria-pressed={!!cliModes[snippet.id]}
                    onclick={() => (cliModes[snippet.id] = true)}>AWS CLI</button
                  >
                </div>
              {/if}
              {#if !snippet.jsonOnly && snippet.env.length}
                <div
                  class="flex flex-wrap gap-1.5 border-b border-white/5 px-4 py-2"
                  role="group"
                  aria-label="Environment variables · * required"
                >
                  {#each cliModes[snippet.id] && snippet.cliEnv ? snippet.cliEnv : snippet.env as variable}
                    <button
                      class="env-variable"
                      class:required={variable.required}
                      title={environmentHint(variable)}
                      aria-label={`${variable.name}: ${environmentHint(variable)}`}
                      onclick={() =>
                        copy(snippet.id + '-env-' + variable.name, exampleExport(variable))}
                    >
                      {variable.name}{variable.required ? ' *' : ''}{copiedId ===
                      snippet.id + '-env-' + variable.name
                        ? ' ✓'
                        : ''}
                    </button>
                  {/each}
                </div>
              {/if}
              <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to focus the code to scroll horizontally.) -->
              <div
                class="code-wrap overflow-x-auto"
                tabindex="0"
                role="region"
                aria-label={snippet.title}
              >
                {@html snippet.jsonOnly
                  ? snippet.jsonHtml!
                  : cliModes[snippet.id] && snippet.cliHtml
                    ? snippet.cliHtml
                    : snippet.commandHtml}
              </div>
              {#if !snippet.jsonOnly && snippet.json !== null && snippet.jsonHtml !== null}
                <details class="border-t border-white/10">
                  <summary class="cursor-pointer px-4 py-2.5 text-sm text-slate-300"
                    >{snippet.jsonTitle}</summary
                  >
                  <div class="flex justify-end px-4 pb-2">
                    <button
                      class="copy-button"
                      aria-label={`Copy ${snippet.title} JSON`}
                      onclick={() => copy(snippet.id + '-json', snippet.json!)}
                      >{copiedId === snippet.id + '-json' ? 'Copied ✓' : 'Copy JSON'}</button
                    >
                  </div>
                  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to focus the code to scroll horizontally.) -->
                  <div
                    class="code-wrap overflow-x-auto"
                    tabindex="0"
                    role="region"
                    aria-label={`${snippet.title} JSON`}
                  >
                    {@html snippet.jsonHtml}
                  </div>
                </details>
              {/if}
            </article>
          {/each}
        </div>
      </section>
    {/each}
    <div role="status" class="text-sm text-amber-200">{copyError}</div>
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
    color: #e9d5ff;
    border-color: rgb(192 132 252 / 40%);
  }
  .env-variable:hover,
  .env-variable:focus-visible {
    color: white;
    outline: 1px solid #c084fc;
  }
  .copy-button {
    cursor: pointer;
    border: 1px solid rgb(255 255 255 / 15%);
    border-radius: 7px;
    padding: 0.35rem 0.65rem;
    font-size: 0.8rem;
    background: rgb(255 255 255 / 5%);
  }
  .copy-button[aria-pressed='true'] {
    border-color: #c084fc;
    color: #e9d5ff;
    background: rgb(192 132 252 / 12%);
  }
  .copy-button:hover {
    background: rgb(255 255 255 / 12%);
  }
  .copy-button:focus-visible,
  .code-wrap:focus-visible {
    outline: 2px solid #c084fc;
    outline-offset: 2px;
  }
  .code-wrap :global(pre.shiki) {
    width: auto;
    max-width: none;
    margin: 0;
    padding: 1rem;
    overflow: visible;
    font-family: 'Fira Code', monospace;
    font-size: 0.8125rem;
    line-height: 1.5;
    tab-size: 2;
    box-shadow: none;
    background: transparent !important;
  }
  .code-wrap :global(code) {
    font: inherit;
    white-space: pre;
  }
</style>
