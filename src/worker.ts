/**
 * Edge Worker: canonical URLs, permanent host redirects, real 404s.
 *
 * Resolves GSC "Page with redirect" and related indexing reasons:
 *  - Same-host path aliases (/insights, /insights/index.html, /index.html)
 *    serve at **200** with a Link rel=canonical to the trailing-slash URL —
 *    never a same-host 301/307 that Search Console classifies as
 *    "Page with redirect".
 *  - Unknown guessed paths (/about, /services, …) return a real **404 +
 *    noindex** immediately — never a trailing-slash redirect into a 404
 *    (redirect → 404 chains pollute the same GSC bucket).
 *  - www / http / *.workers.dev one-hop 301 to https://essencewaxingstudio.com.
 *  - Leftover asset 307/302 responses are either soft-served (same-host HTML)
 *    or promoted to absolute 301s (off-host / non-HTML).
 *  - /sitemap.xml is served at 200 (rewrite to sitemap-index.xml).
 *  - HTML 200s carry a self-referencing Link canonical + security headers.
 */
const CANONICAL_HOST = 'essencewaxingstudio.com';
const CANONICAL_ORIGIN = `https://${CANONICAL_HOST}`;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

interface Env {
  ASSETS: {
    fetch(input: Request | string, init?: RequestInit): Promise<Response>;
  };
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Frame-Options': 'SAMEORIGIN',
};

function collapseSlashes(pathname: string): string {
  const collapsed = pathname.replace(/\/{2,}/g, '/');
  return collapsed === '' ? '/' : collapsed;
}

function hasFileExtension(pathname: string): boolean {
  const lastSegment = pathname.split('/').pop() ?? '';
  return lastSegment.includes('.');
}

function isHomeAlias(pathname: string): boolean {
  const p = collapseSlashes(pathname);
  return p === '/' || /^\/index(\.html)?\/?$/i.test(p);
}

function isNotFoundPath(pathname: string): boolean {
  const p = collapseSlashes(pathname);
  return /^\/404(\.html)?\/?$/i.test(p);
}

/** Collapse /index.html (and /index) onto the directory URL. */
function directoryPath(pathname: string): string {
  let p = collapseSlashes(pathname);
  if (/^\/index(\.html)?\/?$/i.test(p)) return '/';
  if (/\/index\.html\/?$/i.test(p)) {
    p = p.replace(/index\.html\/?$/i, '');
    return p === '' ? '/' : p;
  }
  if (/\/index\/?$/i.test(p)) {
    p = p.replace(/index\/?$/i, '');
    return p === '' ? '/' : p;
  }
  return p;
}

/** Canonical path: directory URL + trailing slash for extensionless HTML routes. */
function canonicalPath(pathname: string): string {
  const p = directoryPath(pathname);
  if (p !== '/' && !p.endsWith('/') && !hasFileExtension(p)) {
    return `${p}/`;
  }
  return p;
}

function absoluteUrl(pathname: string, search = ''): string {
  // Build from a literal https origin. Response.redirect() / URL mutation can
  // inherit the inbound http scheme in local workerd and leak http:// Locations.
  return `${CANONICAL_ORIGIN}${pathname}${search}`;
}

