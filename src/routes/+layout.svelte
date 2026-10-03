<script>
  import '../app.css';
  import Header from './Header.svelte';
  import dino from '$lib/assets/dino.svg';
  import title from '$lib/assets/title.png';

  let { children } = $props();
</script>

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
        <!-- prettier-ignore -->
        <svg xmlns="http://www.w3.org/2000/svg" height="32" width="32" viewBox="0 0 24 24"> <path d="M0 0h24v24H0z" fill="none" /> <defs> <mask id="SVGcZ81hcNk"> <path fill="#fff" d="M9.5 8c0.83 0 1.5 0.45 1.5 1c0 0.55 -0.67 1 -1.5 1c-0.83 0 -1.5 -0.45 -1.5 -1c0 -0.55 0.67 -1 1.5 -1ZM14.5 8c0.83 0 1.5 0.45 1.5 1c0 0.55 -0.67 1 -1.5 1c-0.83 0 -1.5 -0.45 -1.5 -1c0 -0.55 0.67 -1 1.5 -1Z" /> <rect width="8" height="4" x="8" y="7"> <animate attributeName="y" dur="9s" keyTimes="0;0.45;0.46;0.54;0.55;1" repeatCount="indefinite" values="7;7;11;11;7;7" /> </rect> </mask> </defs> <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"> <path stroke-dasharray="32" d="M12 4c1.67 0 2.61 0.4 3 0.5c0.53 -0.43 1.94 -1.5 3.5 -1.5c0.34 1 0.29 2.22 0 3c0.75 1 1 2 1 3.5c0 2.19 -0.48 3.58 -1.5 4.5c-1.02 0.92 -2.11 1.37 -3.5 1.5c0.65 0.54 0.5 1.87 0.5 2.5c0 0.73 0 3 0 3M12 4c-1.67 0 -2.61 0.4 -3 0.5c-0.53 -0.43 -1.94 -1.5 -3.5 -1.5c-0.34 1 -0.29 2.22 0 3c-0.75 1 -1 2 -1 3.5c0 2.19 0.48 3.58 1.5 4.5c1.02 0.92 2.11 1.37 3.5 1.5c-0.65 0.54 -0.5 1.87 -0.5 2.5c0 0.73 0 3 0 3"> <animate fill="freeze" attributeName="stroke-dashoffset" dur="0.6s" values="32;0" /> </path> <path stroke-dasharray="10" stroke-dashoffset="10" d="M9 19c-1.41 0 -2.84 -0.56 -3.69 -1.19c-0.84 -0.62 -1.09 -1.66 -2.31 -2.31"> <animate attributeName="d" dur="3s" keyTimes="0;0.5;1" repeatCount="indefinite" values="M9 19c-1.41 0 -2.84 -0.56 -3.69 -1.19c-0.84 -0.62 -1.09 -1.66 -2.31 -2.31;M9 19c-1.41 0 -3 -0.5 -4 -0.5c-0.53 0 -1 0 -2 -0.5;M9 19c-1.41 0 -2.84 -0.56 -3.69 -1.19c-0.84 -0.62 -1.09 -1.66 -2.31 -2.31" /> <animate fill="freeze" attributeName="stroke-dashoffset" begin="0.7s" dur="0.2s" to="0" /> </path> </g> <path fill="currentColor" d="M0 0h24v24H0z" mask="url(#SVGcZ81hcNk)" /> </svg>
      </a>
      <a
        href="https://www.youtube.com/channel/UCCtqqVSCIEt50F4aNKE7KZQ"
        aria-label="Megakuul's Youtube Channel"
        class="btn btn-square btn-ghost"
      >
        <!-- prettier-ignore -->
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/><g fill="currentColor"><path fill-opacity="0" stroke="currentColor" stroke-dasharray="60" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5c9 0 9 0 9 7c0 7 0 7 -9 7c-9 0 -9 0 -9 -7c0 -7 0 -7 9 -7Z"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.6s" values="60;0"/><animate fill="freeze" attributeName="fill-opacity" begin="0.6s" dur="0.15s" to=".3"/></path><path d="M10 8.5l6 3.5l-6 3.5Z" opacity="0"><set fill="freeze" attributeName="opacity" begin="0.85s" to="1"/><animate fill="freeze" attributeName="d" begin="0.85s" dur="0.2s" values="M12 11l0 1l0 1Z;M10 8.5l6 3.5l-6 3.5Z"/></path></g></svg>
      </a>
      <a
        href="https://www.linkedin.com/in/linus-moser-8897a527b"
        aria-label="Megakuul's LinkedIn"
        class="btn btn-square btn-ghost"
      >
        <!-- prettier-ignore -->
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/><circle cx="4" cy="4" r="2" fill="currentColor" opacity="0"><animate fill="freeze" attributeName="opacity" dur="0.2s" to="1"/></circle><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="4"><g stroke-dasharray="12" stroke-dashoffset="12"><path d="M4 10v10"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.2s" dur="0.2s" to="0"/></path><path d="M10 10v10"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.5s" dur="0.2s" to="0"/></path></g><path stroke-dasharray="24" stroke-dashoffset="24" d="M10 15c0 -2.76 2.24 -5 5 -5c2.76 0 5 2.24 5 5v5"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.7s" dur="0.3s" to="0"/></path></g></svg>
      </a>
    </div>
    <span class="footer-title">Legal</span>
    <a href="/imprint" class="font-bold text-center link link-hover">Imprint</a>
  </div>
</footer>
