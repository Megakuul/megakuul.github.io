Megakuul.ch is my personal website, where I show off some of my projects I've done in the past.  

## Purpose

The Megakuul.ch is meant as a simple portfolio website, where I also wanted to write some thoughts about my projects.


## Implementation

As I already knew **Svelte** and **SvelteKit** from previous projects, I wanted to stick with that, as I just feel way more comfortable than using abstractions like **JSX**.

To make CSS suck a little bit less, I brought in **Tailwind CSS** along with **daisyUI** that appends some predefined components to **Tailwind** (a bit like **Bootstrap**).

For hosting, I chose **Vercel** because I wanted the website to be stable online and not depend on my own crappy server.

To write these pages here (the project pages) I also used a markdown renderer (**mdsvex**) so that I can write the content in **.md** instead of using raw **HTML**.

I also set the "prerender" option on all pages, what tells **SvelteKit** to render the pages on build. I don't need dynamic data on the page anyway.

## Lessons Learned

By using **Tailwind CSS**, I actually found a really convenient way to handle **CSS**, it is very pragmatic and practical and makes it actually fun to write **CSS**. 

I also like **daisyUI** because it adds up very well to **Tailwind** and just looks so much better than **Bootstrap**.

If I were about to create a similar static content page (Blog) in the future, I would likely use a **static content framework** designed specifically for this purpose, such as **Hugo**.
This would remove some complexity and I also would have a markdown renderer out of the box.
