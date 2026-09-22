<script lang="ts">
  import { exampleExport, environmentHint } from '$lib/powertools/environment';
  import type { CommandPlatform } from '$lib/powertools/platform';
  import { onMount } from 'svelte';
  import SidebarNav from '../SidebarNav.svelte';

  let { data } = $props();
  let menuOpen = $state(false);
  let copiedId = $state('');
  let copyError = $state('');
  let platform = $state<CommandPlatform>('linux');
  onMount(() => {
    try {
      if (localStorage.getItem('powertools-platform') === 'windows') platform = 'windows';
    } catch {
      /* Storage may be disabled. The toggle still works. */
    }
  });
  function changePlatform(value: CommandPlatform) {
    platform = value;
    copiedId = '';
    copyError = '';
    try {
      localStorage.setItem('powertools-platform', value);
    } catch {
      /* Optional preference. */
    }
  }
  let commandModes = $state<Record<string, 'cfn' | 'cli' | 'serviceOnly'>>({});
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
  <title>Powertools | Megakuul</title>
  <meta
    name="description"
    content="Tagged AWS service and role commands with environment inputs and scoped IAM policy JSON."
  />
  <link rel="canonical" href="https://megakuul.github.io/worldskills/powertools" />
</svelte:head>

<div class="sticky top-0 z-30 border-b border-white/5 bg-[rgb(17,16,16)]/90 backdrop-blur-md">
  <div class="flex flex-wrap gap-3 items-center py-3 px-4 mx-auto max-w-350">
    <a href="/worldskills" class="text-sm hover:text-white shrink-0 text-slate-400">← worldskills</a
    >
    <h1 class="flex-1 min-w-0 text-lg font-bold truncate">Powertools</h1>
    <div
      class="flex order-last gap-1 w-full sm:order-none sm:w-auto shrink-0"
      role="group"
      aria-label="Command platform"
    >
      <button
        class="copy-button"
        aria-pressed={platform === 'linux'}
        onclick={() => changePlatform('linux')}>Linux</button
      >
      <button
        class="copy-button"
        aria-pressed={platform === 'windows'}
        onclick={() => changePlatform('windows')}>Windows</button
      >
    </div>
    <button
      class="lg:hidden copy-button"
      aria-expanded={menuOpen}
      onclick={() => (menuOpen = !menuOpen)}>Contents</button
    >
  </div>
</div>

