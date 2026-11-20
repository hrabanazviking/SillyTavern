/**
 * RFST-016 LIVE PROOF - ComfyUI unload-on-idle lifecycle, against a
 * REAL ComfyUI server. The hermetic suite
 * (tests/comfyui-idle-lifecycle.test.js) proved the lifecycle core
 * against a mock client with an injected clock; this suite proves
 * the same production core against the real thing: a plain fetch
 * client speaking to a running ComfyUI's real GET /queue,
 * GET /system_stats and POST /free, bracketing a REAL generation
 * submitted to the real POST /prompt.
 *
 * Gating: runs ONLY when RFST_LIVE_COMFY_URL is set, e.g.
 *   RFST_LIVE_COMFY_URL=http://127.0.0.1:8189 npm run test:unit -- comfyui-idle-lifecycle-live-proof
 * Without the variable it skips, so the default suite run is
 * unchanged. The target server must be quiet (empty queue) when the
 * suite starts; the suite refuses to run against a busy server
 * rather than disturb someone else's job.
 *
 * Honesty notes:
 *  - Nothing is mocked: the core under proof is the production
 *    module src/media/comfyui-idle-lifecycle-core.js, the client is
 *    real fetch calls, the clock is the real wall clock, and the
 *    unload is a real POST /free with unload_models + free_memory.
 *  - Tolerance: the hermetic suite's default toleranceBytes is
 *    64 MiB, sized for a dedicated GPU whose VRAM only the server
 *    moves. This proof ran against a CPU-mode ComfyUI on a shared
 *    128 GB host, where /system_stats reports SYSTEM RAM as the
 *    device memory and other live workloads move it by hundreds of
 *    MiB. The suite therefore passes an explicit toleranceBytes of
 *    1 GiB and documents why; the verified claim is unchanged: after
 *    the unload, free memory returns to the pre-generation baseline
 *    within tolerance, the queue is empty, the server is alive, and
 *    a repeat tick does not unload twice.
 *  - The generation is deliberately tiny (256x256, 4 steps, the
 *    small SD 1.5 checkpoint v1-5-pruned-emaonly.safetensors) so the
 *    proof stays light on a shared machine.
 */
import { describe, test, expect, beforeAll } from '@jest/globals';

import { createIdleLifecycleManager } from '../src/media/comfyui-idle-lifecycle-core.js';

const COMFY_URL = process.env.RFST_LIVE_COMFY_URL;
const describeLive = COMFY_URL ? describe : describe.skip;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function createRealComfyClient(baseUrl) {
    return {
        async getQueue() {
            const res = await fetch(`${baseUrl}/queue`);
            if (!res.ok) throw new Error(`ComfyUI /queue failed: ${res.status}`);
            return res.json();
        },
        async getSystemStats() {
            const res = await fetch(`${baseUrl}/system_stats`);
            if (!res.ok) throw new Error(`ComfyUI /system_stats failed: ${res.status}`);
            return res.json();
        },
        async free(body) {
            return fetch(`${baseUrl}/free`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        },
    };
}

const WORKFLOW = {
    '3': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'v1-5-pruned-emaonly.safetensors' } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 256, height: 256, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { text: 'a wooden rowing boat on a still lake, photograph', clip: ['3', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, low quality', clip: ['3', 1] } },
    '8': {
        class_type: 'KSampler',
        inputs: {
            seed: 20261121, steps: 4, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1.0,
            model: ['3', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
        },
    },
    '9': { class_type: 'VAEDecode', inputs: { samples: ['8', 0], vae: ['3', 2] } },
    '10': { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: 'rfst016-live' } },
};

describeLive('RFST-016 LIVE PROOF - real unload-on-idle against a real ComfyUI', () => {
    let client;

    beforeAll(() => {
        client = createRealComfyClient(COMFY_URL);
    });

    test('real generation, real idle unload, memory returns to baseline', async () => {
        const queue0 = await client.getQueue();
        expect(queue0.queue_running).toHaveLength(0);
        expect(queue0.queue_pending).toHaveLength(0);

        const manager = createIdleLifecycleManager({
            client,
            idleTimeoutMs: 5_000,
            toleranceBytes: 1024 * 1024 * 1024,
        });

        // First tick captures the idle baseline on the quiet server.
        const first = await manager.tick();
        expect(first.action).not.toBe('error');
        expect(first.baselineCaptured).toBe(true);
        const stats0 = await client.getSystemStats();
        const baselineFree = stats0.devices[0].vram_free;
        console.log(`RFST-016 live: baseline free ${baselineFree}`);

        // A real job, bracketed the way production brackets a
        // generation.
        manager.jobStarted();
        expect(manager.getSnapshot().state).toBe('busy');
        const promptRes = await fetch(`${COMFY_URL}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: WORKFLOW, client_id: 'rfst016-live-proof' }),
        });
        expect(promptRes.ok).toBe(true);
        const { prompt_id: promptId } = await promptRes.json();
        expect(typeof promptId).toBe('string');

        // Poll the real history until the job completes.
        let entry = null;
        const deadline = Date.now() + 600_000;
        while (Date.now() < deadline) {
            const history = await (await fetch(`${COMFY_URL}/history/${promptId}`)).json();
            if (history[promptId]) {
                entry = history[promptId];
                break;
            }
            await sleep(2_000);
        }
        expect(entry).toBeTruthy();
        expect(entry.status.status_str).toBe('success');
        const statsBusy = await client.getSystemStats();
        console.log(`RFST-016 live: free after generation ${statsBusy.devices[0].vram_free}`);
        manager.jobFinished();

        // Inside the grace period the manager waits.
        const early = await manager.tick();
        expect(early.action).toBe('wait');
        expect(early.state).toBe('cooling');

        // Past the idle timeout the manager unloads for real.
        await sleep(6_000);
        const fired = await manager.tick();
        expect(fired.action).toBe('unloaded');
        expect(fired.verified).toBe(true);
        expect(fired.state).toBe('idle');
        expect(manager.getSnapshot().unloadCount).toBe(1);
        console.log(`RFST-016 live: unload verified, free now ${fired.vramFree} (baseline ${fired.baselineVramFree})`);

        // Independent corroboration, straight from the real server.
        const queueAfter = await client.getQueue();
        expect(queueAfter.queue_running).toHaveLength(0);
        expect(queueAfter.queue_pending).toHaveLength(0);
        const statsAfter = await client.getSystemStats();
        expect(statsAfter.devices[0].vram_free).toBeGreaterThanOrEqual(baselineFree - 1024 * 1024 * 1024);

        // A repeat tick does not unload a second time.
        const again = await manager.tick();
        expect(again.action).toBe('none-already-idle');
        expect(manager.getSnapshot().unloadCount).toBe(1);
    }, 900_000);
});
