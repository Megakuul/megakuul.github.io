<script>
  import '../app.css';
  import Header from './Header.svelte';
  import Icon from '@iconify/svelte';
  import dino from '$lib/assets/dino.svg';
  import title from '$lib/assets/title.png';

  let { children } = $props();
  let dPresses = 0;

  /** @param {KeyboardEvent} event */
  function togglePerformanceMode(event) {
    if (event.repeat) return;
    const typing =
      event.target instanceof HTMLElement &&
      (event.target.isContentEditable || event.target.matches('input, textarea, select'));
    dPresses =
      !typing &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      event.key.toLowerCase() === 'd'
        ? dPresses + 1
        : 0;
    if (dPresses === 3) {
      document.documentElement.classList.toggle('performance-mode');
      dPresses = 0;
    }
  }
</script>

<svelte:window onkeydown={togglePerformanceMode} />

<Header />

{@render children()}

<footer class="p-10 footer apple-glass text-neutral-content sm:footer-horizontal">
  <div>
    <img alt="Dinosaur" src={dino} width="120" class="invert" />
    <img alt="Megakuul title icon" src={title} width="120" class="invert" />
    <p>Designing software is Art</p>
  </div>
  <div>
    <span class="footer-title">Socials</span>
    <div class="grid grid-flow-col gap-4">
      <a
        href="https://github.com/Megakuul"
        aria-label="Megakuul's Github Account"
        class="btn btn-square btn-ghost"
      >
        <Icon icon="line-md:github-loop" height="32" width="32"></Icon>
      </a>
      <a
        href="https://www.youtube.com/channel/UCCtqqVSCIEt50F4aNKE7KZQ"
        aria-label="Megakuul's Youtube Channel"
        class="btn btn-square btn-ghost"
      >
        <Icon icon="mdi:youtube" height="32" width="32"></Icon>
      </a>
      <a
        href="https://www.linkedin.com/in/linus-moser-8897a527b"
        aria-label="Megakuul's LinkedIn"
        class="btn btn-square btn-ghost"
      >
        <Icon icon="mdi:linkedin" height="32" width="32"></Icon>
      </a>
    </div>
    <span class="footer-title">Legal</span>
    <a href="/imprint" class="font-bold text-center link link-hover">Imprint</a>
  </div>
</footer>

<style>
  :global(html.performance-mode::before) {
    display: none;
    animation: none;
  }
</style>