function permanentRedirect(location: string): Response {
  const httpsLocation = location.replace(/^http:\/\//i, 'https://');
  return new Response(null, {
    status: 301,
    headers: {
      Location: httpsLocation,
      'Cache-Control': 'public, max-age=3600',
      ...SECURITY_HEADERS,
    },
  });
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 307 || status === 308;
}

function finalizeHtml(
  page: Response,
  url: URL,
  options: { status?: number; canonicalPath?: string; noindex?: boolean } = {},
): Response {
  const headers = new Headers(page.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  // Never leak a Location on a soft-served alias — that would reintroduce
  // "Page with redirect" even with a 200 status.
  headers.delete('Location');

  const status = options.status ?? page.status;
  if (status === 404 || options.noindex) {
    headers.set('X-Robots-Tag', 'noindex, nofollow');
  }

  if (status === 200) {
    const path = options.canonicalPath ?? canonicalPath(url.pathname);
    headers.set('Link', `<${CANONICAL_ORIGIN}${path}>; rel="canonical"`);
  }

  return new Response(page.body, {
    status,
    statusText: status === 404 ? 'Not Found' : page.statusText,
    headers,
  });
}

async function notFoundResponse(env: Env, origin: string, url: URL): Promise<Response> {
  const page = await env.ASSETS.fetch(new URL('/404/', origin).toString());
  return finalizeHtml(page, url, { status: 404, noindex: true });
}

/**
 * Soft-serve a same-host alias at 200 with the preferred canonical path.
 * Returns null when the target does not exist (caller should 404).
 */
async function softServeCanonical(
  env: Env,
  origin: string,
  url: URL,
  target: string,
): Promise<Response | null> {
  let page = await env.ASSETS.fetch(new URL(target, origin).toString());

  // Assets may still 307 under force-trailing-slash — follow once internally.
  if (isRedirectStatus(page.status)) {
    const location = page.headers.get('Location');
    if (!location) return null;
    const dest = new URL(location, origin);
    dest.pathname = canonicalPath(dest.pathname);
    page = await env.ASSETS.fetch(dest.toString());
  }

  if (page.status === 404) return null;
  if (page.status !== 200) return finalizeHtml(page, url, { status: page.status });

  const contentType = page.headers.get('content-type') ?? '';
  if (!contentType.includes('text/html')) return page;

  return finalizeHtml(page, url, { canonicalPath: target });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const host = (request.headers.get('host') ?? url.hostname)
      .split(':')[0]
      .toLowerCase();

    if (LOCAL_HOSTS.has(host)) {
      return env.ASSETS.fetch(request);
    }

    const proto = (
      request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '')
    ).toLowerCase();

    // Real 404 for the 404 document — never a redirect or soft-200.
    if (isNotFoundPath(url.pathname)) {
      return notFoundResponse(env, url.origin, url);
    }

    // Off-host (http / www / workers.dev): one-hop 301 to the apex canonical.
    // www/http aliases will remain under GSC "Page with redirect" by design.
    const offHost = proto === 'http' || host !== CANONICAL_HOST;
    if (offHost) {
      return permanentRedirect(absoluteUrl(canonicalPath(url.pathname), url.search));
    }

    // Homepage aliases: serve at 200 with apex canonical (no same-host redirect).
    if (isHomeAlias(url.pathname)) {
      const page = await softServeCanonical(env, url.origin, url, '/');
      return page ?? notFoundResponse(env, url.origin, url);
    }

    // Crawler convenience URL — 200 rewrite, no redirect chain.
    if (url.pathname === '/sitemap.xml' || url.pathname === '/sitemap.xml/') {
      return env.ASSETS.fetch(new URL('/sitemap-index.xml', url.origin).toString());
    }

    const target = canonicalPath(url.pathname);

    // Same-host path aliases (missing trailing slash, /path/index.html):
    // soft-serve the canonical document at 200. If it does not exist, 404
    // immediately — do not 301 into a missing page.
    if (url.pathname !== target) {
      const page = await softServeCanonical(env, url.origin, url, target);
      return page ?? notFoundResponse(env, url.origin, url);
    }

    const assetResponse = await env.ASSETS.fetch(request);

    // Soft-serve leftover same-host asset redirects instead of emitting 301s.
    if (isRedirectStatus(assetResponse.status)) {
      const location = assetResponse.headers.get('Location');
      if (location) {
        const dest = new URL(location, CANONICAL_ORIGIN);
        const destPath = canonicalPath(dest.pathname);
        const page = await softServeCanonical(env, url.origin, url, destPath);
        if (page) return page;
        return notFoundResponse(env, url.origin, url);
      }
    }

    const contentType = assetResponse.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) {
      return assetResponse;
    }

    if (assetResponse.status === 404) {
      return finalizeHtml(assetResponse, url, { status: 404, noindex: true });
    }

    if (assetResponse.status === 200) {
      return finalizeHtml(assetResponse, url, { canonicalPath: target });
    }

    return finalizeHtml(assetResponse, url);
  },
};
