<script>
  import list from './concept.list';
  import { page } from '$app/state';

  let { children } = $props();

  let key = $derived(page.route.id?.slice(page.route.id.lastIndexOf('/') + 1) || '');

  let title = $derived(list[key].title);
  let description = $derived(list[key].description);
  let published = $derived(list[key].published);
  let image = $derived(list[key].image);
  const publishedIso = $derived.by(() => {
    const [day, month, year] = published.split('.');
    return new Date(Number(year), Number(month) - 1, Number(day)).toISOString();
  });
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <meta property="og:description" content={description} />
  <link rel="canonical" href="https://megakuul.ch/concepts/{key}" />
  <meta property="og:title" content={title} />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="https://megakuul.ch/favicon.png" />
  <meta property="article:published_time" content={publishedIso} />
</svelte:head>

<div class="sticky top-0 z-30 border-b border-white/5 bg-stone-950/70 backdrop-blur-md">
  <div class="mx-auto flex max-w-[96rem] flex-row items-center gap-3 px-4 py-3">
    <a
      href="/concepts"
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
  {#if image}
    <img class="h-60" src="/images/{image}" alt={image} />
  {/if}
  <h1 class="flex flex-row gap-4 items-center mb-5 text-2xl font-bold text-center sm:text-5xl">
    {title}
  </h1>
  <p class="max-w-5xl text-lg text-center sm:text-2xl">{description}</p>
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
