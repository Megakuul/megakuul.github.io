<script lang="ts">
  import SidebarNav from '../SidebarNav.svelte';

  let { data } = $props();
  let menuOpen = $state(false);
  let copiedId = $state('');
  let copyError = $state('');
  let items = $derived(
    data.groups.flatMap(group => [
      { id: group.id, title: group.title, level: 0 },
      ...group.snippets.map(snippet => ({ id: snippet.id, title: snippet.title, level: 1 })),
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
  <title>cloud-init | Megakuul</title>
  <meta
    name="description"
    content="Amazon Linux 2023 cloud-init snippets: S3 applications, Nginx, ECR containers and ECS hosts."
  />
  <link rel="canonical" href="https://megakuul.ch/worldskills/cloud-init" />
</svelte:head>

<div class="sticky top-0 z-30 border-b border-white/5 bg-[rgb(17,16,16)]/90 backdrop-blur-md">
  <div class="mx-auto flex max-w-350 items-center gap-3 px-4 py-3">
    <a href="/worldskills" class="shrink-0 text-sm text-slate-400 hover:text-white">← worldskills</a
    >
    <h1 class="min-w-0 flex-1 truncate text-lg font-bold">cloud-init</h1>
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
          {#each group.snippets as snippet}
            <article
              id={snippet.id}
              class="min-w-0 scroll-mt-24 overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]"
            >
              <div
                class="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-4 py-2.5"
              >
                <h3 class="text-sm font-semibold">{snippet.title}</h3>
                <div class="flex shrink-0 gap-2">
                  {#if snippet.download}
                    <a
                      class="copy-button"
                      href={snippet.download}
                      download
                      aria-label={`Download ${snippet.title}`}>YAML ↓</a
                    >
                  {/if}
                  <button
                    class="copy-button shrink-0"
                    aria-label={`Copy ${snippet.title}`}
                    onclick={() => copy(snippet.id, snippet.code)}
                    >{copiedId === snippet.id ? 'Copied ✓' : 'Copy'}</button
                  >
                </div>
              </div>
              <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to focus the code to scroll horizontally.) -->
              <div
                class="code-wrap overflow-x-auto"
                tabindex="0"
                role="region"
                aria-label={snippet.title}
              >
                {@html snippet.html}
              </div>
            </article>
          {/each}
        </div>
      </section>
    {/each}
    <div role="status" class="text-sm text-amber-200">{copyError}</div>
  </main>
</div>

<style>
  .copy-button {
    cursor: pointer;
    border: 1px solid rgb(255 255 255 / 15%);
    border-radius: 7px;
    padding: 0.35rem 0.65rem;
    font-size: 0.8rem;
    background: rgb(255 255 255 / 5%);
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
