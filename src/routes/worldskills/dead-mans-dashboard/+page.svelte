<script lang="ts">
  import dashboardJson from './dead-mans-dashboard.json?raw';

  const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\"'\"'") + "'";
  const deploy =
    'aws cloudwatch put-dashboard --region eu-central-1 --dashboard-name dead-mans-dashboard --dashboard-body ';
  const inlineCommand = deploy + shellQuote(JSON.stringify(JSON.parse(dashboardJson)));
  const fileCommand = deploy + 'file://dead-mans-dashboard.json';
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
      error = 'Clipboard unavailable. Select the text to copy it.';
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([dashboardJson], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'dead-mans-dashboard.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
</script>

<svelte:head>
  <title>Dead Man’s Dashboard | Megakuul</title>
  <meta name="description" content="CloudWatch dashboard deployment command and raw JSON." />
  <link rel="canonical" href="https://megakuul.ch/worldskills/dead-mans-dashboard" />
</svelte:head>

<main class="mx-auto max-w-6xl space-y-6 px-4 py-10 sm:px-8">
  <a class="text-sm text-slate-400 hover:text-white" href="/worldskills">← worldskills</a>
  <h1 class="text-3xl font-bold sm:text-5xl">Dead Man’s Dashboard</h1>

  <section>
    <div class="heading">
      <h2>Inline command</h2>
      <button aria-label="Copy inline command" onclick={() => copy('inline', inlineCommand)}
        >{copied === 'inline' ? 'Copied ✓' : 'Copy'}</button
      >
    </div>
    <textarea
      aria-label="Inline deployment command"
      readonly
      value={inlineCommand}
      rows="6"
      spellcheck="false"
    ></textarea>
  </section>

  <section>
    <div class="heading">
      <h2>dead-mans-dashboard.json</h2>
      <div class="flex shrink-0 gap-2">
        <button aria-label="Copy dashboard JSON" onclick={() => copy('json', dashboardJson)}
          >{copied === 'json' ? 'Copied ✓' : 'Copy'}</button
        >
        <button onclick={download}>Download</button>
      </div>
    </div>
    <textarea
      aria-label="Raw dashboard JSON"
      readonly
      value={dashboardJson}
      rows="12"
      wrap="off"
      spellcheck="false"
    ></textarea>
  </section>

  <section>
    <div class="heading">
      <h2>Deploy JSON file</h2>
      <button
        aria-label="Copy JSON file deployment command"
        onclick={() => copy('file', fileCommand)}>{copied === 'file' ? 'Copied ✓' : 'Copy'}</button
      >
    </div>
    <textarea
      aria-label="JSON file deployment command"
      readonly
      value={fileCommand}
      rows="3"
      spellcheck="false"
    ></textarea>
  </section>
  <p class="text-sm text-amber-200" role="status">{error}</p>
</main>

<style>
  section {
    min-width: 0;
    padding: 1rem;
    border: 1px solid rgb(255 255 255 / 10%);
    border-radius: 12px;
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
    overflow-wrap: anywhere;
  }
  button {
    border: 1px solid rgb(255 255 255 / 15%);
    border-radius: 7px;
    padding: 0.4rem 0.75rem;
    font-size: 0.75rem;
    background: rgb(255 255 255 / 5%);
  }
  button:hover {
    background: rgb(255 255 255 / 10%);
  }
  textarea {
    display: block;
    width: 100%;
    min-width: 0;
    resize: vertical;
    padding: 0.85rem;
    border: 1px solid rgb(255 255 255 / 8%);
    border-radius: 7px;
    background: rgb(0 0 0 / 25%);
    color: #cbd5e1;
    font-family: 'Fira Code', monospace;
    font-size: 0.75rem;
    line-height: 1.7;
  }
  button:focus-visible,
  textarea:focus-visible {
    outline: 2px solid #6ee7b7;
    outline-offset: 3px;
  }
</style>
