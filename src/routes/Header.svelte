<script>
  import { fade } from 'svelte/transition';

  let initial = $state(true);
  let open = $state(false);
</script>

<button
  class="flex fixed right-5 bottom-5 z-50 justify-center items-center rounded-2xl cursor-pointer apple-glass"
  onclick={() => ((initial = false), (open = !open))}
>
  {#if initial}
    <!-- prettier-ignore -->
    <svg xmlns="http://www.w3.org/2000/svg" class="w-16 h-16 sm:w-20 sm:h-20"  viewBox="0 0 24 24"> <path d="M0 0h24v24H0z" fill="none" /> <g fill="none" stroke="currentColor" stroke-dasharray="16" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"> <path d="M5 5h14"> <animate fill="freeze" attributeName="stroke-dashoffset" dur="0.3s" values="16;0" /> </path> <path stroke-dashoffset="16" d="M5 12h14"> <animate fill="freeze" attributeName="stroke-dashoffset" begin="0.3s" dur="0.3s" to="0" /> </path> <path stroke-dashoffset="16" d="M5 19h14"> <animate fill="freeze" attributeName="stroke-dashoffset" begin="0.6s" dur="0.3s" to="0" /> </path> </g> </svg>
  {:else if open}
    <!-- prettier-ignore -->
    <svg xmlns="http://www.w3.org/2000/svg" class="w-16 h-16 sm:w-20 sm:h-20" viewBox="0 0 24 24"> <path d="M0 0h24v24H0z" fill="none" /> <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5l7 7l7 -7M12 12h0M5 19l7 -7l7 7"> <animate fill="freeze" attributeName="d" dur="0.4s" values="M5 5l7 0l7 0M5 12h14M5 19l7 0l7 0;M5 5l7 7l7 -7M12 12h0M5 19l7 -7l7 7" /> </path> </svg>
  {:else}
    <!-- prettier-ignore -->
    <svg xmlns="http://www.w3.org/2000/svg" class="w-16 h-16 sm:w-20 sm:h-20" viewBox="0 0 24 24"> <path d="M0 0h24v24H0z" fill="none" /> <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5l7 0l7 0M5 12h14M5 19l7 0l7 0"> <animate fill="freeze" attributeName="d" dur="0.4s" values="M5 5l7 7l7 -7M12 12h0M5 19l7 -7l7 7;M5 5l7 0l7 0M5 12h14M5 19l7 0l7 0" /> </path> </svg>
  {/if}
</button>

{#if open}
  <nav
    transition:fade
    class="flex fixed top-0 left-0 z-40 justify-center items-center w-full h-full dense-apple-glass"
  >
    <ul class="flex flex-col gap-2 text-3xl font-bold sm:text-6xl 2xl:text-8xl">
      <li>
        <a class="hover:underline" href="/" onclick={() => (open = false)}>Home</a>
      </li>
      <li>
        <a class="hover:underline" href="/projects" onclick={() => (open = false)}> Projects </a>
      </li>
      <li>
        <a class="hover:underline" href="/concepts" onclick={() => (open = false)}> Concepts </a>
      </li>
      <li>
        <a class="hover:underline" href="/worldskills" onclick={() => (open = false)}>
          Worldskills
        </a>
      </li>
      <li>
        <a class="hover:underline" href="/about" onclick={() => (open = false)}>About</a>
      </li>
    </ul>
  </nav>
{/if}
