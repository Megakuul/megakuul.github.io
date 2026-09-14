<script lang="ts">
  import SidebarNav from '../SidebarNav.svelte';

  let { data } = $props();
  let copiedId = $state('');
  let copyError = $state('');
  let menuOpen = $state(false);
  let items = $derived(
    data.groups.flatMap(group => [
      { id: group.id, title: group.title, level: 0 },
      ...group.snippets.map(snippet => ({ id: snippet.id, title: snippet.title, level: 1 })),
    ]),
  );
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
  <title>Step Functions | Megakuul</title>
  <meta
    name="description"
    content="Step Functions ASL JSON: data flow, variables, Map, Parallel and callbacks with sample inputs and outputs."
  />
  <meta property="og:title" content="Step Functions - Megakuul" />
  <meta
    property="og:description"
    content="Copyable Step Functions JSON for data flow, variables and service integrations."
  />
  <link rel="canonical" href="https://megakuul.ch/worldskills/stepfunctions" />
</svelte:head>

<div class="sticky top-0 z-30 border-b border-white/5 bg-[rgb(17,16,16)]/90 backdrop-blur-md">
  <div class="mx-auto flex max-w-350 items-center gap-3 px-4 py-3">
    <a href="/worldskills" class="shrink-0 text-sm text-slate-400 hover:text-white">← worldskills</a
    >
    <h1 class="min-w-0 flex-1 truncate text-lg font-bold">Step Functions</h1>
    <button
      class="copy-button lg:hidden"
      aria-expanded={menuOpen}
      onclick={() => (menuOpen = !menuOpen)}>Contents</button
    >
  </div>
</div>

{#snippet code(id: string, title: string, raw: string, html: string)}
  <div class="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
    <div class="flex items-center justify-between gap-3 border-b border-white/5 px-4 py-2.5">
      <h3 class="text-sm font-semibold">{title}</h3>
      <button class="copy-button" aria-label={`Copy ${title}`} onclick={() => copy(id, raw)}
        >{copiedId === id ? 'Copied ✓' : 'Copy'}</button
      >
    </div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex (Code needs keyboard scrolling.) -->
    <div class="code-wrap overflow-x-auto" tabindex="0" role="region" aria-label={title}>
      {@html html}
    </div>
  </div>
{/snippet}

<div class="mx-auto flex w-full max-w-350 gap-8 px-4" style="--sidebar-active-border: #94a3b8">
  <SidebarNav {items} bind:menuOpen />
  <main class="min-w-0 flex-1 space-y-8 py-6">
    {#each data.groups as group}
      <section aria-labelledby={group.id} class="space-y-4">
        <h2 id={group.id} class="scroll-mt-24 text-2xl font-bold">{group.title}</h2>
        {#if group.note}<p class="text-sm text-slate-400">{group.note}</p>{/if}
        {#each group.snippets as snippet}
          <article id={snippet.id} class="scroll-mt-24 space-y-3">
            <div class="flex items-center justify-between gap-3">
              <h3 class="text-lg font-semibold">{snippet.title}</h3>
              <a
                class="shrink-0 text-xs text-slate-400 underline hover:text-white"
                href={snippet.reference}>AWS reference</a
              >
            </div>
            {#if snippet.note}<p class="text-sm text-slate-400">{snippet.note}</p>{/if}
            {@render code(snippet.id, 'ASL', snippet.definition.raw, snippet.definition.html)}
            <details class="rounded-xl border border-white/10">
              <summary class="cursor-pointer px-4 py-3 text-sm font-semibold"
                >Input / Output</summary
              >
              <div class="space-y-3 px-3 pb-3">
                {#each snippet.extra as block, i}
                  {@render code(`${snippet.id}-extra-${i}`, block.title, block.raw, block.html)}
                {/each}
                {#each snippet.examples as example, i}
                  {#if snippet.examples.length > 1}<h4 class="text-sm font-semibold">
                      {example.title}
                    </h4>{/if}
                  {@render code(
                    `${snippet.id}-input-${i}`,
                    'Input',
                    example.input.raw,
                    example.input.html,
                  )}
                  {@render code(
                    `${snippet.id}-output-${i}`,
                    'Output',
                    example.output.raw,
                    example.output.html,
                  )}
                {/each}
              </div>
            </details>
          </article>
        {/each}
      </section>
    {/each}
    {#if copyError}<p role="status" class="text-sm text-amber-300">{copyError}</p>{/if}
  </main>
</div>

<style>
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
