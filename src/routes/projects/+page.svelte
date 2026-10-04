<script>
  import list from './project.list';
  import Intersector from '$lib/components/Intersector.svelte';
  import TechIcon from '$lib/components/TechIcon.svelte';

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
  let searchtechs = $state({});

  let searchedList = $derived.by(() => {
    let filtered = Object.entries(list);
    if (Object.keys(searchtechs).length > 0) {
      filtered = filtered.filter(([_, value]) => {
        for (const tech of value.techs) {
          if (searchtechs[tech]) return true;
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
    return filtered;
  });
</script>

<svelte:head>
  <title>Projects | Megakuul</title>
  <meta
    name="description"
    content="Get an impression about some software projects I work on in my spare time 🏗️"
  />
  <meta
    property="og:description"
    content="Get an impression about some software projects I work on in my spare time 🏗️"
  />
  <link rel="canonical" href="https://megakuul.ch/projects" />
  <meta property="og:title" content="Projects - Megakuul" />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="https://megakuul.ch/favicon.png" />
</svelte:head>

<div class="flex flex-col gap-8 items-center my-10">
  <h1 class="text-3xl lg:text-5xl 2xl:text-7xl">Projects</h1>
  <p class="text-sm text-center lg:text-xl 2xl:text-3xl text-slate-100/40 max-w-10/12">
    Get an impression about some software projects I work on in my spare time 🏗️
  </p>
</div>

<div class="flex flex-col gap-4 items-center my-10">
  <input
    bind:value={search}
    placeholder="Search..."
    class="p-3 w-11/12 text-lg rounded-2xl outline-none sm:p-4 sm:text-xl apple-glass max-w-[1400px]"
  />
  <div class="flex flex-wrap gap-2 justify-start items-start w-11/12 max-w-[1400px] min-h-12">
    {#each Object.entries(searchtechs) as [tech, active] (tech)}
      {#if active}
        <button
          onclick={e => {
            e.stopPropagation();
            if (searchtechs[tech]) {
              delete searchtechs[tech];
              searchtechs = searchtechs;
            } else searchtechs[tech] = true;
            changePage(0);
          }}
          class="flex flex-row gap-2 py-2 px-3 rounded-xl transition-all cursor-pointer hover:scale-105 apple-glass"
        >
          <TechIcon {tech} class="w-6 h-6 rounded-sm" />
          <span>{tech}</span>
        </button>
      {/if}
    {/each}
  </div>
</div>

<div class="flex flex-col gap-4 items-center w-full min-h-dvh">
  {#each searchedList as [key, project], i (key)}
    {#if i >= currentPage * itemsPerPage && i < (currentPage + 1) * itemsPerPage}
      <Intersector
        class="w-11/12 max-w-[1400px]"
        classOnDefault="translate-x-10 shadow-none opacity-0"
        classOnIntersect="translate-x-0 shadow-xl opacity-100"
        transition="all ease .5s"
      >
        <a
          href="/projects/{key}"
          class="flex flex-col gap-2 p-4 w-full rounded-2xl transition-all duration-500 apple-glass hover:scale-[1.005]"
        >
          <h1 class="flex flex-row gap-2 items-center text-lg font-bold cursor-pointer lg:text-xl">
            {#if project.image}
              <img class="h-8" src="/images/{project.image}" alt={project.image} />
            {/if}
            <span>{project.title}</span>
          </h1>

          <p class="flex flex-wrap gap-1 justify-start text-sm sm:text-lg">
            <span class="text-slate-200/40">{project.published}</span>
            <span>| {project.description}</span>
          </p>

          <div class="flex flex-wrap gap-2 items-start mt-1">
            {#each project.techs as tech}
              <button
                onclick={e => {
                  e.preventDefault();
                  if (searchtechs[tech]) {
                    delete searchtechs[tech];
                    searchtechs = searchtechs;
                  } else searchtechs[tech] = true;
                  changePage(0);
                }}
                class="flex flex-row gap-2 py-2 px-3 rounded-xl transition-all cursor-pointer hover:scale-105 apple-glass"
              >
                <TechIcon {tech} class="w-6 h-6 rounded-sm" />
                <span>{tech}</span>
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
