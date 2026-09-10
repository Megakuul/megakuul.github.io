import { redirect } from '@sveltejs/kit';
export const prerender = true;
export const trailingSlash = 'always';
export const load = () => redirect(308, '/worldskills/powertools/');
