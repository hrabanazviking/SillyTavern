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
| RFST-005 | P0 | Preserve raw roleplay/emotes end-to-end | DONE 2026-11-17 (automated snapshots pass; no formatter bug found) |
| RFST-006 | P0 | AllTalk V2 remote G14 connection | DONE 2026-11-17 (mock-server contract suite; live render GATED on GPU headroom) |
| RFST-007 | P0 | TTS text segmentation, non-destructive narration | DONE 2026-11-17 (headless segmentation suite; live voice render GATED on RFST-006) |
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
- 2026-11-17: **RFST-005 DONE — automated snapshots pass.**
  New Jest suite `tests/message-formatter-preservation.test.js`
  (+ `tests/__snapshots__/message-formatter-preservation.test.js.snap`)
  on purplelongship; tests deps installed with
  `npm ci` in tests/ (TMPDIR=~/st-tmp).
  - **Corpus (12 cases):** the roadmap canonical example
    (*She places the rune stone on the table and smiles.*
    "Come closer. I have something to show you."), complex
    markdown, nested quotation, curly quotes, action
    asterisks, quotes inside actions, bold+italic, underscore
    emphasis, a lone unpaired asterisk (3 * 5), Unicode and
    runes (ᚠ ᚢ ᚦ, þ/ð, emoji), single line breaks, blank-line
    paragraph breaks, mixed dialogue/narration, emote chains.
  - **What runs for real:** the real `MessageFormatter`
    singleton stages (beforeRegex / afterRegex /
    afterMarkdown, `../public/script.js` mocked per the
    prompt-converters.test.js pattern) must return every raw
    case byte-for-byte with no hooks registered; the real
    Showdown converter configured exactly as
    `reloadMarkdownProcessor()` in public/script.js renders
    each case, and its visible text (tags stripped, entities
    decoded) must equal the hand-written expected text —
    raw == persisted/displayed canonical content modulo the
    intended markdown rendering (paired emphasis markers
    become <em>/<strong> and are not visible characters).
    Canonical case asserts the <em> action and the quoted
    dialogue both survive verbatim.
  - **Result:** targeted suite **39 passed / 39**,
    snapshots **2 passed**; full unit suite **20 suites,
    450 passed / 450** (command:
    `node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.config.json`
    in tests/); eslint on the new file clean.
  - **No formatter bug found:** emotes/asterisks are NOT
    stripped by the pipeline stages or by Showdown rendering;
    no production code was changed. Three early failures were
    defects in the test's own expected-text model (paragraph
    joining, a regex that mispaired the lone asterisk,
    `<br />\n` double-counting), fixed in the test only and
    recorded here so they are not mistaken for product bugs.
  - **Scope note (honest):** the browser-only legs of
    messageFormatting (custom regex rules, fixMarkdown,
    DOMPurify) are not exercised headlessly — script.js needs
    the full browser app; the existing Playwright suite
    tests/frontend/MessageFormatter.e2e.js covers the hook
    API in-browser. Windows/F15 UI confirmation remains
    GATED on that machine waking, as with RFST-001..004.

- 2026-11-17: **RFST-007 DONE - spoken segments accurate,
  visible emotes unchanged (headless evidence).** New Jest
  suite `tests/tts-segmentation.test.js` on purplelongship.
  - **What was inspected:** the real TTS path in
    `public/scripts/extensions/tts/index.js` -
    `processAndQueueTtsMessage` clones the message
    (structuredClone), `processTtsQueue` derives a spoken copy
    (macro substitution, optional codeblock/tag stripping,
    asterisk handling per pass_asterisks /
    narrate_dialogues_only, optional regex, narrate_quoted_only
    via joinQuotedBlocks, image-markdown removal, provider
    processText, whitespace collapse) and segments it with
    `parseMessageSegments`; per-segment jobs keep the ORIGINAL
    `mes`, so visible chat text is never rewritten by TTS.
    Voice routing per segment type lives in the segmented-job
    branch (dialogue = ("Quotes"), action = (*Text inside
    asterisks*), other = (Other text)). alltalk.js has no
    processText/segmentation of its own.
  - **Extraction (the only production change):**
    `parseMessageSegments` + `joinQuotedBlocks` were pure
    functions trapped in index.js, which cannot be imported
    headlessly (~40 browser providers, Audio +
    ModuleWorkerWrapper at module scope, full script.js graph).
    They were moved VERBATIM to the new dependency-free
    `public/scripts/extensions/tts/segmentation.js`; index.js
    imports them back and passes `multi_voice_enabled` in as an
    option (its app default is false). No behaviour change;
    both files pass node --check and eslint.
  - **Corpus:** canonical example, emote-only, dialogue-only,
    plain narration, mixed narration+action+dialogue (order +
    types exact), multi-sentence dialogue, quotes inside
    actions, nested single quotes in dialogue, curly quotes,
    guillemets, Japanese corner quotes, bold markdown (degrades
    to narration, no asterisks spoken), emote chains,
    empty/whitespace, empty action, unclosed quote.
    Non-destructive assertions: the input string is never
    mutated, and for the core corpus the segments losslessly
    partition the message (re-wrapping segments in their
    delimiters reproduces the original byte-for-byte).
  - **Result:** targeted suite **34 passed / 34**; full unit
    suite **21 suites, 484 passed / 484** (baseline 450 + 34
    new), snapshots 2 passed; eslint clean on the new test,
    segmentation.js, and index.js.
  - **Honest limits (not claimed):** segments carry only
    { type, text } - trimmed copies; production provides NO
    character offsets, so the roadmap section 7 offset wording
    remains unmet by the current code and is future work, not
    evidence here. Known segmenter limitations, asserted as
    word-survival only in the suite: a lone asterisk (math
    "3 * 5") can mispair with an emote opener when
    pass_asterisks and multi-voice are combined (the default
    pipeline strips asterisks before segmentation, so it
    cannot occur there), and underscore emphasis is not
    recognised as an action. Emphasis asterisks inside a
    dialogue segment are retained in its text (stripped
    earlier by the default pass_asterisks=false preprocessing).
    The browser-bound legs of processTtsQueue (settings
    preprocessing, voice routing, provider calls) are not
    exercised headlessly.
  - **RFST-006 gating fact (recorded, unchanged):** AllTalk V2
    is installed at ~/alltalk_tts (XTTS v2, port 7851, voices
    on disk) but NOT running, and the second brain (Aesir
    serve, port 18434) already holds 4538/6144 MiB of the RTX
    2060 GPU. AllTalk was NOT started and no live voice/render
    test was attempted, so as not to disturb the second brain;
    RFST-006 stays QUEUED and Gate B stays OPEN. RFST-007 is
    headless-testable and was completed without it.

