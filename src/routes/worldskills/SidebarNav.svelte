<script>
  /**
   * Sticky left navigation shared by the worldskills pages.
   *
   * @typedef {{ id: string; title: string; level: number }} NavItem
   * items: flat, leveled list. level 0 renders as a section link, level > 0 is indented.
   * menuOpen: bindable, drives the mobile flyout (toggled from the page top bar).
   */
  let { items = [], menuOpen = $bindable(false) } = $props();

  let activeId = $state('');

  /** @param {string} id */
  function jump(id) {
    menuOpen = false;
    document.getElementById(id)?.scrollIntoView({ behavior: 'instant', block: 'start' });
  }

  // Re-arm the observer whenever the item list changes (markdown scans headings after mount).
  $effect(() => {
    const els = items
      .map(i => document.getElementById(i.id))
      .filter(/** @returns {el is HTMLElement} */ el => el !== null);
    if (els.length === 0) return;
    const observer = new IntersectionObserver(
      entries => {
        for (const e of entries) if (e.isIntersecting) activeId = e.target.id;
      },
      { rootMargin: '-15% 0px -75% 0px', threshold: 0 },
    );
    els.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  });
</script>

{#snippet list()}
  {#each items as item (item.id)}
    <button
      onclick={() => jump(item.id)}
      class="nav-link block w-full cursor-pointer border-l-2 py-1 text-left transition-all"
      class:nav-active={activeId === item.id}
      class:pl-3={item.level === 0}
      class:pl-6={item.level > 0}
      class:font-semibold={item.level === 0}
      class:text-sm={item.level > 0}
    >
      {item.title}
    </button>
  {/each}
{/snippet}

<aside
  class="no-scrollbar sticky top-20 hidden max-h-[calc(100vh-6rem)] w-60 shrink-0 self-start overflow-y-auto py-8 pr-3 lg:block"
>
  <nav class="flex flex-col gap-0.5">
    {@render list()}
  </nav>
</aside>

{#if menuOpen}
  <div class="fixed inset-0 z-40 flex lg:hidden">
    <button
      class="absolute inset-0 bg-black/70 backdrop-blur-sm"
      aria-label="Close menu"
      onclick={() => (menuOpen = false)}
    ></button>
    <nav
      class="relative z-10 flex h-full w-72 max-w-[82vw] flex-col gap-0.5 overflow-y-auto border-r border-white/10 bg-[rgb(20,19,19)] p-5 pt-20"
    >
      {@render list()}
    </nav>
  </div>
{/if}

<style>
  .no-scrollbar {
    scrollbar-width: none;
  }
  .no-scrollbar::-webkit-scrollbar {
    display: none;
  }

  .nav-link {
    color: rgba(226, 232, 240, 0.5);
    border-color: transparent;
  }
  .nav-link:hover {
    color: rgba(241, 245, 249, 0.95);
  }
  .nav-active {
    color: rgb(241, 245, 249);
    border-color: var(--sidebar-active-border, rgb(192, 132, 252));
  }
</style>
