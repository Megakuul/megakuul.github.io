Linosteffen.ch is the website for the photographer Lino Steffen.

## Purpose

Lino Steffen had a simple **Webflow.io** website befor this, so I thought that I'm going to build a Website for him.

The goal was to host the website for free.

## Implementation

Both of us knew that you can host static content on Netlify for free, so thats why I looked for a solution that can build static content.

Because HTML, CSS and Javascript sucks (what I experienced in my previous project **Statistic Calculator**), in this project I looked for a UI Framework.

As the UI will be client side rendered (because we want to host it for free on **Netlify**), I needed something that goes fast. I decided to try out **Svelte**, as it is very fast compared to frameworks like **React**, and I also like the way how **Svelte** handles certain things.

For the project I've implemented my own page router that operates with parameters like **/?Page**. This allowed me to share components like the footer and the navbar over multiple pages.

## Lessons Learned

In this project I learned fundamental concepts of UI Frameworks, I got basic knowledge about how **Svelte** works and could also improve my overall frontend development skills.

After building projects with metaframeworks like **SvelteKit**, I would 
definitely go with one of them, especially for **SEO** it is significant to use server-side rendering.
A platform like **Vercel** now also offers a free plan that can run server-side rendered frameworks like **SvelteKit** or **Next.js**.
