import { error } from '@sveltejs/kit';
import { downloads } from '$lib/server/codepipeline/downloads';
import type { EntryGenerator, RequestHandler } from './$types';

export const prerender = true;
export const entries: EntryGenerator = () => downloads().map(file => ({ name: file.name }));
export const GET: RequestHandler = ({ params }) => {
  const file = downloads().find(file => file.name === params.name);
  if (!file) error(404, 'File not found');
  return new Response(file.body, {
    headers: {
      'Content-Type': file.type,
      'Content-Disposition': `attachment; filename="${file.name}"`,
    },
  });
};
