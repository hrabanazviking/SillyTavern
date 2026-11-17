/**
 * Read-only second-brain gateway core (RFST-011).
 *
 * Dependency-free core for a read-only gateway in front of a
 * knowledge-base service. The upstream search runs over one unified
 * corpus (there is no collection parameter), so searching through
 * this gateway searches the entire knowledge base by construction.
 *
 * Allowlist only. The gateway can call exactly three upstream read
 * operations:
 *   GET /api/search?q=&k=&hyde=
 *   GET /api/chunk/{id}
 *   GET /api/overview
 * plus its own local health report. Every other method or path is
 * rejected at the gateway (403 for write verbs / write-shaped
 * paths, 405 for a wrong verb on a read path, 404 otherwise)
 * before any upstream call is made. Paths are normalised and
 * matched exactly, so encoded or traversal tricks cannot reach an
 * upstream write route.
 *
 * The upstream base URL and scoped read token live in server-side
 * configuration only. The token is sent upstream as a bearer
 * credential, is never returned to callers, and is never logged.
 * When no token (or no base URL) is configured the gateway reports
 * itself unconfigured and does not call upstream at all.
 */

export const GATEWAY_DEFAULTS = Object.freeze({
    maxHydrate: 5,
    maxTextCharsPerHit: 2000,
    maxTotalTextChars: 8000,
    defaultK: 12,
    maxK: 100,
});

const CHUNK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

export class GatewayError extends Error {
    constructor(status, code, message) {
        super(message);
        this.name = 'GatewayError';
        this.status = status;
        this.code = code;
    }
}

function normalizePath(rawPath) {
    if (typeof rawPath !== 'string' || rawPath.length === 0) {
        return null;
    }
    let path = rawPath.split('?')[0].split('#')[0];
    // Decode repeatedly so double-encoded tricks collapse before matching.
    for (let i = 0; i < 3; i++) {
        try {
            const decoded = decodeURIComponent(path);
            if (decoded === path) {
                break;
            }
            path = decoded;
        } catch {
            return null;
        }
    }
    if (path.includes('\\') || path.includes('\0')) {
        return null;
    }
    const segments = path.split('/');
    if (segments.some(segment => segment === '..' || segment === '.')) {
        return null;
    }
    // Collapse duplicate slashes, keep a single leading slash, drop a
    // single trailing slash (except for the root itself).
    path = '/' + segments.filter(segment => segment.length > 0).join('/');
    return path;
}

/**
 * Classifies a gateway request without touching upstream.
 * @param {string} method HTTP method
 * @param {string} rawPath Request path (may be encoded)
 * @returns {{action: string, chunkId?: string}|{error: GatewayError}} classification
 */
export function resolveGatewayRoute(method, rawPath) {
    const verb = String(method || '').toUpperCase();
    const path = normalizePath(rawPath);
    if (path === null) {
        return { error: new GatewayError(400, 'bad_path', 'Malformed request path') };
    }
    const isReadPath = path === '/health' || path === '/overview' || path === '/search' || path === '/chunk' || path.startsWith('/chunk/');
    if (WRITE_METHODS.has(verb)) {
        return { error: new GatewayError(403, 'write_rejected', 'Write operations are not allowed through the read-only gateway') };
    }
    if (verb !== 'GET' && verb !== 'HEAD') {
        return { error: new GatewayError(405, 'method_not_allowed', 'Only GET is allowed through the read-only gateway') };
    }
    if (!isReadPath) {
        return { error: new GatewayError(404, 'not_found', 'Unknown gateway route') };
    }
    if (path === '/health') {
        return { action: 'health' };
    }
    if (path === '/overview') {
        return { action: 'overview' };
    }
    if (path === '/search') {
        return { action: 'search' };
    }
    const chunkId = path.slice('/chunk/'.length);
    if (!chunkId || chunkId.includes('/') || !CHUNK_ID_PATTERN.test(chunkId)) {
        return { error: new GatewayError(400, 'bad_chunk_id', 'Invalid chunk id') };
    }
    return { action: 'chunk', chunkId };
}

function clampK(value, defaults) {
    if (value === undefined || value === null || value === '') {
        return defaults.defaultK;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new GatewayError(400, 'bad_k', 'Result count must be a number');
    }
    return Math.min(defaults.maxK, Math.max(1, Math.trunc(parsed)));
}

function parseHyde(value) {
    if (value === undefined || value === null || value === '' || value === '0' || value === 0 || value === false) {
        return 0;
    }
    if (value === '1' || value === 1 || value === true) {
        return 1;
    }
    throw new GatewayError(400, 'bad_hyde', 'HyDE flag must be 0 or 1');
}

/**
 * Creates the gateway.
 * @param {object} options Gateway options
 * @param {string} [options.baseUrl] Upstream base URL (server-side only)
 * @param {string} [options.token] Scoped read token (server-side only)
 * @param {Function} [options.fetchImpl] Fetch implementation (injectable for tests)
 * @param {number} [options.maxHydrate] Max hits hydrated with chunk text
 * @param {number} [options.maxTextCharsPerHit] Per-hit text trim
 * @param {number} [options.maxTotalTextChars] Total hydrated text budget
 * @returns {object} Gateway with health/overview/getChunk/search/handle
 */
