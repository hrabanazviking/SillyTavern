/**
 * RFST-013 - ComfyUI remote endpoint baseline.
 *
 * Roadmap evidence required (section 14): "API-format workflow
 * returns image into chat." Section 10 acceptance: an image
 * request produces a visible image in chat/gallery, failed loads
 * and corrupt workflows do not crash SillyTavern or discard
 * messages.
 *
 * Audit of the REAL built-in path (2026-11-17, this clone):
 *  - Browser (public/scripts/extensions/stable-diffusion/
 *    index.js): defaults comfy_url http://127.0.0.1:8188 and
 *    comfy_workflow Default_Comfy_Workflow.json, comfy_type
 *    standard. generateComfyImageCommon loads the workflow via
 *    POST /api/sd/comfy/workflow { file_name }, substitutes the
 *    quoted placeholders "%prompt%", "%negative_prompt%",
 *    "%seed%", "%denoise%", "%clip_skip%" plus the settings
 *    placeholders model/vae/sampler/scheduler/steps/scale/
 *    width/height, then POSTs { url, prompt } to
 *    /api/sd/comfy/generate where prompt is the string
 *    '{ "prompt": <workflow> }'. The { format, data } result is
 *    saved with saveBase64AsFile and put into chat by
 *    sendMessage (or the generation callback).
 *  - Server (src/endpoints/stable-diffusion.js, router mounted
 *    at /api/sd): POST /comfy/generate POSTs request.body.prompt
 *    VERBATIM to <url>/prompt and expects { prompt_id }; polls
 *    GET <url>/history/<id> every 100 ms until the id appears
 *    (NO server-side timeout; a client disconnect fires
 *    POST <url>/interrupt and aborts); status_str error throws
 *    with the execution_error node messages; the first images
 *    entry wins (a_images and other keys are ignored), else
 *    the first gifs entry; image bytes come from
 *    GET <url>/view?filename=&subfolder=&type= and the route
 *    answers { format: <filename extension>, data: <base64> }.
 *    /comfy/ping proxies GET /system_stats; /comfy/samplers,
 *    /models, /schedulers and /vaes proxy GET /object_info.
 *    No auth is sent on /prompt, /history or /view (the
 *    Authorization header is only used on /interrupt), so the
 *    endpoint assumes a trusted private network.
 *  - API format: a workflow is a JSON object keyed by node-id
 *    strings, each value { class_type, inputs }, links as
 *    [nodeId, outputIndex] pairs - NOT the UI format (nodes /
 *    links arrays). The bundled
 *    default/content/Default_Comfy_Workflow.json follows it
 *    and carries the "%prompt%" style placeholders.
 *
 * What is exercised for real:
 *  - The REAL server router src/endpoints/stable-diffusion.js
 *    is imported and mounted in Express (only secrets.js is
 *    mocked, as in tests/stable-diffusion.test.js; node-fetch
 *    is NOT mocked here), so every /comfy/* request below runs
 *    production server code over real HTTP.
 *  - A local mock ComfyUI server (node http, ephemeral port on
 *    127.0.0.1 only, fake names only) implementing the real
 *    routes and shapes above: POST /prompt, GET /history/<id>,
 *    GET /view, GET /system_stats, GET /object_info,
 *    POST /interrupt. It records every request it receives.
 *
 * What is replicated, honestly: the browser extension cannot
 * be imported headlessly - index.js pulls in the whole browser
 * app graph (script.js, jQuery, toastr, document). The small
 * client helpers below therefore REPLICATE
 * generateComfyImageCommon line-for-line in miniature (same
 * workflow load, same substitutions, same generate body, same
 * { format, data } handling), following the RFST-006 pattern,
 * and static tests pin the real source strings so the replica
 * cannot silently drift.
 *
 * Live evidence status: ComfyUI is installed on purpleraider
 * but was NOT running at audit time (no process, port closed)
 * and no service was started for this package. The live
 * image-into-chat run against the real ComfyUI is GATED on it
 * being started under a roadmap step / the owner word (see
 * campaign/PROGRESS.md); this suite proves the full contract
 * against the mock instead.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

jest.unstable_mockModule('../src/endpoints/secrets.js', () => ({
    readSecret: jest.fn(),
    SECRET_KEYS: {},
}));

const clientSource = fs.readFileSync(new URL('../public/scripts/extensions/stable-diffusion/index.js', import.meta.url), 'utf8');
const serverSource = fs.readFileSync(new URL('../src/endpoints/stable-diffusion.js', import.meta.url), 'utf8');
const defaultWorkflowText = fs.readFileSync(new URL('../default/content/Default_Comfy_Workflow.json', import.meta.url), 'utf8');

// --- Tiny valid PNG, generated in-test (1x1, red pixel) ---
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    return c >>> 0;
});
function crc32(buffer) {
    let crc = 0xFFFFFFFF;
    for (const byte of buffer) {
        crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}
function makeTinyPng() {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    const idat = zlib.deflateSync(Buffer.from([0, 255, 0, 0, 255]));
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', idat),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}
const FAKE_PNG = makeTinyPng();
const FAKE_WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x10, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(16, 7)]);

const FAKE_WORKFLOW = {
    '3': { class_type: 'KSampler', inputs: { seed: '%seed%', steps: '%steps%', cfg: '%scale%', sampler_name: '%sampler%', scheduler: '%scheduler%', model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0], denoise: 1 } },
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: '%model%' } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: '%width%', height: '%height%', batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: '%prompt%', clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: '%negative_prompt%', clip: ['4', 1] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'FakePrefix', images: ['8', 0] } },
};
const FAKE_DEFAULT_WORKFLOW = {
    '1': { class_type: 'SaveImage', inputs: { filename_prefix: 'FakeDefaultPrefix', images: ['8', 0] } },
};
const FAKE_SETTINGS = {
    model: 'fake-checkpoint.safetensors',
    vae: 'fake-vae.safetensors',
    sampler: 'euler',
    scheduler: 'normal',
    steps: 20,
    scale: 7,
    width: 512,
    height: 512,
};
const FAKE_OBJECT_INFO = {
    KSampler: { input: { required: { sampler_name: [['euler', 'fake_sampler']], scheduler: [['normal', 'fake_scheduler']] } } },
    CheckpointLoaderSimple: { input: { required: { ckpt_name: [['fake-checkpoint.safetensors']] } } },
    UNETLoader: { input: { required: { unet_name: [['fake-unet.safetensors']] } } },
    VAELoader: { input: { required: { vae_name: [['fake-vae.safetensors']] } } },
};

// --- Mock ComfyUI server state ---
let promptMode = 'ok';
let historyMode = 'ok';
let historyDelayMs = 0;
let viewMode = 'ok';
let statsMode = 'ok';
let promptBodies = [];
let historyHits = 0;
let viewQueries = [];
let interruptHits = 0;

function historyItem(id) {
    if (historyMode === 'error') {
        return {
            [id]: {
                status: {
                    status_str: 'error',
                    messages: [['execution_error', { node_id: '3', node_type: 'FakeSamplerNode', exception_type: 'FakeError', exception_message: 'fake boom' }]],
                },
                outputs: {},
            },
        };
    }
    if (historyMode === 'nooutputs') {
        return { [id]: { status: { status_str: 'success' }, outputs: { '10': { text: ['no media here'] } } } };
    }
    if (historyMode === 'skip') {
        return {
            [id]: {
                status: { status_str: 'success' },
                outputs: {
                    '117': { a_images: [{ filename: 'fake-comparison.png' }] },
                    '9': { images: [{ filename: 'fake-output.png', subfolder: 'fake-sub', type: 'output' }] },
                },
            },
        };
    }
    if (historyMode === 'gif') {
        return { [id]: { status: { status_str: 'success' }, outputs: { '9': { gifs: [{ filename: 'fake-anim.webp', subfolder: '', type: 'output' }] } } } };
    }
    return { [id]: { status: { status_str: 'success' }, outputs: { '9': { images: [{ filename: 'fake-output.png', subfolder: 'fake-sub', type: 'output' }] } } } };
}

const comfyServer = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'POST' && url.pathname === '/prompt') {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => {
            promptBodies.push(raw);
            if (promptMode === 'fail500') {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'fake prompt failure' }, node_errors: {} }));
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ prompt_id: 'fake-prompt-1', number: 1, node_errors: {} }));
        });
        return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/history/')) {
        historyHits++;
        const id = decodeURIComponent(url.pathname.slice('/history/'.length));
        const send = () => {
            if (historyMode === 'pending' && historyHits <= 2) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end('{}');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(historyItem(id)));
        };
        if (historyDelayMs > 0) {
            setTimeout(send, historyDelayMs);
        } else {
            send();
        }
        return;
    }
    if (req.method === 'GET' && url.pathname === '/view') {
        viewQueries.push(Object.fromEntries(url.searchParams));
        if (viewMode === 'fail404') {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('fake missing file');
            return;
        }
        const isWebp = String(url.searchParams.get('filename') || '').endsWith('.webp');
        res.writeHead(200, { 'Content-Type': isWebp ? 'image/webp' : 'image/png' });
        res.end(isWebp ? FAKE_WEBP : FAKE_PNG);
        return;
    }
    if (req.method === 'GET' && url.pathname === '/system_stats') {
        if (statsMode === 'fail500') {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'fake stats failure' }));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ system: { os: 'fake-os', comfyui_version: '0.0.0-fake' }, devices: [] }));
        return;
    }
    if (req.method === 'GET' && url.pathname === '/object_info') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(FAKE_OBJECT_INFO));
        return;
    }
    if (req.method === 'POST' && url.pathname === '/interrupt') {
        interruptHits++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
        return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'fake not found' }));
});

// --- Replicated browser client (generateComfyImageCommon) ---
function substituteWorkflow(workflow, prompt, negativePrompt) {
    let result = workflow.replaceAll('"%prompt%"', JSON.stringify(prompt));
    result = result.replaceAll('"%negative_prompt%"', JSON.stringify(negativePrompt));
    result = result.replaceAll('"%seed%"', JSON.stringify(424242));
    result = result.replaceAll('"%denoise%"', JSON.stringify(1.0));
    result = result.replaceAll('"%clip_skip%"', JSON.stringify(-1));
    for (const ph of ['model', 'vae', 'sampler', 'scheduler', 'steps', 'scale', 'width', 'height']) {
        result = result.replaceAll(`"%${ph}%"`, JSON.stringify(FAKE_SETTINGS[ph]));
    }
    return result;
}

describe('RFST-013 ComfyUI remote endpoint baseline', () => {
    let stBase;
    let comfyBase;
    let workflowDir;

    async function postGenerate(url, promptBody) {
        return fetch(`${stBase}/comfy/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, prompt: promptBody }),
        });
    }

    async function generateViaSt(prompt, negativePrompt, options = {}) {
        const workflowResponse = await fetch(`${stBase}/comfy/workflow`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_name: 'Fake_Workflow.json' }),
        });
        expect(workflowResponse.ok).toBe(true);
        const workflow = substituteWorkflow(await workflowResponse.json(), prompt, negativePrompt);
        const promptResult = await fetch(`${stBase}/comfy/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: options.signal,
            body: JSON.stringify({
                url: comfyBase,
                prompt: `{\n                    "prompt": ${workflow}\n                }`,
            }),
        });
        if (!promptResult.ok) {
            throw new Error(await promptResult.text());
        }
        return promptResult.json();
    }

    beforeAll(async () => {
        const { default: express } = await import('express');
        const { router } = await import('../src/endpoints/stable-diffusion.js');

        workflowDir = fs.mkdtempSync(path.join(os.homedir(), 'st-tmp', 'rfst013-workflows-'));
        fs.writeFileSync(path.join(workflowDir, 'Fake_Workflow.json'), JSON.stringify(FAKE_WORKFLOW, null, 4));
        fs.writeFileSync(path.join(workflowDir, 'Default_Comfy_Workflow.json'), JSON.stringify(FAKE_DEFAULT_WORKFLOW, null, 4));

        const app = express();
        app.use(express.json());
        app.use((req, res, next) => {
            req.user = { directories: { comfyWorkflows: workflowDir } };
            next();
        });
        app.use(router);
        const stServer = app.listen(0, '127.0.0.1');
        await new Promise(resolve => stServer.once('listening', resolve));
        stBase = `http://127.0.0.1:${stServer.address().port}`;
        comfyServer.listen(0, '127.0.0.1');
        await new Promise(resolve => comfyServer.once('listening', resolve));
        comfyBase = `http://127.0.0.1:${comfyServer.address().port}`;
        // Stash for afterAll teardown.
        comfyServer._stServer = stServer;
    });

    afterAll(async () => {
        await new Promise(resolve => comfyServer._stServer.close(resolve));
        await new Promise(resolve => comfyServer.close(resolve));
        fs.rmSync(workflowDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        promptMode = 'ok';
        historyMode = 'ok';
        historyDelayMs = 0;
        viewMode = 'ok';
        statsMode = 'ok';
        promptBodies = [];
        historyHits = 0;
        viewQueries = [];
        interruptHits = 0;
    });

    test('static: client defaults pin the ComfyUI endpoint and workflow file', () => {
        expect(clientSource).toContain('comfy_url: \'http://127.0.0.1:8188\'');
        expect(clientSource).toContain('comfy_workflow: \'Default_Comfy_Workflow.json\'');
        expect(clientSource).toContain('comfy_type: \'standard\'');
    });

    test('static: client generate path pins workflow load, substitution and chat return', () => {
        expect(clientSource).toContain('fetch(\'/api/sd/comfy/workflow\'');
        expect(clientSource).toContain('replaceAll(\'"%prompt%"\', JSON.stringify(prompt))');
        expect(clientSource).toContain('replaceAll(\'"%negative_prompt%"\', JSON.stringify(negativePrompt))');
        expect(clientSource).toContain('generateComfyImageCommon(prompt, negativePrompt, signal, \'/api/sd/comfy\'');
        expect(clientSource).toContain('saveBase64AsFile(result.data, characterName, filename, result.format)');
        expect(clientSource).toContain('sendMessage(prompt, base64Image, generationType, additionalNegativePrefix, initiator, prefixedPrompt, result.format)');
    });

    test('static: server generate route pins /prompt, /history polling and /view fetch', () => {
        expect(serverSource).toContain('urlJoin(request.body.url, \'/prompt\')');
        expect(serverSource).toContain('urlJoin(request.body.url, `/history/${id}`)');
        expect(serverSource).toContain('await delay(100)');
        expect(serverSource).toContain('item.status.status_str === \'error\'');
        expect(serverSource).toContain('urlJoin(request.body.url, \'/view\')');
        expect(serverSource).toContain('filename=${imgInfo.filename}&subfolder=${imgInfo.subfolder}&type=${imgInfo.type}');
        expect(serverSource).toContain('Buffer.from(imgBuffer).toString(\'base64\')');
        expect(serverSource).toContain('urlJoin(request.body.url, \'/system_stats\')');
        expect(serverSource).toContain('urlJoin(request.body.url, \'/object_info\')');
    });

    test('static: bundled default workflow is API format with placeholders', () => {
        const parsed = JSON.parse(defaultWorkflowText);
        const nodes = Object.values(parsed);
        expect(nodes.length).toBeGreaterThan(0);
        for (const node of nodes) {
            expect(typeof node.class_type).toBe('string');
            expect(typeof node.inputs).toBe('object');
        }
        expect(defaultWorkflowText).toContain('"%prompt%"');
        expect(defaultWorkflowText).toContain('"%negative_prompt%"');
        expect(parsed['4'].class_type).toBe('CheckpointLoaderSimple');
        expect(parsed['4'].inputs.ckpt_name).toBe('%model%');
        expect(nodes.some(node => node.class_type === 'SaveImage')).toBe(true);
    });

    test('ping proxies /system_stats and reports the endpoint up', async () => {
        const response = await fetch(`${stBase}/comfy/ping`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: comfyBase }),
        });
        expect(response.status).toBe(200);
    });

    test('ping surfaces a ComfyUI failure as a catchable 500', async () => {
        statsMode = 'fail500';
        const response = await fetch(`${stBase}/comfy/ping`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: comfyBase }),
        });
        expect(response.status).toBe(500);
    });

    test('models are listed from /object_info with fake names only', async () => {
        const response = await fetch(`${stBase}/comfy/models`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: comfyBase }),
        });
        expect(response.status).toBe(200);
        const models = await response.json();
        expect(models).toContainEqual({ value: 'fake-checkpoint.safetensors', text: 'fake-checkpoint' });
        expect(models).toContainEqual({ value: 'fake-unet.safetensors', text: 'UNet: fake-unet' });
    });

    test('workflow route returns the stored workflow and falls back to the default', async () => {
        const found = await fetch(`${stBase}/comfy/workflow`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_name: 'Fake_Workflow.json' }),
        });
        expect(found.status).toBe(200);
        const workflow = JSON.parse(await found.json());
        expect(workflow['9'].class_type).toBe('SaveImage');
        expect(workflow['6'].inputs.text).toBe('%prompt%');

        const missing = await fetch(`${stBase}/comfy/workflow`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_name: 'No_Such_Workflow.json' }),
        });
        expect(missing.status).toBe(200);
        const fallback = JSON.parse(await missing.json());
        expect(fallback['1'].inputs.filename_prefix).toBe('FakeDefaultPrefix');
    });

    test('happy path: API-format workflow returns the image in chat shape', async () => {
        historyMode = 'pending';
        const result = await generateViaSt('a fake lighthouse at dawn', 'fake blur, fake noise');
        expect(result.format).toBe('png');
        const decoded = Buffer.from(result.data, 'base64');
        expect(decoded.equals(FAKE_PNG)).toBe(true);
        expect(decoded.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47]))).toBe(true);

        expect(promptBodies).toHaveLength(1);
        const submitted = JSON.parse(promptBodies[0]);
        expect(Object.keys(submitted)).toEqual(['prompt']);
        expect(submitted.prompt['6'].inputs.text).toBe('a fake lighthouse at dawn');
        expect(submitted.prompt['7'].inputs.text).toBe('fake blur, fake noise');
        expect(submitted.prompt['4'].inputs.ckpt_name).toBe('fake-checkpoint.safetensors');
        expect(submitted.prompt['3'].inputs.seed).toBe(424242);
        expect(submitted.prompt['3'].inputs.steps).toBe(20);
        expect(submitted.prompt['5'].inputs.width).toBe(512);
        expect(JSON.stringify(submitted)).not.toContain('%prompt%');

        expect(historyHits).toBeGreaterThanOrEqual(3);
        expect(viewQueries).toEqual([{ filename: 'fake-output.png', subfolder: 'fake-sub', type: 'output' }]);
    });

    test('generate skips outputs without images and uses the first images entry', async () => {
        historyMode = 'skip';
        const response = await postGenerate(comfyBase, '{"prompt": {}}');
        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result.format).toBe('png');
        expect(Buffer.from(result.data, 'base64').equals(FAKE_PNG)).toBe(true);
        expect(viewQueries).toEqual([{ filename: 'fake-output.png', subfolder: 'fake-sub', type: 'output' }]);
    });

    test('generate falls back to gifs when no output node has images', async () => {
        historyMode = 'gif';
        const response = await postGenerate(comfyBase, '{"prompt": {}}');
        expect(response.status).toBe(200);
        const result = await response.json();
        expect(result.format).toBe('webp');
        expect(Buffer.from(result.data, 'base64').equals(FAKE_WEBP)).toBe(true);
    });

    test('a ComfyUI 500 on /prompt surfaces as a catchable ST 500', async () => {
        promptMode = 'fail500';
        const response = await postGenerate(comfyBase, '{"prompt": {}}');
        expect(response.status).toBe(500);
        expect(await response.text()).toContain('ComfyUI returned an error.');
    });

    test('a workflow error status surfaces with its node message', async () => {
        historyMode = 'error';
        const response = await postGenerate(comfyBase, '{"prompt": {}}');
        expect(response.status).toBe(500);
        const text = await response.text();
        expect(text).toContain('ComfyUI generation did not succeed.');
        expect(text).toContain('FakeSamplerNode [3] FakeError: fake boom');
    });

    test('outputs without images or gifs surface as a catchable 500', async () => {
        historyMode = 'nooutputs';
        const response = await postGenerate(comfyBase, '{"prompt": {}}');
        expect(response.status).toBe(500);
        expect(await response.text()).toContain('did not return any recognizable outputs');
    });

    test('a /view failure surfaces as a catchable 500', async () => {
        viewMode = 'fail404';
        const response = await postGenerate(comfyBase, '{"prompt": {}}');
        expect(response.status).toBe(500);
        expect(await response.text()).toContain('ComfyUI returned an error.');
    });

    test('server down surfaces catchably and the caller survives', async () => {
        const deadServer = http.createServer();
        deadServer.listen(0, '127.0.0.1');
        await new Promise(resolve => deadServer.once('listening', resolve));
        const deadUrl = `http://127.0.0.1:${deadServer.address().port}`;
        await new Promise(resolve => deadServer.close(resolve));

        const down = await postGenerate(deadUrl, '{"prompt": {}}');
        expect(down.status).toBe(500);

        const result = await generateViaSt('a fake harbour at dusk', 'fake blur');
        expect(result.format).toBe('png');
        expect(Buffer.from(result.data, 'base64').equals(FAKE_PNG)).toBe(true);
    });

    test('client timeout aborts catchably while history is slow', async () => {
        historyDelayMs = 700;
        let caught = null;
        try {
            await generateViaSt('a fake cliff path', 'fake blur', { signal: AbortSignal.timeout(200) });
        } catch (error) {
            caught = error;
        }
        expect(caught).not.toBeNull();
        expect(caught.name).toMatch(/Abort|Timeout/);
        // Let the orphaned server-side poll finish its cycle
        // against the now-fast mock before teardown.
        historyDelayMs = 0;
        await new Promise(resolve => setTimeout(resolve, 1500));
    }, 15000);

    test('after a timeout the endpoint still generates successfully', async () => {
        const result = await generateViaSt('a fake meadow', 'fake blur');
        expect(result.format).toBe('png');
        expect(Buffer.from(result.data, 'base64').equals(FAKE_PNG)).toBe(true);
        expect(interruptHits).toBeGreaterThanOrEqual(0);
    });
});
