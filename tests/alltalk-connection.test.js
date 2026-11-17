/**
 * RFST-006 - AllTalk V2 remote G14 connection.
 *
 * Roadmap evidence required: "Remote voices list and speech render."
 *
 * What is exercised for real:
 *  - A local mock AllTalk V2 server (node http, ephemeral port on
 *    127.0.0.1 only, fake voice names only) implementing the routes
 *    of the REAL installed AllTalk V2 server at ~/alltalk_tts
 *    (tts_server.py, audited 2026-11-17): GET /api/ready (plain text
 *    "Ready"), GET /api/voices ({ voices: [filenames] }),
 *    POST /api/tts-generate (form fields text_input, text_filtering,
 *    character_voice_gen, narrator_enabled, narrator_voice_gen,
 *    text_not_inside, language, output_file_name,
 *    output_file_timestamp, autoplay, autoplay_volume; returns
 *    { status, output_file_path, output_file_url,
 *    output_cache_url }), GET /api/tts-generate-streaming
 *    (query text, voice, language, output_file; audio/wav stream),
 *    GET /api/currentsettings, and GET /audio/<file>.
 *  - Static contract pinning against the REAL provider source
 *    (public/scripts/extensions/tts/alltalk.js is read from disk
 *    and its endpoint default, route strings, form field names
 *    and streaming parameter names are asserted verbatim).
 *
 * What is replicated, honestly: alltalk.js cannot be imported
 * headlessly - it imports extensions.js / utils.js / tts/index.js
 * and constructs document.createElement('audio') as a class field.
 * The client helpers below therefore REPLICATE the provider's
 * request/response logic line-for-line in miniature (same URLs,
 * same body fields, same parsing, same V2 URL joining, same
 * checkReady never-throws contract), following the RFST-007
 * pattern. The mock is the server; the client is a faithful copy,
 * pinned to the real source by the static tests.
 *
 * Provider audit findings against the installed server (also in
 * campaign/PROGRESS.md):
 *  1. MATCH: /api/ready, /api/voices, /api/tts-generate form
 *     fields, /api/tts-generate-streaming query params, and the
 *     default endpoint port 7851 (server confignew.json binds
 *     127.0.0.1:7851) all agree.
 *  2. MISMATCH: the installed tts_server.py has NO /api/rvcvoices
 *     route (no RVC code at all). The provider's
 *     fetchRvcVoiceObjects will get 404, fall back to a Disabled
 *     entry, and rethrow; updateSettingsFromServer calls it.
 *  3. MISMATCH: /api/currentsettings on the installed server
 *     returns { models_available, current_model_loaded,
 *     deepspeed_available, deepspeed_status, low_vram_status,
 *     finetuned_model }, while the provider reads
 *     engines_available / current_engine_loaded /
 *     deepspeed_capable / deepspeed_enabled / lowvram_capable /
 *     lowvram_enabled - those provider fields come back undefined
 *     against this server build.
 *  4. MISMATCH: the installed server returns output_file_url as
 *     an ABSOLUTE URL (http://127.0.0.1:7851/audio/...), while
 *     the provider's V2 branch prepends provider_endpoint to it,
 *     producing a double-prefixed, unfetchable URL. Using the
 *     server URL as-is renders fine (proven below).
 *
 * Live evidence status: the real AllTalk server was NOT started
 * for this package - the RTX 2060 had only 1201 MiB VRAM free
 * (4538 MiB used by other work) at audit time, below the 3.5 GB
 * safety floor. The live voices-list + speech render against
 * the real server is GATED on GPU headroom (see PROGRESS.md);
 * this suite proves the full contract against the mock instead.
 */
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import http from 'node:http';
import fs from 'node:fs';

const providerSource = fs.readFileSync(new URL('../public/scripts/extensions/tts/alltalk.js', import.meta.url), 'utf8');

const FAKE_VOICES = ['fake_female_01.wav', 'fake_male_01.wav', 'fake_narrator.wav'];
const FAKE_WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WAVEfmt '), Buffer.alloc(32, 1)]);