export function createSecondBrainGateway(options = {}) {
    const defaults = { ...GATEWAY_DEFAULTS };
    const baseUrl = typeof options.baseUrl === 'string' ? options.baseUrl.replace(/\/+$/, '') : '';
    const token = typeof options.token === 'string' ? options.token : '';
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const maxHydrate = Number.isFinite(options.maxHydrate) ? Math.max(0, Math.trunc(options.maxHydrate)) : defaults.maxHydrate;
    const maxTextCharsPerHit = Number.isFinite(options.maxTextCharsPerHit) ? Math.max(0, Math.trunc(options.maxTextCharsPerHit)) : defaults.maxTextCharsPerHit;
    const maxTotalTextChars = Number.isFinite(options.maxTotalTextChars) ? Math.max(0, Math.trunc(options.maxTotalTextChars)) : defaults.maxTotalTextChars;
    const configured = Boolean(baseUrl && token);

    function requireConfigured() {
        if (!configured) {
            throw new GatewayError(503, 'gateway_unconfigured', 'Read-only gateway is not configured');
        }
        if (typeof fetchImpl !== 'function') {
            throw new GatewayError(503, 'gateway_unconfigured', 'No fetch implementation available');
        }
    }

    async function upstreamGet(path) {
        requireConfigured();
        let response;
        try {
            response = await fetchImpl(baseUrl + path, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
            });
        } catch {
            throw new GatewayError(502, 'upstream_unreachable', 'Knowledge-base service is unreachable');
        }
        if (!response || !response.ok) {
            const status = response && Number.isFinite(response.status) ? response.status : 502;
            throw new GatewayError(502, 'upstream_error', `Knowledge-base service returned ${status}`);
        }
        try {
            return await response.json();
        } catch {
            throw new GatewayError(502, 'upstream_error', 'Knowledge-base service returned invalid JSON');
        }
    }

    async function health() {
        return { ok: true, gateway: 'second-brain-readonly', configured };
    }

    async function overview() {
        return upstreamGet('/api/overview');
    }

    async function getChunk(id) {
        if (typeof id !== 'string' || !CHUNK_ID_PATTERN.test(id)) {
            throw new GatewayError(400, 'bad_chunk_id', 'Invalid chunk id');
        }
        return upstreamGet(`/api/chunk/${encodeURIComponent(id)}`);
    }

    async function search(params = {}) {
        const query = typeof params.q === 'string' ? params.q.trim() : '';
        if (!query) {
            throw new GatewayError(400, 'bad_query', 'A search query is required');
        }
        const k = clampK(params.k, defaults);
        const hyde = parseHyde(params.hyde);
        const upstreamQuery = new URLSearchParams({ q: query, k: String(k), hyde: String(hyde) });
        const raw = await upstreamGet(`/api/search?${upstreamQuery.toString()}`);
        const rawHits = Array.isArray(raw?.hits) ? raw.hits : [];
        const hydrateCount = Math.min(rawHits.length, maxHydrate, k);
        let budget = maxTotalTextChars;
        const hits = [];
        for (let i = 0; i < rawHits.length; i++) {
            const hit = rawHits[i] || {};
            const base = { id: hit.id, doc_id: hit.doc_id, sim: hit.sim, score: hit.score };
            if (i >= hydrateCount || budget <= 0) {
                hits.push(base);
                continue;
            }
            try {
                const chunk = await getChunk(String(hit.id));
                const allowance = Math.min(maxTextCharsPerHit, budget);
                const text = typeof chunk?.text === 'string' ? chunk.text.slice(0, allowance) : '';
                budget -= text.length;
                hits.push({
                    ...base,
                    text,
                    chunk_index: chunk?.chunk_index,
                    doc_title: chunk?.doc_title,
                    source: chunk?.source,
                    content_type: chunk?.content_type,
                });
            } catch {
                // A single failed hydration must not fail the search.
                hits.push(base);
            }
        }
        return {
            query: raw?.query ?? query,
            hyde_used: raw?.hyde_used ?? Boolean(hyde),
            search_mode: raw?.search_mode,
            degraded: raw?.degraded ?? false,
            hits,
        };
    }

    /**
     * Dispatches one gateway request. Never throws for caller errors;
     * upstream failures surface as a catchable 502 result.
     * @param {string} method HTTP method
     * @param {string} rawPath Gateway-relative path
     * @param {object} [query] Parsed query parameters
     * @returns {Promise<{status: number, body: object}>} result
     */
    async function handle(method, rawPath, query = {}) {
        const route = resolveGatewayRoute(method, rawPath);
        if (route.error) {
            return { status: route.error.status, body: { error: route.error.code, message: route.error.message } };
        }
        try {
            if (route.action === 'health') {
                return { status: 200, body: await health() };
            }
            if (route.action === 'overview') {
                return { status: 200, body: await overview() };
            }
            if (route.action === 'chunk') {
                return { status: 200, body: await getChunk(route.chunkId) };
            }
            return { status: 200, body: await search(query) };
        } catch (error) {
            if (error instanceof GatewayError) {
                return { status: error.status, body: { error: error.code, message: error.message } };
            }
            return { status: 502, body: { error: 'upstream_error', message: 'Knowledge-base request failed' } };
        }
    }

    return { configured, health, overview, getChunk, search, handle };
}

export function gatewayFromEnv(env = process.env) {
    return createSecondBrainGateway({
        baseUrl: env.SECOND_BRAIN_URL || '',
        token: env.SECOND_BRAIN_READ_TOKEN || '',
    });
}
