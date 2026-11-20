/**
 * RFST-022 LIVE PROOF - hands-free VAD / barge-in, against the REAL
 * speech services. The hermetic suite (tests/hands-free.test.js)
 * proved the session core against mock VAD frames, a mock STT
 * client and a mock playback host; this suite proves the same
 * production core with every collaborator real:
 *
 *  - Speech audio is synthesized by the REAL AllTalk TTS server
 *    (RFST_LIVE_TTS_URL, its /api/tts-generate with the XTTS model)
 *    - the user's two utterances and the assistant's reply are all
 *    real generated speech, written to real WAV files.
 *  - VAD frames are computed from those real WAV files (peak level
 *    per 20 ms frame) and fed in real time. Frame levels are the
 *    microphone signal a real client would measure; a per-file gain
 *    normalisation stands in for ordinary microphone gain
 *    calibration, and the playback-echo frames are fed at reduced
 *    gain, as a microphone hears a speaker across a room.
 *  - The STT client is a real adapter to the REAL whisper service
 *    (RFST_LIVE_STT_URL): it POSTs the utterance's real recorded
 *    WAV as multipart form data to the whisper.cpp server's
 *    /inference route and returns the real transcript.
 *  - Playback is a real audio player process (ffplay) playing the
 *    real reply WAV through a real PulseAudio null sink created
 *    for the proof; stop() really kills the player, and the suite
 *    verifies the process is gone, not just that a flag flipped.
 *
 * Gating: runs ONLY when both RFST_LIVE_STT_URL and
 * RFST_LIVE_TTS_URL are set, e.g.
 *   RFST_LIVE_STT_URL=http://100.77.167.10:8080 RFST_LIVE_TTS_URL=http://127.0.0.1:7851 \
 *     npm run test:unit -- hands-free-live-proof
 * Without them it skips, so the default suite run is unchanged.
 *
 * What is proven live: a full spoken turn (VAD opens on real
 * speech, hangover bridges the gaps, the closed utterance is
 * transcribed exactly once by the real whisper service, the
 * transcript sends exactly once, history is never written); echo
 * suppression while real playback is sounding; and a real barge-in
 * (sustained loud speech during playback stops the real player
 * exactly once, after which the interrupting utterance is itself
 * transcribed by the real service and sent).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';

import { createHandsFreeSession } from '../src/voice/hands-free-core.js';

const execFileP = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const STT_URL = process.env.RFST_LIVE_STT_URL;
const TTS_URL = process.env.RFST_LIVE_TTS_URL;
const describeLive = (STT_URL && TTS_URL) ? describe : describe.skip;

const PULSE_ENV = { ...process.env, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || '/run/user/1000' };
const SINK_NAME = 'rfst022_null';

const USER_TEXT_1 = 'The quick brown fox jumps over the lazy dog.';
const USER_TEXT_2 = 'Wait, stop there, and tell me about the weather instead.';
const REPLY_TEXT = 'Certainly. The tide tables for the harbour show high water at six in the morning, and the wind should stay light until noon, so the crossing ought to be calm and pleasant for everyone aboard the boat today.';

const SAMPLE_HISTORY = [
    { speaker: 'User', text: 'sample history entry one' },
    { speaker: 'Assistant', text: 'sample history entry two' },
];

// --- WAV reading: peak level per 20 ms frame -----------------------

function readWavFrames(file) {
    const buf = fs.readFileSync(file);
    let fmt = null;
    let data = null;
    let off = 12;
    while (off + 8 <= buf.length) {
        const id = buf.toString('ascii', off, off + 4);
        const size = buf.readUInt32LE(off + 4);
        if (id === 'fmt ') {
            fmt = {
                channels: buf.readUInt16LE(off + 10),
                sampleRate: buf.readUInt32LE(off + 12),
                bitsPerSample: buf.readUInt16LE(off + 22),
            };
        }
        if (id === 'data') {
            data = buf.subarray(off + 8, off + 8 + size);
        }
        off += 8 + size + (size % 2);
    }
    if (!fmt || !data || fmt.bitsPerSample !== 16) {
        throw new Error(`Unsupported WAV shape in ${file}`);
    }
    const bytesPerSample = 2 * fmt.channels;
    const frameSamples = Math.round(fmt.sampleRate * 0.02);
    const totalSamples = Math.floor(data.length / bytesPerSample);
    const frames = [];
    for (let s = 0; s < totalSamples; s += frameSamples) {
        let peak = 0;
        const end = Math.min(totalSamples, s + frameSamples);
        for (let i = s; i < end; i++) {
            for (let ch = 0; ch < fmt.channels; ch++) {
                const v = Math.abs(data.readInt16LE(i * bytesPerSample + ch * 2));
                if (v > peak) peak = v;
            }
        }
        frames.push({ level: Math.min(1, peak / 32768) });
    }
    return frames;
}

function peakLevel(frames) {
    return frames.reduce((m, f) => Math.max(m, f.level), 0);
}

function silenceFrames(ms) {
    return Array.from({ length: Math.round(ms / 20) }, () => ({ level: 0 }));
}

// --- Real services --------------------------------------------------

async function ttsGenerate(text, name, voice, workDir) {
    // The real AllTalk API declares form fields (its own web UI
    // posts form data); a JSON body is answered 422 with every
    // field "missing" - found by this suite's first live run.
    const form = new URLSearchParams({
        text_input: text,
        text_filtering: 'standard',
        character_voice_gen: voice,
        narrator_enabled: 'false',
        narrator_voice_gen: voice,
        text_not_inside: 'character',
        language: 'en',
        file_name_gen: name,
        output_file_name: name,
        output_file_timestamp: String(Date.now()),
        autoplay: 'false',
        autoplay_volume: '0.8',
    });
    const res = await fetch(`${TTS_URL}/api/tts-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
    });
    if (!res.ok) {
        throw new Error(`AllTalk /api/tts-generate failed: ${res.status} ${await res.text()}`);
    }
    const json = await res.json();
    const url = json.output_file_url;
    if (typeof url !== 'string' || !url) {
        throw new Error(`AllTalk returned no output_file_url: ${JSON.stringify(json)}`);
    }
    if (url.startsWith('file://')) {
        return new URL(url).pathname;
    }
    if (url.startsWith('http')) {
        const audio = await fetch(url);
        if (!audio.ok) throw new Error(`Fetching generated audio failed: ${audio.status}`);
        const target = path.join(workDir, `${name}.wav`);
        fs.writeFileSync(target, Buffer.from(await audio.arrayBuffer()));
        return target;
    }
    return url;
}

async function transcribeWav(wavPath) {
    const form = new FormData();
    form.set('file', new Blob([fs.readFileSync(wavPath)], { type: 'audio/wav' }), path.basename(wavPath));
    form.set('response_format', 'json');
    const res = await fetch(`${STT_URL}/inference`, { method: 'POST', body: form });
    if (!res.ok) {
        throw new Error(`whisper /inference failed: ${res.status} ${await res.text()}`);
    }
    const json = await res.json();
    return (json.text || '').trim();
}

// --- Real playback: ffplay through a PulseAudio null sink ----------

function createRealPlayback() {
    let proc = null;
    let exited = true;
    let stopCalls = 0;
    return {
        play(file) {
            exited = false;
            proc = spawn('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', file], {
                env: { ...PULSE_ENV, PULSE_SINK: SINK_NAME },
            });
            proc.on('exit', () => { exited = true; });
        },
        isPlaying() {
            return !!proc && !exited;
        },
        stop() {
            stopCalls++;
            if (proc && !exited) {
                proc.kill('SIGTERM');
            }
        },
        get stopCalls() { return stopCalls; },
        async waitForExit(timeoutMs) {
            const deadline = Date.now() + timeoutMs;
            while (!exited && Date.now() < deadline) {
                await sleep(50);
            }
            return exited;
        },
    };
}

// --- Session harness -------------------------------------------------

function makeSession(playback) {
    const clock = { t: 1_000_000 };
    const sent = [];
    const barges = [];
    let currentWav = null;
    const session = createHandsFreeSession({
        client: {
            transcribe: async () => ({ text: await transcribeWav(currentWav) }),
        },
        playback,
        history: SAMPLE_HISTORY.map(h => ({ ...h })),
        onSend: payload => sent.push(payload),
        onBargeIn: payload => barges.push(payload),
        now: () => clock.t,
    });
    return { session, clock, sent, barges, setWav: w => { currentWav = w; } };
}

async function feed(session, clock, frames, { gain = 1, from = 0, to = frames.length } = {}) {
    const results = [];
    const startWall = Date.now();
    for (let i = from; i < to; i++) {
        clock.t += 20;
        results.push(session.ingestFrame({ level: Math.min(1, frames[i].level * gain), at: clock.t }));
        const target = startWall + (i - from + 1) * 20;
        const wait = target - Date.now();
        if (wait > 0) {
            await sleep(wait);
        }
    }
    return results;
}

function eventTypes(results) {
    return results.map(r => r?.event).filter(Boolean);
}

describeLive('RFST-022 LIVE PROOF - real TTS, real whisper STT, real playback', () => {
    let workDir;
    let sinkModule = null;
    let user1Wav;
    let user2Wav;
    let replyWav;
    let user1Frames;
    let user2Frames;
    let replyFrames;
    let user1Gain;
    let user2Gain;

    beforeAll(async () => {
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfst022-live-'));

        // A real (null) audio sink for the proof's playback.
        const loaded = await execFileP('pactl', ['load-module', 'module-null-sink', `sink_name=${SINK_NAME}`, 'sink_properties=device.description=RFST022Null'], { env: PULSE_ENV });
        sinkModule = loaded.stdout.trim();

        // The real TTS server must be ready, with a real voice.
        const ready = await (await fetch(`${TTS_URL}/api/ready`)).text();
        expect(ready).toContain('Ready');
        const voicesJson = await (await fetch(`${TTS_URL}/api/voices`)).json();
        const flat = (Array.isArray(voicesJson) ? voicesJson : (voicesJson.voices || Object.values(voicesJson))).flat(Infinity);
        const voice = flat.find(v => typeof v === 'string' && v.endsWith('.wav'));
        expect(voice).toBeTruthy();
        console.log(`RFST-022 live: AllTalk voice ${voice}`);

        // Real speech for both user utterances and the reply.
        const rawUser1 = await ttsGenerate(USER_TEXT_1, 'rfst022-user1', voice, workDir);
        const rawUser2 = await ttsGenerate(USER_TEXT_2, 'rfst022-user2', voice, workDir);
        replyWav = await ttsGenerate(REPLY_TEXT, 'rfst022-reply', voice, workDir);

        // The whisper service's canonical input is 16 kHz mono WAV;
        // convert the utterances with the real ffmpeg. The frames
        // are measured from the same files the STT client sends.
        user1Wav = path.join(workDir, 'user1-16k.wav');
        user2Wav = path.join(workDir, 'user2-16k.wav');
        await execFileP('ffmpeg', ['-y', '-loglevel', 'error', '-i', rawUser1, '-ar', '16000', '-ac', '1', user1Wav]);
        await execFileP('ffmpeg', ['-y', '-loglevel', 'error', '-i', rawUser2, '-ar', '16000', '-ac', '1', user2Wav]);

        user1Frames = readWavFrames(user1Wav);
        user2Frames = readWavFrames(user2Wav);
        replyFrames = readWavFrames(replyWav);
        user1Gain = 0.99 / Math.max(peakLevel(user1Frames), 0.01);
        user2Gain = 0.99 / Math.max(peakLevel(user2Frames), 0.01);
        console.log(`RFST-022 live: frames user1=${user1Frames.length} user2=${user2Frames.length} reply=${replyFrames.length}`);

        // Warm the real whisper service (its model loads on first
        // call) and prove the road end to end before the turns.
        const warm = await transcribeWav(user1Wav);
        console.log(`RFST-022 live: whisper warm-up transcript: "${warm}"`);
        expect(warm.toLowerCase()).toContain('fox');
    }, 900_000);

    afterAll(async () => {
        if (sinkModule) {
            await execFileP('pactl', ['unload-module', sinkModule], { env: PULSE_ENV }).catch(() => {});
        }
        fs.rmSync(workDir, { recursive: true, force: true });
    });

    test('turn 1: real speech opens, closes, transcribes once, sends once', async () => {
        const playback = createRealPlayback();
        const h = makeSession(playback);
        h.setWav(user1Wav);
        h.session.enable();
        h.session.start();

        const fed = await feed(h.session, h.clock, user1Frames, { gain: user1Gain });
        await feed(h.session, h.clock, silenceFrames(1000));

        let snap = h.session.getSnapshot();
        expect(snap.state).toBe('utterance_ready');
        expect(snap.utteranceCount).toBe(1);
        expect(eventTypes(fed)).toContain('speech_started');
        expect(eventTypes(fed)).toContain('speech_ended');

        const heard = await h.session.transcribePending();
        expect(heard.ok).toBe(true);
        console.log(`RFST-022 live: turn 1 transcript: "${heard.transcript}"`);
        expect(heard.transcript.toLowerCase()).toContain('quick brown fox');

        const dup = await h.session.transcribePending();
        expect(dup.ok).toBe(false);
        expect(dup.reason).toBe('already_transcribed');

        const sentResult = await h.session.send();
        expect(sentResult.ok).toBe(true);
        expect(h.sent).toHaveLength(1);
        expect(h.sent[0].text).toBe(heard.transcript);

        const dupSend = await h.session.send();
        expect(dupSend.ok).toBe(false);
        expect(dupSend.reason).toBe('duplicate_send_rejected');
        expect(h.sent).toHaveLength(1);

        snap = h.session.getSnapshot();
        expect(snap.historyUnchanged).toBe(true);
        expect(snap.sent).toBe(true);
    }, 600_000);

    test('turn 2: echo is suppressed, then real speech barges in and stops playback', async () => {
        const playback = createRealPlayback();
        const h = makeSession(playback);
        h.setWav(user2Wav);
        h.session.enable();
        h.session.start();

        playback.play(replyWav);
        expect(playback.isPlaying()).toBe(true);

        // The microphone hears the reply itself, quietly: echo
        // frames in the speech band but far below barge-in level.
        const echoGain = 0.62 / Math.max(peakLevel(replyFrames), 0.01);
        const echoFed = await feed(h.session, h.clock, replyFrames, { gain: echoGain, to: Math.min(replyFrames.length, 90) });
        let snap = h.session.getSnapshot();
        expect(eventTypes(echoFed)).toContain('echo_suppressed');
        expect(snap.echoSuppressedFrames).toBeGreaterThan(0);
        expect(snap.bargeInCount).toBe(0);
        expect(playback.isPlaying()).toBe(true);

        // The user talks over the reply at full level: sustained
        // loud speech must barge in and stop the real player.
        const bargeFed = await feed(h.session, h.clock, user2Frames, { gain: user2Gain });
        snap = h.session.getSnapshot();
        expect(eventTypes(bargeFed)).toContain('barge_in');
        expect(snap.bargeInCount).toBe(1);
        expect(h.barges).toHaveLength(1);
        expect(playback.stopCalls).toBe(1);
        expect(await playback.waitForExit(5_000)).toBe(true);
        expect(playback.isPlaying()).toBe(false);

        await feed(h.session, h.clock, silenceFrames(1000));
        snap = h.session.getSnapshot();
        expect(snap.state).toBe('utterance_ready');

        const heard = await h.session.transcribePending();
        expect(heard.ok).toBe(true);
        console.log(`RFST-022 live: turn 2 transcript: "${heard.transcript}"`);
        expect(heard.transcript.toLowerCase()).toContain('weather');

        const sentResult = await h.session.send();
        expect(sentResult.ok).toBe(true);
        expect(h.sent).toHaveLength(1);
        expect(h.session.getSnapshot().historyUnchanged).toBe(true);
    }, 600_000);
});
