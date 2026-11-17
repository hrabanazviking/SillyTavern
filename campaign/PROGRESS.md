# Progress ledger — RuneForgeAI SillyTavern campaign

House-only file (never donated). Kept current by every builder and
by the 10-minute keeper minder, in the same commits that bank work.
Roadmap: `ROADMAP_RuneForgeAI_Distributed_Companion.md` on this
branch. Campaign home: purplelongship `~/sillytavern-forge`.

## Work packages (roadmap section 14)

| ID | Pri | Package | Status |
| --- | --- | --- | --- |
| RFST-001 | P0 | Fork baseline and upstream-diff audit | DONE 2026-11-17 (repo-side audit; Windows launch GATED) |
| RFST-002 | P0 | Backup/restore and public repo exclusion rules | DONE 2026-11-17 (repo-side); Windows backup/restore drill GATED |
| RFST-003 | P0 | Gufo readiness + model capability probe | DONE 2026-11-17 (local Z13 endpoint + manifest validated; cross-device probe GATED) |
| RFST-004 | P0 | Gufo streaming chat-completion integration | DONE 2026-11-17 (local endpoint; cross-device GATED) |
| RFST-005 | P0 | Preserve raw roleplay/emotes end-to-end | QUEUED |
| RFST-006 | P0 | AllTalk V2 remote G14 connection | QUEUED |
| RFST-007 | P0 | TTS text segmentation, non-destructive narration | QUEUED |
| RFST-008 | P1 | STT backends benchmark on Z13 | QUEUED |
| RFST-009 | P1 | Push-to-talk and transcript correction | QUEUED |
| RFST-010 | P0 | Discover second-brain query schema | QUEUED |
| RFST-011 | P0 | Read-only all-collections gateway | QUEUED |
| RFST-012 | P0 | Global zero-config RAG injection | QUEUED |
| RFST-013 | P1 | ComfyUI remote endpoint baseline | QUEUED |
| RFST-014 | P1 | Image model/workflow inventory and benchmarks | QUEUED |
| RFST-015 | P1 | Automatic image workflow router | QUEUED |
| RFST-016 | P1 | ComfyUI unload-on-idle lifecycle | QUEUED |
| RFST-017 | P1 | Resource-aware queues and cancellation | QUEUED |
| RFST-018 | P1 | Global integration status/settings panel | QUEUED |
| RFST-019 | P1 | Network and transport hardening | QUEUED |
| RFST-020 | P1 | Integration tests across all three computers | QUEUED |
| RFST-021 | P1 | Update/merge compatibility harness | QUEUED |
| RFST-022 | P2 | Optional hands-free VAD / barge-in | QUEUED |
| RFST-023 | P2 | Optional context-sensitive image suggestions | QUEUED |
| RFST-024 | P2 | Multi-character voice routing refinements | QUEUED |
| RFST-025 | P2 | Packaging and one-click local diagnostics | QUEUED |

## Release gates (roadmap section 16)

| Gate | Name | Status |
| --- | --- | --- |
| A | Text baseline | OPEN |
| B | Natural voice | OPEN |
| C | Shared knowledge | OPEN |
| D | Media | OPEN |
| E | Daily-driver reliability | OPEN |
| F | Public fork readiness | OPEN |

## Notes

- 2026-11-17: campaign stood up by Yrsa at Volmarr's order;
  roadmap adopted as written; minder `sillytavern-forge-keeper`
  created; first builder dispatched for campaign setup +
  RFST-001.

