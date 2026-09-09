<script lang="ts">
  let { data } = $props();
  let language = $state('javascript');
  let selected = $derived(data.examples.find(example => example.id === language)!);
  let copied = $state('');
  let error = $state('');

  async function copy(id: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      copied = id;
      error = '';
      setTimeout(() => {
        if (copied === id) copied = '';
      }, 1500);
    } catch {
      error = 'Clipboard unavailable. Use Download or select the code.';
    }
  }

  function download(filename: string, code: string) {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
</script>

<svelte:head>
  <title>HTTP Router | Megakuul</title>
  <meta
    name="description"
    content="Copy or download a Lambda HTTP router for Node.js and Python."
  />
  <link rel="canonical" href="https://megakuul.ch/worldskills/gadgets" />
</svelte:head>

<main class="mx-auto max-w-6xl space-y-6 px-4 py-10 sm:px-8">
  <a class="text-sm text-slate-400 hover:text-white" href="/worldskills">← worldskills</a>
  <div class="flex flex-wrap items-center justify-between gap-4">
    <h1 class="text-3xl font-bold sm:text-5xl">HTTP Router</h1>
    <div class="flex gap-2" aria-label="Language">
      {#each data.examples as example}
        <button
          aria-pressed={language === example.id}
          onclick={() => {
            language = example.id;
            copied = '';
            error = '';
          }}>{example.title}</button
        >
      {/each}
    </div>
  </div>
  <p class="text-sm text-slate-400">Function URL · API Gateway · ALB · No dependencies</p>

  <section>
    <div class="heading">
      <h2>{selected.filename} · handler: index.handler</h2>
      <div class="flex gap-2">
        <button onclick={() => copy('code', selected.code)}
          >{copied === 'code' ? 'Copied ✓' : 'Copy'}</button
        >
        <button onclick={() => download(selected.filename, selected.code)}>Download</button>
      </div>
    </div>
    <div class="code-wrap overflow-x-auto">{@html selected.html}</div>
  </section>

  <p role="status" class="text-sm text-amber-200">{error}</p>
</main>

<style>
  section {
    min-width: 0;
    border: 1px solid rgb(255 255 255 / 10%);
    border-radius: 12px;
    padding: 1rem;
    background: rgb(255 255 255 / 2%);
  }
  .heading {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }
  h2 {
    font-size: 0.9rem;
    font-weight: 600;
  }
  button {
    border: 1px solid rgb(255 255 255 / 15%);
    border-radius: 7px;
    padding: 0.4rem 0.75rem;
    font-size: 0.8rem;
    background: rgb(255 255 255 / 5%);
  }
  button:hover,
  button[aria-pressed='true'] {
    background: rgb(255 255 255 / 15%);
  }
  button:focus-visible {
    outline: 2px solid #6ee7b7;
    outline-offset: 3px;
  }
  .code-wrap :global(pre) {
    margin: 0;
    padding: 1rem;
    font-size: 0.8rem;
    line-height: 1.7;
    background: transparent !important;
  }
</style>
