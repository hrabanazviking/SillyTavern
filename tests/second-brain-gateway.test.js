/**
 * RFST-011 - Read-only all-collections gateway.
 *
 * Roadmap acceptance: "Search entire KB; write attempts rejected."
 *
 * The gateway core (src/second-brain/gateway-core.js) is a
 * dependency-free module and IS imported and exercised for real
 * here (RFST-007 pattern) - nothing is replicated. In front of it
 * sits a node http MOCK upstream on an ephemeral 127.0.0.1 port
 * implementing the gateway's own upstream contract (the generic
 * read-route shapes the gateway consumes):
 *   GET /api/overview -> counts
 *   GET /api/search?q=&k=1..100&hyde=0|1 ->
 *     { query, hyde_used, hits: [{ id, doc_id, sim, score }],
 *       search_mode, degraded }
 *   GET /api/chunk/{id} ->
 *     { id, text, chunk_index, doc_id, doc_title, source,
 *       content_type }
 * The mock records EVERY request it receives, so the suite can
 * prove that rejected write attempts never reach upstream. Fake
 * documents only; no real data, hosts, or credentials anywhere.
 *
 * The upstream also has write-shaped routes in reality (ingest,
 * build, admin, refresh); the gateway exposes none of them, and
 * every write verb/path below is asserted rejected at the gateway
 * with zero upstream traffic.
 *
 * Live evidence status: an authenticated live search against the
 * real service is GATED on a read-scoped key being issued to this
 * campaign (see campaign/PROGRESS.md, RFST-010/011). No key was
 * borrowed or read; this suite proves the gateway against the
 * mock instead, exactly as RFST-006/010 did.
 */
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import http from 'node:http';
import fs from 'node:fs';

import { createSecondBrainGateway, resolveGatewayRoute, GatewayError } from '../src/second-brain/gateway-core.js';

const FAKE_TOKEN = 'fake-scoped-read-token-for-tests-only';
const FAKE_CHUNKS = {
    c1: { id: 'c1', text: 'Alpha fake knowledge about rune stones.', chunk_index: 0, doc_id: 'd1', doc_title: 'Fake Runes', source: 'fake-source-a', content_type: 'text' },
    c2: { id: 'c2', text: 'Beta fake knowledge about longships.', chunk_index: 1, doc_id: 'd2', doc_title: 'Fake Ships', source: 'fake-source-b', content_type: 'text' },
    c3: { id: 'c3', text: 'Gamma fake knowledge about mead halls.', chunk_index: 2, doc_id: 'd3', doc_title: 'Fake Halls', source: 'fake-source-c', content_type: 'text' },
};

let upstreamMode = 'ok';
let upstreamRequests = [];
let lastAuthHeader = null;

const upstream = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    upstreamRequests.push({ method: req.method, path: url.pathname });
    lastAuthHeader = req.headers.authorization || null;
    if (upstreamMode === 'fail500') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'fake upstream failure' }));
        return;
    }
    if (req.method === 'GET' && url.pathname === '/api/overview') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ documents: 3, chunks: 3 }));
        return;
    }
    if (req.method === 'GET' && url.pathname === '/api/search') {
        const q = url.searchParams.get('q') || '';
        const k = Number(url.searchParams.get('k') || '12');
        const hits = Object.values(FAKE_CHUNKS).slice(0, Math.min(k, 3))
            .map((chunk, i) => ({ id: chunk.id, doc_id: chunk.doc_id, sim: 0.9 - i * 0.1, score: 10 - i }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ query: q, hyde_used: url.searchParams.get('hyde') === '1', hits, search_mode: 'hybrid', degraded: false }));
        return;
    }
    const chunkMatch = url.pathname.match(/^\/api\/chunk\/([A-Za-z0-9_-]+)$/);
    if (req.method === 'GET' && chunkMatch && FAKE_CHUNKS[chunkMatch[1]]) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(FAKE_CHUNKS[chunkMatch[1]]));
        return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: 'Not Found' }));
});

let baseUrl;
let gateway;

