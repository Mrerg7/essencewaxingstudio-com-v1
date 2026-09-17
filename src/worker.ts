interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

const CANONICAL_HOST = 'essencewaxingstudio.com';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();

    if (LOCAL_HOSTS.has(host)) {
      return env.ASSETS.fetch(request);
    }

    const isCanonicalHost = host === CANONICAL_HOST;
    const isCanonicalScheme = url.protocol === 'https:';

    if (!isCanonicalHost || !isCanonicalScheme) {
      const location = `https://${CANONICAL_HOST}${url.pathname}${url.search}`;
      return new Response(null, {
        status: 301,
        headers: { Location: location },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
