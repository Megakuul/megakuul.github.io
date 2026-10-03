<script>
  import list from './worldskills.list';
  import Intersector from '$lib/components/Intersector.svelte';
  import ServiceIcon from '$lib/components/ServiceIcon.svelte';

  const itemsPerPage = 7;
  let currentPage = $state(0);

  /** @param {number} newPage */
  function changePage(newPage) {
    currentPage = newPage;
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }

  let search = $state('');
  /** @type {Object.<string, boolean>} */
  let searchServices = $state({});

  let searchedList = $derived.by(() => {
    let filtered = Object.entries(list);
    if (Object.keys(searchServices).length > 0) {
      filtered = filtered.filter(([_, value]) => {
        for (const service of value.services) {
          if (searchServices[service]) return true;
        }
        return false;
      });
    }
    if (search.length > 0) {
      const searchStr = search.toLowerCase();
      filtered = filtered.filter(([key, value]) => {
        if (key.toLowerCase().includes(searchStr)) {
          return true;
        } else if (JSON.stringify(value).toLowerCase().includes(searchStr)) {
          return true;
        }
        return false;
      });
    }
    return filtered.reverse();
  });
</script>

<svelte:head>
  <title>Worldskills | Megakuul</title>
  <meta
    name="description"
    content="Master more AWS services than you will ever need (preparation for the Worldskills 2026) 🇨🇭"
  />
  <meta
    property="og:description"
    content="Master more AWS services than you will ever need (preparation for the Worldskills 2026) 🇨🇭"
  />
  <link rel="canonical" href="https://megakuul.ch/worldskills" />
  <meta property="og:title" content="Worldskills - Megakuul" />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="https://megakuul.ch/favicon.png" />
</svelte:head>

<div class="flex flex-col gap-8 items-center my-10">
  <h1 class="flex flex-row gap-2 items-center text-3xl lg:text-5xl 2xl:text-7xl">
    Worldskills
    <a class="p-2 transition-all hover:bg-slate-300/5 rounded-xl" href="/worldskills/feed.xml">
      <!-- prettier-ignore -->
      <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 lg:w-10 lg:h-10" viewBox="0 0 24 24"><circle cx="5" cy="19" r="2" fill="currentColor"><animate fill="freeze" attributeName="r" dur="0.2s" values="0;2"/></circle><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path stroke-dasharray="18" stroke-dashoffset="18" d="M4 11c2.39 0 4.68 0.95 6.36 2.64c1.69 1.68 2.64 3.97 2.64 6.36"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.2s" dur="0.3s" to="0"/></path><path stroke-dasharray="28" stroke-dashoffset="28" d="M4 4c4.24 0 8.31 1.69 11.31 4.69c3 3 4.69 7.07 4.69 11.31"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.6s" dur="0.4s" to="0"/></path></g></svg>
    </a>
  </h1>
  <p class="text-sm text-center lg:text-xl 2xl:text-3xl text-slate-100/40 max-w-10/12">
    Master more AWS services than you will ever need (preparation for the
    <a
      class="underline"
      href="https://www.ict-berufsbildung.ch/fuenf-schweizer-informatik-talente-an-den-worldskills-2026"
    >
      Worldskills 2026
    </a>
    ) 🇨🇭
  </p>

  <div class="flex flex-row gap-6 w-11/12 max-w-[1400px]">
    <div class="flex flex-col items-center gap-1 flex-1">
      <span class="w-32 text-center rounded-sm shadow-sm bg-stone-600/30 text-stone-50/40">
        🖋️ cheatsheet
      </span>
      <span class="text-slate-100/40 text-center">checklists, snippets and commands</span>
    </div>
    <div class="flex flex-col items-center gap-1 flex-1">
      <span class="w-24 text-center rounded-sm shadow-sm bg-stone-600/30 text-stone-50/40">
        📢 yappin
      </span>
      <span class="text-slate-100/40 text-center">full scale yappin session about services</span>
    </div>
    <div class="flex flex-col items-center gap-1 flex-1">
      <span class="w-18 text-center rounded-sm shadow-sm bg-stone-600/30 text-stone-50/40">
        🤏 mini
      </span>
      <span class="text-slate-100/40 text-center">tiny personal service notes</span>
    </div>
  </div>