<div class="flex gap-8 px-4 mx-auto w-full max-w-350" style="--sidebar-active-border: #94a3b8">
  <SidebarNav {items} bind:menuOpen />
  <main class="flex-1 py-6 space-y-8 min-w-0">
    {#each data.groups as group}
      <section aria-labelledby={group.id}>
        <h2 id={group.id} class="mb-3 text-2xl font-bold scroll-mt-24">{group.title}</h2>
        <div class="space-y-4">
          {#each group.recipes as snippet}
            {@const mode = commandModes[snippet.id] ?? 'cfn'}
            {@const isCli = mode === 'cli'}
            {@const deployment = mode === 'serviceOnly' ? snippet.serviceOnly! : snippet}
            {@const command =
              platform === 'windows'
                ? isCli
                  ? snippet.windowsCliCommand!
                  : deployment.windowsCommand
                : isCli
                  ? snippet.cliCommand!
                  : deployment.command}
            {@const commandHtml =
              platform === 'windows'
                ? isCli
                  ? snippet.windowsCliHtml!
                  : deployment.windowsCommandHtml
                : isCli
                  ? snippet.cliHtml!
                  : deployment.commandHtml}
            <article
              id={snippet.id}
              class="overflow-hidden min-w-0 rounded-xl border scroll-mt-24 border-white/10 bg-white/[0.02]"
            >
              <div
                class="flex gap-3 justify-between items-center py-2.5 px-4 border-b border-white/5"
              >
                <h3 class="min-w-0 text-sm font-semibold">{snippet.title}</h3>
                <div class="flex gap-2 items-center shrink-0">
                  {#if deployment.templateFile && !isCli}
                    <a
                      class="copy-button"
                      href={deployment.templateUrl!}
                      download={deployment.templateFile}
                      title={deployment.templateFile}
                      aria-label={`Download ${deployment.templateFile}`}>Download</a
                    >
                  {/if}
                  <button
                    class="copy-button"
                    aria-label={`Copy ${snippet.title} ${snippet.documentOnly ? snippet.documentLanguage.toUpperCase() : 'command'}`}
                    onclick={() =>
                      copy(
                        snippet.id + '-command',
                        snippet.documentOnly ? deployment.documentCode! : command,
                      )}>{copiedId === snippet.id + '-command' ? 'Copied ✓' : 'Copy'}</button
                  >
                </div>
              </div>
              {#if snippet.cliCommand || snippet.serviceOnly}
                <div
                  class="flex flex-wrap gap-2 py-2 px-4 border-b border-white/5"
                  role="group"
                  aria-label={`${snippet.title} deployment method`}
                >
                  <button
                    class="copy-button"
                    aria-pressed={mode === 'cfn'}
                    onclick={() => (commandModes[snippet.id] = 'cfn')}>CloudFormation</button
                  >
                  {#if snippet.serviceOnly}
                    <button
                      class="copy-button"
                      aria-pressed={mode === 'serviceOnly'}
                      onclick={() => (commandModes[snippet.id] = 'serviceOnly')}
                      >CloudFormation service only</button
                    >
                  {/if}
                  {#if snippet.cliCommand}<button
                      class="copy-button"
                      aria-pressed={mode === 'cli'}
                      onclick={() => (commandModes[snippet.id] = 'cli')}>AWS CLI</button
                    >{/if}
                </div>
              {/if}
              {#if mode === 'serviceOnly'}
                <p class="py-2 px-4 text-xs border-b border-white/5 text-slate-400">
                  Skips optional access policies. Required service roles still need IAM permissions.
                </p>
              {/if}
              {#if !snippet.documentOnly && snippet.env.length}
                <div
                  class="flex flex-wrap gap-1.5 py-2 px-4 border-b border-white/5"
                  role="group"
                  aria-label="Environment variables (* required)"
                >
                  {#each isCli && snippet.cliEnv ? snippet.cliEnv : snippet.env as variable}
                    <button
                      class="env-variable"
                      class:required={variable.required}
                      title={environmentHint(variable, platform)}
                      aria-label={`${variable.name}: ${environmentHint(variable, platform)}`}
                      onclick={() =>
                        copy(
                          snippet.id + '-env-' + variable.name,
                          exampleExport(variable, platform),
                        )}
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
                class="overflow-x-auto code-wrap"
                class:command-code={!snippet.documentOnly}
                tabindex="0"
                role="region"
                aria-label={snippet.title}
              >
                {@html snippet.documentOnly ? deployment.documentHtml! : commandHtml}
              </div>
              {#if deployment.cfnTagNote && !isCli}
                <p class="py-2 px-4 text-xs border-t border-white/5 text-slate-400">
                  {deployment.cfnTagNote}
                </p>
              {/if}
              {#if !snippet.documentOnly && deployment.documentCode !== null && deployment.documentHtml !== null}
                <details class="border-t border-white/10">
                  <summary class="py-2.5 px-4 text-sm cursor-pointer text-slate-300"
                    >{snippet.documentTitle}{mode === 'serviceOnly' ? ' service only' : ''}</summary
                  >
                  <div class="flex justify-end px-4 pb-2">
                    <button
                      class="copy-button"
                      aria-label={`Copy ${snippet.title} ${snippet.documentLanguage.toUpperCase()}`}
                      onclick={() => copy(snippet.id + '-document', deployment.documentCode!)}
                      >{copiedId === snippet.id + '-document'
                        ? 'Copied ✓'
                        : `Copy ${snippet.documentLanguage.toUpperCase()}`}</button
                    >
                  </div>
                  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to focus the code to scroll horizontally.) -->
                  <div
                    class="overflow-x-auto code-wrap"
                    tabindex="0"
                    role="region"
                    aria-label={`${snippet.title} ${snippet.documentLanguage.toUpperCase()}`}
                  >
                    {@html deployment.documentHtml}
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
    color: #cbd5e1;
    border-color: rgb(255 255 255 / 25%);
  }
  .env-variable:hover,
  .env-variable:focus-visible {
    color: white;
    outline: 1px solid #94a3b8;
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
    border-color: #94a3b8;
    color: #cbd5e1;
    background: rgb(255 255 255 / 10%);
  }
  .copy-button:hover {
    background: rgb(255 255 255 / 12%);
  }
  .copy-button:focus-visible,
  .code-wrap:focus-visible {
    outline: 2px solid #94a3b8;
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
  .command-code :global(code) {
    white-space: pre;
    overflow-wrap: normal;
  }
</style>
