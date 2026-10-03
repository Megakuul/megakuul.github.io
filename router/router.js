// cloudfront cdn router that ensures static sveltekit pages (e.g. /bananza) are routed to the exact s3 key (/bananza/index.html).
// only required if deployed on cloudfront.
async function handler(event) {
  const request = event.request;
  // don't manipulate any assets
  if (request.uri.startsWith('/_app/') || /\.[^\/.]+$/.test(request.uri)) {
    return request;
  }
  if (request.uri.endsWith('/')) {
    request.uri += 'index.html';
  } else {
    request.uri += '/index.html';
  }
  return request;
}