- 2026-11-17: **RFST-001 DONE (repo-side audit)** — first builder,
  purplelongship clone `~/sillytavern-forge`, branch
  `yrsa/our-sillytavern`.
  - **Pinned baseline:** HEAD `991372e54afe55645c0cf30e436110e2ff302246`
    (`git describe`: `1.19.0-6-g991372e54`); SillyTavern **1.19.0**
    (package.json), license **AGPL-3.0**; Node.js **v22.22.1** on
    purplelongship; git 2.53.0.
  - **Upstream divergence: zero code divergence.** Upstream
    `SillyTavern/SillyTavern` `release` HEAD is `06bde939f` — the
    exact fork point (merge-base = upstream HEAD; upstream had not
    advanced past the fork point at audit time). Our branch is
    **5 ahead / 0 behind**; all 5 commits are docs-only (charter,
    roadmap, campaign stand-up + 2 PR merges). Diff from fork
    point: exactly 4 files, all house documents (ROADMAP, charter,
    campaign/PROGRESS.md, campaign/STATE.md), 1,110 insertions,
    **no source file modified**. The fork's own `release` branch
    is 3 ahead / 0 behind (house docs via PRs).
  - **Branches in the fork:** `release` (default), `staging`,
    `yrsa/our-sillytavern`, plus upstream-inherited topic branches
    (copilot/*, feat/*, fix/*, stats-2.0). 103 tags; latest 1.19.0.
  - **Integration points (roadmap section 2): all 15 verified
    present** — public/scripts/openai.js (7,396 lines),
    src/endpoints/openai.js (929), tts/alltalk.js (1,076; default
    endpoint `http://localhost:7851` confirmed at line 16),
    tts/index.js (1,622), stable-diffusion/index.js (5,998),
    comfyWorkflowEditor.html, src/endpoints/stable-diffusion.js
    (2,215), src/endpoints/speech.js (432), extensions.js,
    events.js, st-context.js, tool-calling.js, world-info.js
    (6,408), message-formatter.js, src/plugin-loader.js (server
    plugins confirmed OFF by default: `enableServerPlugins`
    defaults false, line 10). Built-in extensions: 15 folders
    under public/scripts/extensions/ (assets, attachments,
    caption, connection-manager, expressions, gallery, memory,
    quick-reply, regex, stable-diffusion, third-party (empty),
    token-counter, translate, tts, vectors) + shared.js.
  - **Test patterns:** root package.json carries lint only
    (eslint); tests/ is its own package — Jest unit tests
    (`node --experimental-vm-modules jest`, jest.config.json;
    suites incl. stable-diffusion, prompt-converters,
    chat-integrity, private-request-filter, extensions-discover)
    + Playwright e2e (tests/frontend/*.e2e.js, incl.
    MessageFormatter and WorldInfoRename suites). The full
    upstream suite was NOT run in this audit; the known-failure
    baseline is still to be recorded at first full run (roadmap
    section 5).
  - **Launch smoke (Linux stand-in, PASSED):** `npm install`
    (829 packages, TMPDIR on disk at ~/st-tmp — the laptop /tmp
    is 95% full), then `node server.js --port 18250 --dataRoot
    ~/st-smoke-data --configPath ~/st-smoke-config.yaml` gave
    HTTP 200 with the SillyTavern UI title, listening on
    127.0.0.1 only; server stopped after the check; working tree
    left clean.
  - **GATED (not done):** the roadmap section 5/14 Windows items
    — tested Windows launch, reference chat, character-card
    storage confirmation on the F15 — wait on that machine
    waking. Recorded as GATED, never as done.
- 2026-11-17: **RFST-002 repo-side DONE; drill GATED.**
  - Tracked-file audit (1,014 files): `data/` tracks only
    `.gitkeep`; **no `.jsonl` tracked anywhere**; no chats,
    characters, credentials, tokens, keys, or model files
    (.gguf/.safetensors/.ckpt) tracked. Name-scan hits were only
    upstream UI files (secretKeyManager templates, secrets.css).
    `default/` content is upstream's stock samples (Seraphina
    sample character, Eldoria world, default workflows, presets,
    themes) — not owner data.
  - **Exclusion rules (.gitignore, upstream, verified in
    place):** `/data` (modern per-user data root); legacy
    public/ user dirs (chats, characters, User Avatars,
    backgrounds, groups, group chats, worlds, user, themes,
    settings preset dirs, QuickReplies, movingUI, assets);
    `*.jsonl`; `/config.yaml`; `/config.conf`; `secrets.json`;
    `.env`; `/backups/`; `/certs`; `/uploads/`; `/vectors/`;
    `/cache/`; `/thumbnails`; `whitelist.txt`; `node_modules/`;
    `plugins/`.
  - **House rule going forward:** the pre-push hygiene scan
    (campaign/STATE.md) runs before every push; any new
    user-data path must be confirmed ignored (`git check-ignore`)
    before work near it is banked.
  - **GATED (not done):** the Windows user-data backup/restore
    drill (roadmap section 5 acceptance) — environment-gated on
    the F15. Recorded as GATED, never as done.
- 2026-11-17: **Phase-1 question logged (no action taken):** our
  modified Gufo's resident service on purpleraider binds loopback
  `127.0.0.1:11435` today, so the F15 (Windows) cannot reach it
  across the tailnet as-is. Roadmap Phase 1 (RFST-003/004) needs
  a cross-device reach design (tailnet-facing bind or relay,
  weighed against roadmap section 19 tailnet-only hardening and
  the section 1 local-first rule). Flagged for the RFST-003/004
  design; **no service was reconfigured.**

- 2026-11-17: **RFST-003 DONE (local endpoint); cross-device GATED.**
  Keeper probe of the real Z13 Gufo, read-only, no service changed.
  - **Service:** `gufo-resident.service` active on purpleraider
    since 2026-11-17 05:20 EST; supervisor 1.0.0; version string
    `resident 1.0.0 / gufo development (4f73737)`; bind is
    loopback-only `127.0.0.1:11435`; lazy-loading, idle unload
    1200 s, child port 18100. (Stock Ollama also listens on
    11434, version 0.40.16 - a separate service, not this one.)
  - **Model manifest (validated real):** exactly one model -
    `gemma-4-26B-A4B-it-heretic.Q8_0`, GGUF, family gemma,
    Q8_0, 26,859,855,008 bytes on disk in the Gufo models dir.
    `GET /v1/models` 200 lists it; `GET /api/tags` agrees.
  - **Readiness semantics differ from upstream Gufo docs:**
    `GET /ready` and `GET /health` both return **404** on this
    resident build. Readiness must be probed via `GET /`
    (200, `Gufo is running`), `GET /v1/models`, and
    `GET /api/ps` (empty list = no model resident; after the
    probe completion it showed the model resident with an
    expiry, per the idle-unload lifecycle).
  - **Real completion validated:** `POST /v1/chat/completions`,
    non-streaming, temperature 0, max_tokens 16, prompt asking
    for exactly `probe ok` - returned exactly `probe ok`,
    finish_reason stop, HTTP 200 in ~6.6 s, with full usage
    counts (77 prompt / 2 completion tokens).
  - **Capability / error behaviour:** unknown model id returns
    HTTP 404 `invalid_request_error`; unsupported field
    `logit_bias` returns HTTP **400** with code
    `unsupported_sampling` - the roadmap section 6 warning is
    real on this build, so RFST-004 must strip/translate
    unsupported fields in the adapter, never pass them through.
  - **GATED (not done):** cross-device reach. The loopback-only
    bind means no other machine can reach this endpoint today,
    and the G14 tailnet client is logged out, so no LAN/tailnet
    probe was possible from purplelongship; the from-Windows
    probe waits on the F15. This is the Phase-1 question logged
    under RFST-002, now confirmed by direct probe. No bind or
    service change was made - that decision is RFST-004 design
    work, weighed against section 19 tailnet-only hardening.
  - Streaming + cancellation remain RFST-004, not claimed here.
- 2026-11-17: **RFST-004 DONE (local endpoint); cross-device GATED.**
  Real streaming probes against the local Z13 Gufo on purpleraider
  (read-only/generation-only, no service changed), logs in
  ~/st-tmp/rfst004_probe.log + rfst004_rec.log on purpleraider.
  - **Streaming (a):** POST /v1/chat/completions, stream=true,
    long character system prompt (Sigrun shield-maiden card,
    ~1,600 chars, repeated traits). **157 SSE chunks**, first
    chunk at **0.016 s**, total **8.33 s**, finish_reason
    **stop**, assembled **657 chars**, coherent and
    character-specific (addressed user as "wanderer", named
    Bjorn, the fjord, and the three boats lost to the ice).
  - **Unsupported field under streaming (c):** same request
    plus `logit_bias` returned HTTP **400** with body
    `{"error":{"message":"request field 'logit_bias' is not supported","type":"invalid_request_error","code":"unsupported_sampling"}}`
    - a readable diagnostic, prompt not corrupted. SillyTavern
    side: `forwardFetchResponse` (src/util.js) forwards that
    status + body to the client; the CUSTOM chat-completion
    path (src/endpoints/backends/chat-completions.js) passes
    `logit_bias` through, and the existing
    `custom_exclude_body` mechanism is the documented way to
    strip it for Gufo - no new adapter code was proven
    necessary this package, so none was invented.
  - **Cancellation (b):** long streaming generation aborted
    client-side after **5 chunks at 0.23 s**. An immediate
    follow-up completion returned HTTP **502** (Gufo tears
    down / unloads the model on abort: GET /api/ps was empty
    afterwards), but recovery is bounded, not permanent:
    polling showed HTTP **200 at 11.2 s** returning exactly
    `probe ok`; a later retry series went **3/3 HTTP 200**
    (first reload 5.74 s, then 0.46 s / 0.48 s). Next turn is
    not permanently broken; there is a transient ~11 s
    reload window after an abort. ST server side already
    aborts the upstream fetch on client socket close
    (AbortController in chat-completions.js).
  - **Code-path checks (purplelongship, no code changed):**
    CUSTOM source is the configured path (custom_url, no
    automatic cloud fallback in that branch); text generation
    path is independent of TTS/STT/ComfyUI/second-brain code.
    Jest suites were NOT run: tests/node_modules is not
    installed in the clone and an npx fallback failed on ESM
    loading - recorded as not run, not as passed.
  - **GATED (not done):** cross-device streaming from
    purplelongship / the F15 and the Windows UI checks -
    the loopback-only bind (RFST-002/003 Phase-1 question)
    still prevents them; no bind or service change was made.
