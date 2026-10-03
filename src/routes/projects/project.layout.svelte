<script>
  import list from './project.list';
  import { page } from '$app/state';
  import TechIcon from '$lib/components/TechIcon.svelte';

  let { children } = $props();

  let key = $derived(page.route.id?.slice(page.route.id.lastIndexOf('/') + 1) || '');

  let title = $derived(list[key].title);
  let description = $derived(list[key].description);
  let published = $derived(list[key].published);
  let link = $derived(list[key].link);
  let image = $derived(list[key].image);
  let techs = $derived(list[key].techs);
  const publishedIso = $derived.by(() => {
    const [day, month, year] = published.split('.');
    return new Date(Number(year), Number(month) - 1, Number(day)).toISOString();
  });
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <meta property="og:description" content={description} />
  <link rel="canonical" href="https://megakuul.ch/projects/{key}" />
  <meta property="og:title" content={title} />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="https://megakuul.ch/favicon.png" />
  <meta property="article:published_time" content={publishedIso} />
</svelte:head>

<div class="sticky top-0 z-30 border-b border-white/5 bg-stone-950/70 backdrop-blur-md">
  <div class="mx-auto flex max-w-[96rem] flex-row items-center gap-3 px-4 py-3">
    <a
      href="/projects"
      class="flex flex-row gap-2 group rounded-sm hover:bg-slate-50/5 p-2 items-center text-sm text-slate-200/40 hover:text-slate-200/80"
    >
      <!-- prettier-ignore -->
      <svg class="transition-all opacity-0 translate-x-16 translate-y-14 rotate-45 group-hover:opacity-100 group-hover:rotate-0 group-hover:translate-x-0 group-hover:translate-y-0" xmlns="http://www.w3.org/2000/svg" width="1.5rem" height="1.5rem" viewBox="0 0 24 24"> <path d="M0 0h24v24H0z" fill="none" /> <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"> <path stroke-dasharray="16" d="M19 12h-13.5"> <animate fill="freeze" attributeName="stroke-dashoffset" dur="0.3s" values="16;0" /> </path> <path stroke-dasharray="10" stroke-dashoffset="10" d="M5 12l5 5M5 12l5 -5"> <animate fill="freeze" attributeName="stroke-dashoffset" begin="0.3s" dur="0.2s" to="0" /> </path> </g> </svg>
      <span class="truncate text-lg font-bold">{title}</span>
    </a>
    <div class="flex-1"></div>
  </div>
</div>

<div class="flex flex-col gap-4 items-center mt-20 w-full sm:mt-40 min-h-dvh">
  <h1 class="flex flex-row gap-4 items-center mb-5 text-2xl font-bold text-center sm:text-5xl">
    {#if image}
      <img class="h-16" src="/images/{image}" alt={image} />
    {/if}
    <span>{title}</span>
    <a
      href={link}
      class="p-2 text-xl rounded-xl transition-all text-slate-200/80 hover:bg-slate-400/20"
    >
      <!-- prettier-ignore -->
      <svg class="w-8 h-8" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-dasharray="28" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 6l2 -2c1 -1 3 -1 4 0l1 1c1 1 1 3 0 4l-5 5c-1 1 -3 1 -4 0M11 18l-2 2c-1 1 -3 1 -4 0l-1 -1c-1 -1 -1 -3 0 -4l5 -5c1 -1 3 -1 4 0"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.6s" values="28;0"/></path></svg>
    </a>
  </h1>
  <p class="max-w-5xl text-lg text-center sm:text-2xl">{description}</p>
  <div class="flex flex-wrap gap-2 justify-center items-center mt-1 max-w-5xl">
    {#each techs as tech}
      <div class="flex flex-row gap-2 py-2 px-3 rounded-xl select-none apple-glass">
        <TechIcon {tech} class="w-6 h-6 rounded-sm" />
        <span>{tech}</span>
      </div>
    {/each}
  </div>
  <p class="text-xl text-slate-200/40">~{published}~</p>

  <article class="p-2 max-w-5xl sm:p-10 prose-sm sm:prose lg:prose-lg xl:prose-xl">
    {@render children()}
  </article>
</div>

<style>
  :global(article) :global(pre) {
    width: 90vw;
    max-width: 100%;
    overflow-x: scroll;

    box-shadow:
      rgba(255, 255, 255, 0.05) 0px 6px 24px 0px,
      rgba(255, 255, 255, 0.08) 0px 0px 0px 1px;
    background-color: rgba(255, 255, 255, 0.01) !important;
    backdrop-filter: blur(2px);
  }

  :global(article) :global(table) {
    width: 100%;
    table-layout: auto;
    margin-top: 2em;
    margin-bottom: 2em;
    font-size: 0.875em;
    line-height: 1.7142857;
  }
</style>