</div>

<div class="flex flex-col gap-4 items-center my-10">
  <input
    bind:value={search}
    placeholder="Search..."
    class="p-3 w-11/12 text-lg rounded-2xl outline-none sm:p-4 sm:text-xl apple-glass max-w-[1400px]"
  />
  <div class="flex flex-wrap gap-2 justify-start items-start w-11/12 max-w-[1400px] min-h-12">
    {#each Object.entries(searchServices) as [service, active] (service)}
      {#if active}
        <button
          onclick={e => {
            e.stopPropagation();
            if (searchServices[service]) {
              delete searchServices[service];
              searchServices = searchServices;
            } else searchServices[service] = true;
            changePage(0);
          }}
          class="flex flex-row gap-2 py-2 px-3 rounded-xl transition-all cursor-pointer hover:scale-105 apple-glass"
        >
          <ServiceIcon {service} class="w-6 h-6 rounded-sm" />
          <span>{service}</span>
        </button>
      {/if}
    {/each}
  </div>
</div>

<div class="flex flex-col gap-4 items-center w-full min-h-dvh">
  {#each searchedList as [key, project], i (key)}
    {#if i >= currentPage * itemsPerPage && i < (currentPage + 1) * itemsPerPage}
      <Intersector
        class="w-11/12 max-w-350"
        classOnDefault="translate-x-10 shadow-none opacity-0"
        classOnIntersect="translate-x-0 shadow-xl opacity-100"
        transition="all ease .5s"
      >
        <a
          href="/worldskills/{key}"
          class="flex flex-col gap-2 p-4 w-full rounded-2xl transition-all apple-glass"
        >
          <div class="flex flex-row items-center justify-between">
            <h1 class="text-lg font-bold cursor-pointer lg:text-xl hover:underline">
              {project.title}
            </h1>
            {#if project.type === 'mini'}
              <div class="w-18 text-center rounded-sm shadow-sm bg-stone-600/30 text-stone-50/40">
                🤏 {project.type}
              </div>
            {:else if project.type === 'cheatsheet'}
              <div class="w-32 text-center rounded-sm shadow-sm bg-stone-600/30 text-stone-50/40">
                🖋️ {project.type}
              </div>
            {:else if project.type === 'yappin'}
              <div class="w-24 text-center rounded-sm shadow-sm bg-stone-600/30 text-stone-50/40">
                📢 {project.type}
              </div>
            {/if}
          </div>

          <p class="flex flex-wrap gap-1 justify-start text-sm sm:text-lg">
            <span class="text-slate-200/40">{project.published}</span>
            <span>| {project.description}</span>
          </p>

          <div class="flex flex-wrap gap-2 items-start mt-1">
            {#each project.services as service}
              <button
                onclick={e => {
                  e.preventDefault();
                  if (searchServices[service]) {
                    delete searchServices[service];
                    searchServices = searchServices;
                  } else searchServices[service] = true;
                  changePage(0);
                }}
                class="flex flex-row gap-2 py-2 px-3 rounded-xl transition-all cursor-pointer hover:scale-105 apple-glass"
              >
                <ServiceIcon {service} class="w-6 h-6 rounded-sm" />
                <span>{service}</span>
              </button>
            {/each}
          </div>
        </a>
      </Intersector>
    {/if}
  {/each}
  <div class="my-12 mt-auto join">
    {#if searchedList}
      {#each Array(Math.ceil(searchedList.length / itemsPerPage)) as _, index}
        <button
          class="join-item btn apple-glass active"
          class:btn-active={currentPage === index}
          class:dense-apple-glass={currentPage === index}
          onclick={() => changePage(index)}
        >
          {(index + 1).toString()}
        </button>
      {/each}
    {/if}
  </div>
</div>
