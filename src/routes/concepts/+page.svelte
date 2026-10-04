<script>
  import list from './concept.list';
  import Intersector from '$lib/components/Intersector.svelte';

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
  <title>Concepts | Megakuul</title>
  <meta
    name="description"
    content="Get some insights to my philosophical thoughts; drifting between random nonsense and useful ideas 🎨"
  />
  <meta
    property="og:description"
    content="Get some insights to my philosophical thoughts; drifting between random nonsense and useful ideas 🎨"
  />
  <link rel="canonical" href="https://megakuul.ch/concepts" />
  <meta property="og:title" content="Concepts - Megakuul" />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="https://megakuul.ch/favicon.png" />
</svelte:head>

<div class="flex flex-col gap-8 items-center my-10">
  <h1 class="text-3xl lg:text-5xl 2xl:text-7xl">Concepts</h1>
  <p class="text-sm text-center lg:text-xl 2xl:text-3xl text-slate-100/40 max-w-10/12">
    Get some insights to my philosophical thoughts; drifting between random nonsense and useful
    ideas 🎨
  </p>
</div>

<div class="flex flex-col gap-4 items-center w-full min-h-dvh">
  {#each searchedList as [key, concept], i (key)}
    {#if i >= currentPage * itemsPerPage && i < (currentPage + 1) * itemsPerPage}
      <Intersector
        class="w-11/12 max-w-[1400px]"
        classOnDefault="translate-x-10 shadow-none opacity-0"
        classOnIntersect="translate-x-0 shadow-xl opacity-100"
        transition="all ease .5s"
      >
        <a
          href="/concepts/{key}"
          class="flex flex-row gap-8 items-center p-4 w-full rounded-2xl transition-all duration-500 apple-glass hover:scale-[1.005]"
        >
          <div class="flex flex-col gap-2">
            <h1
              class="flex flex-row gap-2 items-center text-lg font-bold cursor-pointer lg:text-xl"
            >
              {concept.title}
            </h1>

            <span class="text-slate-200/40">{concept.published}</span>
            <span>{concept.description}</span>
          </div>
          {#if concept.image}
            <img class="ml-auto h-24" src="/images/{concept.image}" alt={concept.image} />
          {/if}
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