let readyMode = 'ready';
let generateMode = 'ok';
let lastGenerateBody = null;
let lastStreamingQuery = null;

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/api/ready') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(readyMode === 'ready' ? 'Ready' : 'Loading');
        return;
    }
    if (req.method === 'GET' && url.pathname === '/api/voices') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ voices: FAKE_VOICES }));
        return;
    }
    if (req.method === 'GET' && url.pathname === '/api/rvcvoices') {
        // The installed AllTalk V2 server has no such route: 404.
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Not Found' }));
        return;
    }
    if (req.method === 'GET' && url.pathname === '/api/currentsettings') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            models_available: [
                { name: 'Coqui', model_name: 'XTTSv2 Local' },
                { name: 'Coqui', model_name: 'API TTS' },
                { name: 'Coqui', model_name: 'API Local' },
            ],
            current_model_loaded: 'XTTSv2 Local',
            deepspeed_available: false,
            deepspeed_status: false,
            low_vram_status: false,
            finetuned_model: 'false',
        }));
        return;
    }
    if (req.method === 'POST' && url.pathname === '/api/tts-generate') {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
            lastGenerateBody = Object.fromEntries(new URLSearchParams(raw));
            if (generateMode !== 'ok') {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'generate-failure', error: 'An error occurred' }));
                return;
            }
            const port = server.address().port;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'generate-success',
                output_file_path: 'outputs/st_output_12345abc.wav',
                output_file_url: `http://127.0.0.1:${port}/audio/st_output_12345abc.wav`,
                output_cache_url: `http://127.0.0.1:${port}/audiocache/st_output_12345abc.wav`,
            }));
        });
        return;
    }
    if (req.method === 'GET' && url.pathname === '/api/tts-generate-streaming') {
        lastStreamingQuery = Object.fromEntries(url.searchParams);
        res.writeHead(200, { 'Content-Type': 'audio/wav' });
        res.end(FAKE_WAV);
        return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/audio/')) {
        res.writeHead(200, { 'Content-Type': 'audio/wav' });
        res.end(FAKE_WAV);
        return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: 'Not Found' }));
});

let endpoint;
beforeAll(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
});

// --- Replicated provider client (see header: what is real vs copied) ---
const settings = {
    provider_endpoint: '',
    server_version: 'v2',
    language: 'en',
    narrator_enabled: 'false',
    narrator_voice_gen: 'fake_narrator.wav',
    at_narrator_text_not_inside: 'narrator',
    rvc_character_voice: 'Disabled',
    rvc_character_pitch: '0',
    rvc_narrator_voice: 'Disabled',
    rvc_narrator_pitch: '0',
};

async function checkReady(ep) {
    // Mirrors AllTalkTtsProvider.checkReady: never throws.
    const state = { ready: false };
    try {
        const response = await fetch(`${ep}/api/ready`);
        if (!response.ok) throw new Error(`HTTP Error Response: ${response.status} ${response.statusText}`);
        const statusText = await response.text();
        state.ready = statusText === 'Ready';
    } catch {
        state.ready = false;
    }
    return state.ready;
}

