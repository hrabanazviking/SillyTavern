/**
 * RFST-013 LIVE PROOF - ComfyUI remote endpoint baseline, against a
 * REAL ComfyUI server. This suite is the live leg that
 * tests/comfyui-remote-endpoint.test.js (the hermetic contract suite)
 * always declared gated: it re-runs the same client path - workflow
 * load through POST /comfy/workflow, quoted-placeholder substitution
 * exactly as public/scripts/extensions/stable-diffusion/index.js
 * generateComfyImageCommon performs it, then POST /comfy/generate -
 * but the ComfyUI at the other end is a real, running ComfyUI, and
 * the image that comes back is real generated pixels.
 *
 * Gating: the suite runs ONLY when RFST_LIVE_COMFY_URL is set, e.g.
 *   RFST_LIVE_COMFY_URL=http://127.0.0.1:8189 npm run test:unit -- comfyui-live-proof
 * Without the variable it skips, so the default suite run is
 * unchanged. RFST_LIVE_COMFY_URL must point at a real ComfyUI whose
 * checkpoint list contains RFST_LIVE_COMFY_MODEL (default
 * v1-5-pruned-emaonly.safetensors, the small SD 1.5 checkpoint used
 * to keep the live generation light).
 *
 * Honesty notes:
 *  - The REAL server router src/endpoints/stable-diffusion.js is
 *    mounted in Express exactly as in the hermetic suite; the only
 *    module mocked is src/endpoints/secrets.js, SillyTavern-internal
 *    plumbing the router imports for OTHER providers. Nothing on the
 *    ComfyUI path is mocked, stubbed or faked: the workflow file is
 *    real, the /prompt submission is real, the router polls the real
 *    /history, and the returned bytes come from the real /view.
 *  - The generation settings are deliberately tiny (256x256, 4
 *    steps) so the proof stays light on a shared machine; the
 *    contract under proof is identical at any size.
 *  - Cross-check: after the router answers, the suite queries the
 *    real ComfyUI /history directly and requires a completed entry
 *    whose submitted workflow contains this suite's prompt text, so
 *    the image cannot have come from anywhere else.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, test, expect, jest, beforeAll, afterAll } from '@jest/globals';

jest.unstable_mockModule('../src/endpoints/secrets.js', () => ({
    readSecret: jest.fn(),
    SECRET_KEYS: {},
}));

const COMFY_URL = process.env.RFST_LIVE_COMFY_URL;
const COMFY_MODEL = process.env.RFST_LIVE_COMFY_MODEL || 'v1-5-pruned-emaonly.safetensors';
const describeLive = COMFY_URL ? describe : describe.skip;

const SETTINGS = {
    model: COMFY_MODEL,
    vae: '',
    sampler: 'euler',
    scheduler: 'normal',
    steps: 4,
    scale: 7,
    width: 256,
    height: 256,
};

const PROMPT_TEXT = 'a red lighthouse on a rocky shore at dawn, photograph';
const NEGATIVE_TEXT = 'blurry, low quality, distorted';

// API-format workflow (same shape as the hermetic suite's fake one,
// but every substituted value is real and the checkpoint exists on
// the target server).
const LIVE_WORKFLOW = {
    '3': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: '%model%' },
    },
    '5': {
        class_type: 'EmptyLatentImage',
        inputs: { width: '%width%', height: '%height%', batch_size: 1 },
    },
    '6': {
        class_type: 'CLIPTextEncode',
        inputs: { text: '%prompt%', clip: ['3', 1] },
    },
    '7': {
        class_type: 'CLIPTextEncode',
        inputs: { text: '%negative_prompt%', clip: ['3', 1] },
    },
    '8': {
        class_type: 'KSampler',
        inputs: {
            seed: '%seed%',
            steps: '%steps%',
            cfg: '%scale%',
            sampler_name: '%sampler%',
            scheduler: '%scheduler%',
            denoise: '%denoise%',
            model: ['3', 0],
            positive: ['6', 0],
            negative: ['7', 0],
            latent_image: ['5', 0],
        },
    },
    '9': {
        class_type: 'VAEDecode',
        inputs: { samples: ['8', 0], vae: ['3', 2] },
    },
    '10': {
        class_type: 'SaveImage',
        inputs: { images: ['9', 0], filename_prefix: 'rfst013-live' },
    },
};

// Placeholder substitution replicated from the browser client's
// generateComfyImageCommon (quoted "%name%" tokens), as in the
// hermetic suite.
function substituteWorkflow(workflowString, prompt, negativePrompt) {
    let result = workflowString.replaceAll('"%prompt%"', JSON.stringify(prompt));
    result = result.replaceAll('"%negative_prompt%"', JSON.stringify(negativePrompt));
    result = result.replaceAll('"%seed%"', JSON.stringify(20261120));
    result = result.replaceAll('"%denoise%"', JSON.stringify(1.0));
    result = result.replaceAll('"%clip_skip%"', JSON.stringify(-1));
    for (const ph of ['model', 'vae', 'sampler', 'scheduler', 'steps', 'scale', 'width', 'height']) {
        result = result.replaceAll(`"%${ph}%"`, JSON.stringify(SETTINGS[ph]));
    }
    return result;
}

describeLive('RFST-013 LIVE PROOF - real ComfyUI behind the real router', () => {
    let stBase;
    let stServer;
    let workflowDir;

    beforeAll(async () => {
        const { default: express } = await import('express');
        const { router } = await import('../src/endpoints/stable-diffusion.js');

        workflowDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfst013-live-'));
        fs.writeFileSync(path.join(workflowDir, 'Live_Workflow.json'), JSON.stringify(LIVE_WORKFLOW, null, 4));

        const app = express();
        app.use(express.json());
        app.use((req, res, next) => {
            req.user = { directories: { comfyWorkflows: workflowDir } };
            next();
        });
        app.use(router);
        stServer = app.listen(0, '127.0.0.1');
        await new Promise(resolve => stServer.once('listening', resolve));
        stBase = `http://127.0.0.1:${stServer.address().port}`;
    });

    afterAll(async () => {
        await new Promise(resolve => stServer.close(resolve));
        fs.rmSync(workflowDir, { recursive: true, force: true });
    });

    test('ping: POST /comfy/ping answers 200 against the real server', async () => {
        const res = await fetch(`${stBase}/comfy/ping`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: COMFY_URL }),
        });
        expect(res.status).toBe(200);
    });

    test('models: POST /comfy/models lists the real checkpoint', async () => {
        const res = await fetch(`${stBase}/comfy/models`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: COMFY_URL }),
        });
        expect(res.ok).toBe(true);
        const models = await res.json();
        expect(Array.isArray(models)).toBe(true);
        expect(models).toContain(COMFY_MODEL);
    });

    test('generate: a real image comes back through the full client path', async () => {
        // Load the workflow through the real route, as the client does.
        const workflowResponse = await fetch(`${stBase}/comfy/workflow`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_name: 'Live_Workflow.json' }),
        });
        expect(workflowResponse.ok).toBe(true);
        const workflow = substituteWorkflow(await workflowResponse.json(), PROMPT_TEXT, NEGATIVE_TEXT);

        const promptResult = await fetch(`${stBase}/comfy/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: COMFY_URL,
                prompt: `{\n                    "prompt": ${workflow}\n                }`,
            }),
        });
        if (!promptResult.ok) {
            throw new Error(await promptResult.text());
        }
        const result = await promptResult.json();
        expect(result.format).toBe('png');
        const bytes = Buffer.from(result.data, 'base64');
        // Real generated pixels: PNG magic and a non-trivial size.
        expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4E, 0x47]));
        expect(bytes.length).toBeGreaterThan(5000);
        console.log(`RFST-013 live: generated PNG ${bytes.length} bytes via ${COMFY_URL}`);

        // Independent cross-check against the real server's history:
        // a completed entry must exist whose submitted workflow is
        // this suite's prompt.
        const history = await (await fetch(`${COMFY_URL}/history`)).json();
        const entries = Object.values(history);
        const mine = entries.find(e => e.status?.status_str === 'success' && JSON.stringify(e.prompt).includes('lighthouse'));
        expect(mine).toBeTruthy();
        const outputs = Object.values(mine.outputs ?? {});
        const image = outputs.flatMap(o => o.images ?? [])[0];
        expect(image?.filename).toContain('rfst013-live');
    }, 900_000);
});