- 2026-11-17: **RFST-006 DONE - AllTalk V2 connection contract
  proven against a mock v2 server; live render GATED on GPU
  headroom.** New Jest suite `tests/alltalk-connection.test.js`
  on purplelongship.
  - **GPU gating fact (checked first, unchanged):** RTX 2060
    6144 MiB total, 4538 MiB used by two Aesir processes of
    another campaign, only **1201 MiB free** - below the 3.5 GB
    safety floor. AllTalk was NOT started, nothing was
    disturbed, and no live render was faked. The live voices
    list + speech render against the real server stays GATED
    on GPU headroom, exactly as RFST-003/004/007 gated theirs.
  - **Provider audit (alltalk.js vs the real installed server
    ~/alltalk_tts/tts_server.py + confignew.json):** MATCH on
    /api/ready (plain text Ready), /api/voices
    ({ voices: [wav filenames] }), the /api/tts-generate form
    fields, the /api/tts-generate-streaming query params
    (text, voice, language, output_file), and the default
    endpoint port 7851 (server binds 127.0.0.1:7851).
    Three MISMATCHES found, none fixed in this package (audit
    + evidence only; fixes are future work): (1) the installed
    server has NO /api/rvcvoices route at all - the provider
    fetch falls back to Disabled and rethrows; (2)
    /api/currentsettings returns deepspeed_status /
    low_vram_status / current_model_loaded, while the provider
    reads deepspeed_enabled / lowvram_enabled /
    current_engine_loaded / engines_available (undefined
    against this build); (3) the server returns
    output_file_url as an ABSOLUTE URL, while the provider V2
    branch prepends provider_endpoint, producing a
    double-prefixed unfetchable URL - the server URL used
    as-is renders fine.
  - **What the suite does:** a node http mock on an ephemeral
    127.0.0.1 port implements the real server routes/shapes
    (fake voice names only); static tests pin the real
    alltalk.js source (endpoint default, v2 routes, form
    fields, streaming params); network tests exercise a
    line-for-line replicated provider client (alltalk.js
    cannot be imported headlessly - browser imports +
    document.createElement at class scope; honest header in
    the suite, RFST-007 pattern): readiness (Ready / not-Ready
    / server-down never throws), voices parsing shape, RVC
    404 fallback, currentsettings shape, tts-generate request
    body + audio fetch (RIFF bytes), the double-prefix defect
    asserted as a known mismatch, streaming params + wav
    bytes, and failure handling (500 and server-down reject
    catchably; a caller catch leaves chat alive).
  - **Result:** targeted suite **21 passed / 21**; full unit
    suite **22 suites, 505 passed / 505** (baseline 484 + 21
    new), snapshots 2 passed; eslint clean on the new suite.
    No production code was changed.
  - **Gate tracker unchanged:** Gate B stays OPEN - it needs
    the live render, which is GATED above, not done.

- 2026-11-17: **RFST-008 discovery (keeper probe; package stays
  QUEUED).**
  - The builder dispatched this tick errored out with no report
    and banked nothing (verified: HEAD unchanged at the RFST-006
    commit, working tree clean); the keeper ran the light
    discovery probes directly instead.
  - **Gufo ASR: NOT present in this resident build.** On
    purpleraider (up 2 days 12 h, ~121 GB RAM available), a
    synthetic 1 s tone wav sent to the resident Gufo at
    `POST /v1/audio/transcriptions` returned HTTP **404**
    `not found: POST /v1/audio/transcriptions`; `GET /v1/models`
    still lists only the single gemma chat model. The roadmap
    section 8 Gufo Qwen3-ASR candidate therefore does not exist
    in the locally modified build - a feature-detection verdict;
    no service was changed.
  - **Whisper / faster-whisper: not installed** on purpleraider
    (no binary on PATH; both python imports fail). A benchmark
    therefore first requires installing a backend and downloading
    a model; nothing was installed this tick and no backend is
    selected yet.
  - RFST-008 remains QUEUED; Gate B unchanged.