async function fetchTtsVoiceObjects(ep) {
    // Mirrors fetchTtsVoiceObjects: throws on HTTP error.
    const response = await fetch(`${ep}/api/voices`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    const data = await response.json();
    return data.voices.map(filename => ({ name: filename, voice_id: filename, preview_url: null, lang: 'en' }));
}

async function fetchRvcVoiceObjects(ep) {
    // Mirrors fetchRvcVoiceObjects: Disabled fallback, then rethrow.
    try {
        const response = await fetch(`${ep}/api/rvcvoices`);
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        const data = await response.json();
        if (!data || !data.rvcvoices) throw new Error('Invalid data format received from /api/rvcvoices');
        return data.rvcvoices.map(filename => ({ name: filename, voice_id: filename }));
    } catch (error) {
        fetchRvcVoiceObjects.fallback = [{ name: 'Disabled', voice_id: 'Disabled' }];
        throw error;
    }
}

async function fetchTtsGeneration(ep, inputText, voiceId) {
    // Mirrors fetchTtsGeneration: same form fields, same V2 URL join.
    const requestBody = new URLSearchParams({
        'text_input': inputText,
        'text_filtering': 'standard',
        'character_voice_gen': voiceId,
        'narrator_enabled': settings.narrator_enabled,
        'narrator_voice_gen': settings.narrator_voice_gen,
        'text_not_inside': settings.at_narrator_text_not_inside,
        'language': settings.language,
        'output_file_name': 'st_output',
        'output_file_timestamp': 'true',
        'autoplay': 'false',
        'autoplay_volume': '0.8',
    });
    const response = await fetch(`${ep}/api/tts-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
        body: requestBody,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    const data = await response.json();
    return settings.server_version === 'v1' ? data.output_file_url : `${ep}${data.output_file_url}`;
}

function buildStreamingUrl(ep, inputText, voiceId) {
    // Mirrors generateTts streaming branch, verbatim parameter order.
    return `${ep}/api/tts-generate-streaming?text=${encodeURIComponent(inputText)}&voice=${encodeURIComponent(voiceId)}&language=${encodeURIComponent(settings.language)}&output_file=stream_output.wav`;
}

const DOWN = 'http://127.0.0.1:1'; // nothing listens: connection refused

describe('provider source contract (static pinning of alltalk.js)', () => {
    test('default endpoint is the AllTalk port 7851', () => {
        expect(providerSource).toContain('\'http://localhost:7851\'');
    });
    test('provider defaults to server_version v2', () => {
        expect(providerSource).toContain('server_version: this.settings.server_version || \'v2\'');
    });
    test('provider uses the documented v2 routes', () => {
        for (const route of ['/api/ready', '/api/voices', '/api/rvcvoices', '/api/currentsettings', '/api/tts-generate', '/api/tts-generate-streaming', '/api/previewvoice/']) {
            expect(providerSource).toContain(route);
        }
    });
    test('provider sends the real tts-generate form field names', () => {
        for (const field of ['text_input', 'text_filtering', 'character_voice_gen', 'narrator_enabled', 'narrator_voice_gen', 'text_not_inside', 'output_file_name', 'output_file_timestamp', 'autoplay_volume']) {
            expect(providerSource).toContain(field);
        }
    });
    test('provider streaming URL carries text, voice, language, output_file', () => {
        expect(providerSource).toContain('api/tts-generate-streaming?text=');
        expect(providerSource).toContain('&voice=');
        expect(providerSource).toContain('&language=');
        expect(providerSource).toContain('&output_file=stream_output.wav');
    });
});

describe('readiness (GET /api/ready)', () => {
    test('server answering Ready marks the provider ready', async () => {
        readyMode = 'ready';
        await expect(checkReady(endpoint)).resolves.toBe(true);
    });
    test('server answering a non-Ready body marks not ready, no throw', async () => {
        readyMode = 'loading';
        await expect(checkReady(endpoint)).resolves.toBe(false);
        readyMode = 'ready';
    });
    test('server down: checkReady resolves false and never throws', async () => {
        await expect(checkReady(DOWN)).resolves.toBe(false);
    });
});

describe('voices list (GET /api/voices)', () => {
    test('voices parse into the provider voice-object shape', async () => {
        const voices = await fetchTtsVoiceObjects(endpoint);
        expect(voices).toEqual([
            { name: 'fake_female_01.wav', voice_id: 'fake_female_01.wav', preview_url: null, lang: 'en' },
            { name: 'fake_male_01.wav', voice_id: 'fake_male_01.wav', preview_url: null, lang: 'en' },
            { name: 'fake_narrator.wav', voice_id: 'fake_narrator.wav', preview_url: null, lang: 'en' },
        ]);
    });
    test('every listed voice id is a wav filename the server can render with', async () => {
        const voices = await fetchTtsVoiceObjects(endpoint);
        expect(voices.every(v => v.voice_id.endsWith('.wav'))).toBe(true);
    });
    test('server down: voices fetch rejects with a catchable error', async () => {
        await expect(fetchTtsVoiceObjects(DOWN)).rejects.toThrow();
        // The chat-safe pattern: a caller catch leaves the app alive.
        const safe = await fetchTtsVoiceObjects(DOWN).catch(() => []);
        expect(safe).toEqual([]);
    });
});

describe('rvc voices (audit mismatch: installed server has no route)', () => {
    test('404 from the real server shape falls back to Disabled and surfaces an error', async () => {
        await expect(fetchRvcVoiceObjects(endpoint)).rejects.toThrow('HTTP 404');
        expect(fetchRvcVoiceObjects.fallback).toEqual([{ name: 'Disabled', voice_id: 'Disabled' }]);
    });
});

describe('current settings (GET /api/currentsettings)', () => {
    test('server returns its real shape; models_available sorts as the provider sorts it', async () => {
        const data = await (await fetch(`${endpoint}/api/currentsettings`)).json();
        expect(data.current_model_loaded).toBe('XTTSv2 Local');
        const sorted = [...data.models_available].sort((a, b) => a.name.localeCompare(b.name));
        expect(sorted).toHaveLength(3);
    });
    test('audit mismatch: provider-expected engine keys are absent on this server build', async () => {
        const data = await (await fetch(`${endpoint}/api/currentsettings`)).json();
        expect(data.engines_available).toBeUndefined();
        expect(data.current_engine_loaded).toBeUndefined();
        expect(data.deepspeed_capable).toBeUndefined();
        expect(data.lowvram_capable).toBeUndefined();
        expect(data.deepspeed_status).toBe(false);
        expect(data.low_vram_status).toBe(false);
    });
});

describe('speech render (POST /api/tts-generate)', () => {
    test('request body carries exactly the fields the real server requires', async () => {
        generateMode = 'ok';
        await fetchTtsGeneration(endpoint, 'Come closer. I have something to show you.', 'fake_female_01.wav').catch(() => {});
        expect(lastGenerateBody).toMatchObject({
            text_input: 'Come closer. I have something to show you.',
            text_filtering: 'standard',
            character_voice_gen: 'fake_female_01.wav',
            narrator_enabled: 'false',
            narrator_voice_gen: 'fake_narrator.wav',
            text_not_inside: 'narrator',
            language: 'en',
            output_file_name: 'st_output',
            output_file_timestamp: 'true',
            autoplay: 'false',
            autoplay_volume: '0.8',
        });
    });
    test('the server-provided absolute audio URL fetches real wav bytes', async () => {
        const raw = await (await fetch(`${endpoint}/api/tts-generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ text_input: 'Hello.', text_filtering: 'standard', character_voice_gen: 'fake_female_01.wav', narrator_enabled: 'false', narrator_voice_gen: 'fake_narrator.wav', text_not_inside: 'narrator', language: 'en', output_file_name: 'st_output', output_file_timestamp: 'true', autoplay: 'false', autoplay_volume: '0.8' }),
        })).json();
        expect(raw.status).toBe('generate-success');
        const audio = await fetch(raw.output_file_url);
        expect(audio.ok).toBe(true);
        expect(audio.headers.get('content-type')).toContain('audio/wav');
        const bytes = Buffer.from(await audio.arrayBuffer());
        expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
    });
    test('audit mismatch: provider V2 join double-prefixes the absolute URL', async () => {
        const joined = await fetchTtsGeneration(endpoint, 'Hello.', 'fake_female_01.wav');
        // Documented defect vs this server build: endpoint + absolute URL.
        expect(joined.startsWith(`${endpoint}http://127.0.0.1:`)).toBe(true);
        await expect(fetch(joined)).rejects.toThrow();
    });
    test('server failure surfaces as a catchable HTTP 500 error', async () => {
        generateMode = 'fail';
        await expect(fetchTtsGeneration(endpoint, 'Hello.', 'fake_female_01.wav')).rejects.toThrow('HTTP 500');
        generateMode = 'ok';
    });
    test('server down: generation rejects catchably, chat survives via catch', async () => {
        const safe = await fetchTtsGeneration(DOWN, 'Hello.', 'fake_female_01.wav').catch(() => null);
        expect(safe).toBeNull();
    });
});

describe('streaming render (GET /api/tts-generate-streaming)', () => {
    test('streaming URL encodes text, voice, language and output_file', () => {
        const url = buildStreamingUrl(endpoint, 'A line with spaces & symbols?', 'fake_male_01.wav');
        expect(url).toContain('text=A%20line%20with%20spaces%20%26%20symbols%3F');
        expect(url).toContain('voice=fake_male_01.wav');
        expect(url).toContain('language=en');
        expect(url).toContain('output_file=stream_output.wav');
    });
    test('streaming GET returns wav bytes and the server sees the exact params', async () => {
        const response = await fetch(buildStreamingUrl(endpoint, 'Stream this line.', 'fake_male_01.wav'));
        expect(response.ok).toBe(true);
        expect(response.headers.get('content-type')).toContain('audio/wav');
        const bytes = Buffer.from(await response.arrayBuffer());
        expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
        expect(lastStreamingQuery).toEqual({ text: 'Stream this line.', voice: 'fake_male_01.wav', language: 'en', output_file: 'stream_output.wav' });
    });
});