beforeAll(async () => {
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${upstream.address().port}`;
    gateway = createSecondBrainGateway({ baseUrl, token: FAKE_TOKEN });
});

afterAll(async () => {
    await new Promise(resolve => upstream.close(resolve));
});

describe('route classification (allowlist only)', () => {
    test('read routes are allowed', () => {
        expect(resolveGatewayRoute('GET', '/health').action).toBe('health');
        expect(resolveGatewayRoute('GET', '/overview').action).toBe('overview');
        expect(resolveGatewayRoute('GET', '/search').action).toBe('search');
        expect(resolveGatewayRoute('GET', '/chunk/c1')).toEqual({ action: 'chunk', chunkId: 'c1' });
    });
    test('write verbs are rejected with 403', () => {
        for (const verb of ['POST', 'PUT', 'DELETE', 'PATCH']) {
            for (const path of ['/search', '/chunk/c1', '/overview', '/ingest', '/admin']) {
                const route = resolveGatewayRoute(verb, path);
                expect(route.error).toBeInstanceOf(GatewayError);
                expect(route.error.status).toBe(403);
            }
        }
    });
    test('write-shaped GET paths are not found', () => {
        for (const path of ['/ingest', '/api/ingest', '/build', '/graph/build', '/admin', '/refresh', '/api/search']) {
            expect(resolveGatewayRoute('GET', path).error.status).toBe(404);
        }
    });
    test('traversal and encoded tricks cannot reach another route', () => {
        for (const path of ['/chunk/../search', '/chunk/%2e%2e/search', '/chunk/c1%2f..%2fingest', '/%2e%2e/api/ingest', '/chunk/c1/extra', '/search%2f..%2fingest']) {
            const route = resolveGatewayRoute('GET', path);
            expect(route.action).not.toBe('chunk');
            expect(route.action).not.toBe('search');
        }
        // A doubled slash collapses to the plain read route, never to a write route.
        expect(resolveGatewayRoute('GET', '//search').action).toBe('search');
    });
    test('bad chunk ids are rejected', () => {
        expect(resolveGatewayRoute('GET', '/chunk/').error.status).toBe(400);
        expect(resolveGatewayRoute('GET', '/chunk/a b').error.status).toBe(400);
        expect(resolveGatewayRoute('GET', '/chunk/a.b').error.status).toBe(400);
    });
});

describe('gateway against mock upstream', () => {
    test('health reports configured without upstream traffic', async () => {
        upstreamRequests = [];
        const result = await gateway.handle('GET', '/health');
        expect(result.status).toBe(200);
        expect(result.body).toEqual({ ok: true, gateway: 'second-brain-readonly', configured: true });
        expect(upstreamRequests).toHaveLength(0);
    });
    test('overview passes through with the scoped token upstream only', async () => {
        const result = await gateway.handle('GET', '/overview');
        expect(result.status).toBe(200);
        expect(result.body).toEqual({ documents: 3, chunks: 3 });
        expect(lastAuthHeader).toBe(`Bearer ${FAKE_TOKEN}`);
        expect(JSON.stringify(result.body)).not.toContain(FAKE_TOKEN);
    });
    test('search over the unified corpus returns hydrated hits with provenance', async () => {
        const result = await gateway.handle('GET', '/search', { q: 'fake runes', k: '3' });
        expect(result.status).toBe(200);
        expect(result.body.query).toBe('fake runes');
        expect(result.body.search_mode).toBe('hybrid');
        expect(result.body.hits).toHaveLength(3);
        expect(result.body.hits[0]).toMatchObject({
            id: 'c1', doc_id: 'd1', text: FAKE_CHUNKS.c1.text,
            doc_title: 'Fake Runes', source: 'fake-source-a',
        });
        expect(result.body.hits[2].doc_title).toBe('Fake Halls');
        expect(JSON.stringify(result.body)).not.toContain(FAKE_TOKEN);
    });
    test('hydration is trimmed to the configured count', async () => {
        const small = createSecondBrainGateway({ baseUrl, token: FAKE_TOKEN, maxHydrate: 1 });
        const result = await small.handle('GET', '/search', { q: 'fake', k: '3' });
        expect(result.body.hits[0].text).toBe(FAKE_CHUNKS.c1.text);
        expect(result.body.hits[1].text).toBeUndefined();
        expect(result.body.hits[2].text).toBeUndefined();
    });
    test('chunk fetch passes through', async () => {
        const result = await gateway.handle('GET', '/chunk/c2');
        expect(result.status).toBe(200);
        expect(result.body).toEqual(FAKE_CHUNKS.c2);
    });
    test('search validates its parameters before upstream', async () => {
        upstreamRequests = [];
        expect((await gateway.handle('GET', '/search', {})).status).toBe(400);
        expect((await gateway.handle('GET', '/search', { q: 'x', k: 'abc' })).status).toBe(400);
        expect((await gateway.handle('GET', '/search', { q: 'x', hyde: 'yes' })).status).toBe(400);
        expect(upstreamRequests).toHaveLength(0);
    });
    test('every write attempt is rejected and never reaches upstream', async () => {
        const attempts = [
            ['POST', '/search'], ['POST', '/chunk/c1'], ['PUT', '/overview'],
            ['DELETE', '/chunk/c1'], ['PATCH', '/search'], ['POST', '/ingest'],
            ['POST', '/api/ingest'], ['POST', '/graph/build'], ['POST', '/admin'],
            ['POST', '/refresh'], ['GET', '/ingest'], ['GET', '/admin/refresh'],
            ['GET', '/chunk/../ingest'], ['GET', '/chunk/%2e%2e%2fingest'],
        ];
        upstreamRequests = [];
        for (const [method, path] of attempts) {
            const result = await gateway.handle(method, path, { q: 'x' });
            expect([400, 403, 404, 405]).toContain(result.status);
            expect(result.status).not.toBe(200);
        }
        expect(upstreamRequests).toHaveLength(0);
    });
    test('upstream 500 surfaces catchably as 502 and the caller survives', async () => {
        upstreamMode = 'fail500';
        try {
            const result = await gateway.handle('GET', '/overview');
            expect(result.status).toBe(502);
            expect(result.body.error).toBe('upstream_error');
            await expect(gateway.overview()).rejects.toBeInstanceOf(GatewayError);
        } finally {
            upstreamMode = 'ok';
        }
        const after = await gateway.handle('GET', '/overview');
        expect(after.status).toBe(200);
    });
    test('upstream down surfaces catchably as 502', async () => {
        const dead = createSecondBrainGateway({ baseUrl: 'http://127.0.0.1:1', token: FAKE_TOKEN });
        const result = await dead.handle('GET', '/search', { q: 'x' });
        expect(result.status).toBe(502);
        await expect(dead.search({ q: 'x' })).rejects.toMatchObject({ code: 'upstream_unreachable' });
    });
});

describe('unconfigured gateway', () => {
    test('no token: reports unconfigured and never calls upstream', async () => {
        const bare = createSecondBrainGateway({ baseUrl });
        expect(bare.configured).toBe(false);
        const health = await bare.handle('GET', '/health');
        expect(health.body.configured).toBe(false);
        upstreamRequests = [];
        const result = await bare.handle('GET', '/search', { q: 'x' });
        expect(result.status).toBe(503);
        expect(result.body.error).toBe('gateway_unconfigured');
        expect(upstreamRequests).toHaveLength(0);
        // The unauthenticated upstream must never be probed either.
        expect(lastAuthHeader).not.toBe('Bearer undefined');
    });
    test('no base URL: also unconfigured', async () => {
        const bare = createSecondBrainGateway({ token: FAKE_TOKEN });
        expect(bare.configured).toBe(false);
        expect((await bare.handle('GET', '/overview')).status).toBe(503);
    });
});

describe('static contract pinning', () => {
    test('endpoint module delegates everything to the core allowlist', () => {
        const endpoint = fs.readFileSync(new URL('../src/endpoints/second-brain.js', import.meta.url), 'utf8');
        expect(endpoint).toContain('gatewayFromEnv');
        expect(endpoint).toContain('router.all(\'*\'');
        expect(endpoint).not.toContain(FAKE_TOKEN);
        const core = fs.readFileSync(new URL('../src/second-brain/gateway-core.js', import.meta.url), 'utf8');
        for (const writePath of ['/api/ingest', '/api/admin', 'build', 'refresh']) {
            expect(core).not.toContain('upstreamGet(' + writePath);
            expect(core).not.toContain('upstreamGet(\u0060' + writePath);
        }
        expect(core).toContain('\'/api/overview\'');
        expect(core).toContain('/api/chunk/');
        expect(core).toContain('/api/search?');
    });
});
