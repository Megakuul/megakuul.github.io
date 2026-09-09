<script>
  import SidebarNav from '../SidebarNav.svelte';

  let { data } = $props();

  /** @type {'js' | 'py'} */
  let lang = $state('js');
  let copiedId = $state('');
  let menuOpen = $state(false);
  let visibleGroups = $derived(data.groups.filter(group => !group.nodeOnly || lang === 'js'));

  // Flatten groups + snippets into the leveled list the sidebar expects.
  let items = $derived(
    visibleGroups.flatMap(group => [
      { id: group.id, title: group.title, level: 0 },
      ...group.snippets.map(s => ({ id: s.id, title: s.title, level: 1 })),
    ]),
  );

  /** @param {string} id @param {string} raw */
  async function copy(id, raw) {
    try {
      await navigator.clipboard.writeText(raw);
      copiedId = id;
      setTimeout(() => (copiedId === id ? (copiedId = '') : null), 1200);
    } catch {
      /* clipboard blocked, ignore */
    }
  }
</script>

<svelte:head>
  <title>Lambda Cheatsheet | Megakuul</title>
  <meta
    name="description"
    content="Every AWS Lambda incoming trigger and outgoing event as a short, comment-free example in JavaScript and Python."
  />
  <meta property="og:title" content="Lambda Cheatsheet - Megakuul" />
  <meta
    property="og:description"
    content="Every AWS Lambda incoming trigger and outgoing event as a short, comment-free example in JavaScript and Python."
  />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="https://megakuul.ch/favicon.png" />
  <link rel="canonical" href="https://megakuul.ch/worldskills/lambda" />
</svelte:head>

<div class="sticky top-0 z-30 border-b border-white/5 bg-[rgb(17,16,16)]/70 backdrop-blur-md">
  <div class="mx-auto flex max-w-350 flex-row items-center gap-3 px-4 py-3">
    <a href="/worldskills" class="shrink-0 text-sm text-slate-200/40 hover:text-slate-200/80">
      ← worldskills
    </a>
    <span class="shrink-0 text-lg font-bold">Lambda</span>

    <div class="flex-1"></div>

    <button
      class="apple-glass rounded-lg px-3 py-1.5 text-sm lg:hidden"
      onclick={() => (menuOpen = !menuOpen)}
    >
      {menuOpen ? 'Close' : 'Menu'}
    </button>

    <div class="apple-glass flex shrink-0 flex-row rounded-xl p-1 select-none">
      <button
        class="rounded-lg px-3 py-1 text-sm font-medium transition-all"
        class:dense-apple-glass={lang === 'js'}
        class:text-slate-200={lang === 'js'}
        class:text-slate-200-40={lang !== 'js'}
        onclick={() => (lang = 'js')}
      >
        Javascript
      </button>
      <button
        class="rounded-lg px-3 py-1 text-sm font-medium transition-all"
        class:dense-apple-glass={lang === 'py'}
        class:text-slate-200={lang === 'py'}
        onclick={() => (lang = 'py')}
      >
        Python
      </button>
    </div>
  </div>
</div>

<div class="mx-auto flex w-full max-w-350 flex-row gap-8 px-4">
  <SidebarNav {items} bind:menuOpen />

  <main class="min-w-0 flex-1 py-8">
    <header class="mb-10">
      <h1 class="mb-3 text-3xl font-bold sm:text-5xl">Lambda Cheatsheet</h1>
      <p class="max-w-2xl text-slate-200/50 sm:text-lg">
        Every incoming trigger and outgoing event as a short, comment-free handler. Flip the whole
        page between JavaScript and Python with the switch up top. Jump anywhere with the menu.
      </p>
    </header>

    {#each visibleGroups as group}
      <section class="mb-16">
        <div id={group.id} data-anchor class="scroll-mt-24">
          <h2 class="text-2xl font-bold sm:text-3xl">{group.title}</h2>
          {#if group.blurb}<p class="mt-1 mb-6 text-slate-200/45">{group.blurb}</p>{/if}
          {#if group.downloads.length}
            <div class="my-5 flex flex-wrap gap-3">
              {#each group.downloads as download}
                <a class="apple-glass rounded-lg px-4 py-2 text-sm" href={download.href} download
                  >{download.title}</a
                >
              {/each}
            </div>
          {/if}
        </div>

        <div class="flex flex-col gap-6">
          {#each group.snippets as s}
            <article id={s.id} data-anchor class="apple-glass scroll-mt-24 rounded-2xl p-4 sm:p-5">
              <div class="flex flex-row items-start justify-between gap-3">
                <h3 class="text-lg font-semibold sm:text-xl">{s.title}</h3>
                <button
                  class="apple-glass shrink-0 rounded-lg px-2.5 py-1 text-xs transition-all hover:scale-105"
                  onclick={() => copy(s.id, lang === 'js' ? s.jsRaw : s.pyRaw)}
                >
                  {copiedId === s.id ? 'Copied ✓' : 'Copy'}
                </button>
              </div>

              {#if s.note}
                <p class="mt-2 text-sm leading-relaxed text-slate-200/45">{s.note}</p>
              {/if}

              <div class="code-wrap mt-3 overflow-x-auto rounded-xl">
                {#if lang === 'js'}
                  {@html s.jsHtml}
                {:else}
                  {@html s.pyHtml}
                {/if}
              </div>
            </article>
          {/each}
        </div>
      </section>
    {/each}
  </main>
</div>

<style>
  .text-slate-200-40 {
    color: rgba(226, 232, 240, 0.4);
  }

  .code-wrap :global(pre.shiki) {
    margin: 0;
    padding: 1rem 1.15rem;
    font-family: 'Fira Code', monospace;
    font-size: 0.8rem;
    line-height: 1.55;
    border-radius: 0.75rem;
    box-shadow:
      rgba(255, 255, 255, 0.05) 0px 6px 24px 0px,
      rgba(255, 255, 255, 0.08) 0px 0px 0px 1px;
    background-color: rgba(255, 255, 255, 0.04) !important;
  }

  @media (min-width: 640px) {
    .code-wrap :global(pre.shiki) {
      font-size: 0.875rem;
    }
  }
</style>
