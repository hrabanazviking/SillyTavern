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
| RFST-008 | P1 | STT backends benchmark on Z13 | QUEUED (GATED - live benchmark awaits a backend install on the Z13: Gufo ASR route 404, whisper not installed; see docs commit 2cc98f1ea) |
| RFST-009 | P1 | Push-to-talk and transcript correction | DONE 2026-11-17 (mock-STT suite; live transcription GATED on an STT backend on the Z13 - RFST-008) |
| RFST-010 | P0 | Discover second-brain query schema | DONE 2026-11-17 (schema discovered + privately documented; authenticated live query PROVEN 2026-11-17 under the RFST-011/012 live legs) |
| RFST-011 | P0 | Read-only all-collections gateway | DONE 2026-11-17 (mock-upstream gateway suite; authenticated live search PROVEN 2026-11-17 - see the live-leg entry in Notes) |
| RFST-012 | P0 | Global zero-config RAG injection | DONE 2026-11-17 (mock-gateway injection suite; authenticated live injection PROVEN 2026-11-17 - see the live-leg entry in Notes) |
| RFST-013 | P1 | ComfyUI remote endpoint baseline | DONE 2026-11-17 (mock-ComfyUI contract suite; live image-into-chat GATED on ComfyUI being started) |
| RFST-014 | P1 | Image model/workflow inventory and benchmarks | DONE 2026-11-17 (reviewed registry with scoring; live benchmarks GATED on ComfyUI being started) |
| RFST-015 | P1 | Automatic image workflow router | DONE 2026-11-17 (router core + suite; live routing GATED on ComfyUI being started) |
| RFST-016 | P1 | ComfyUI unload-on-idle lifecycle | DONE 2026-11-17 (mock-ComfyUI lifecycle suite; live unload GATED on ComfyUI being started) |
| RFST-017 | P1 | Resource-aware queues and cancellation | DONE 2026-11-17 (mock-executor suite; live contention GATED on real services running together) |
| RFST-018 | P1 | Global integration status/settings panel | DONE 2026-11-17 (panel core + suite; live Windows UI panel GATED on the F15 UI host) |
| RFST-019 | P1 | Network and transport hardening | DONE 2026-11-17 (hardening core + suite; live cross-machine audit GATED) |
| RFST-020 | P1 | Integration tests across all three computers | DONE 2026-11-17 (mock scenario matrix suite; live three-machine run GATED on all three machines being available together) |
| RFST-021 | P1 | Update/merge compatibility harness | DONE 2026-11-17 (mock-damage harness suite; live merge run GATED on an actual upstream merge being performed) |
| RFST-022 | P2 | Optional hands-free VAD / barge-in | DONE 2026-11-17 (mock VAD/STT/playback suite; live end-to-end turn-taking GATED on an STT backend on the Z13 - RFST-008 - and on live TTS playback) |
| RFST-023 | P2 | Optional context-sensitive image suggestions | DONE 2026-11-17 (mock router/suggester suite; live image generation GATED on ComfyUI being started) |
| RFST-024 | P2 | Multi-character voice routing refinements | DONE 2026-11-17 (mock renderer suite; live group voice render GATED on live AllTalk render / GPU headroom - RFST-006) |
| RFST-025 | P2 | Packaging and one-click local diagnostics | DONE 2026-11-17 (mock diagnostics suite + deployment instructions; live one-click run GATED on the F15 UI host) |

## Release gates (roadmap section 16)

| Gate | Name | Status |
| --- | --- | --- |
| A | Text baseline | OPEN |
| B | Natural voice | OPEN |
| C | Shared knowledge | PASSED 2026-11-17 (RFST-011/012 live legs proven; see Notes) |
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

- 2026-11-17: **RFST-010 DONE - second-brain query schema
  discovered (keeper, read-only, on purplelongship); detailed
  interface documented PRIVATELY off-repo, per the roadmap
  wording and the public-repo hygiene rule. RFST-008 was
  skipped past this tick, not treated as a blocker: it needs a
  backend install + model download on purpleraider that is not
  yet selected, while RFST-010's dependencies (RFST-001/002)
  are banked and it is independent work.**
  - **The service:** the second brain's viewer/API (a FastAPI
    app) runs on purplelongship on its local port, backed by
    PostgreSQL + pgvector, with embeddings from the local
    Ollama. It was probed read-only; nothing was reconfigured
    and no second-brain service was disturbed.
  - **Auth (verified live):** every data route requires a
    scoped access token; unauthenticated probes of the health,
    overview, and agent-contract routes returned HTTP 401.
    A scoped agent contract (OpenAPI) route exists.
  - **Search route:** one hybrid search endpoint taking a
    query string, a result count (1-100, default 12), and an
    optional HyDE flag. It fuses vector search over chunk
    embeddings with keyword full-text ranking (reciprocal-rank
    fusion); if embeddings fail it degrades to keyword-only
    hits and says so, rather than erroring. Hits carry chunk
    id, document id, similarity, and score only - chunk text
    plus provenance (document title + source) is fetched per
    chunk id from a separate read route. An overview route
    returns document/chunk counts only.
  - **Collections verdict:** the API has NO collection
    parameter and no per-collection scoping anywhere - search
    runs over the single unified documents/chunks corpus, so
    'all collections' for RFST-011/012 is satisfied by
    construction; there is nothing to fan out across.
  - **RFST-011 warning (design fact):** write-capable routes
    (ingest, graph/skein build, admin) live in the SAME
    service. The read-only gateway must therefore be a
    separate front exposing only the read routes behind a
    read-scoped token, with write paths rejected at the
    gateway - never a proxy of the whole API.
  - **GATED (not done):** an authenticated live search - it
    needs a read-scoped key issued for this campaign through
    the owner's security gateway; no key was borrowed or read
    this tick, and no second-brain records were read at all.
    Schema and hit shapes were verified from the running
    service's own code plus the live 401 probes.

- 2026-11-17: **RFST-011 DONE - read-only all-collections
  gateway proven against a mock upstream; authenticated live
  search GATED on a scoped read key.** New dependency-free core
  `src/second-brain/gateway-core.js` + thin Express router
  `src/endpoints/second-brain.js` (mounted at /api/second-brain
  in src/server-startup.js). New Jest suite
  `tests/second-brain-gateway.test.js` imports the real core
  (RFST-007 pattern, nothing replicated).
  - **Allowlist only:** the gateway can call exactly three
    upstream read operations (search, chunk fetch, overview)
    plus its own health report. Every write verb (POST/PUT/
    DELETE/PATCH) is rejected 403, wrong verbs 405, unknown or
    write-shaped paths 404, malformed/traversal/encoded paths
    400 - all BEFORE any upstream call; the mock upstream
    records every request it receives and the suite asserts
    zero upstream traffic for 14 write attempts (incl.
    ingest/build/admin/refresh shapes and .. / %2e tricks).
    Paths are decoded repeatedly, traversal segments rejected,
    and matched exactly.
  - **All collections by construction:** upstream search runs
    over the single unified corpus with no collection
    parameter (RFST-010), so gateway search covers the entire
    knowledge base; the suite proves hydrated hits (top hits
    fetched per chunk id) carrying text + provenance (document
    title, source), trimmed to a configurable count and text
    budget.
  - **Config hygiene:** upstream base URL + scoped read token
    come from the server environment only
    (SECOND_BRAIN_URL / SECOND_BRAIN_READ_TOKEN); the token is
    sent upstream as a bearer credential, never returned to
    callers (asserted) and never logged. With no token or no
    base URL the gateway reports itself unconfigured (503 on
    data routes, health shows configured:false) and makes no
    upstream call at all.
  - **Failure behaviour:** upstream 500 and upstream-down both
    surface as catchable 502 results / GatewayError rejections;
    the caller survives and a later call succeeds.
  - **Result:** targeted suite **17 passed / 17**; full unit
    suite **23 suites, 522 passed / 522** (baseline 505 + 17
    new), snapshots 2 passed; eslint clean on the new core,
    endpoint, startup change, and suite.
  - **GATED (not done):** an authenticated live search - it
    needs a read-scoped key issued for this campaign; no key
    was borrowed or read this package and no second-brain
    records were read. Gate C stays OPEN - it needs that live
    search.

- 2026-11-17: **RFST-012 DONE - global zero-config RAG
  injection proven against a mock gateway; authenticated live
  injection GATED on a scoped read key.** New dependency-free
  core `src/second-brain/rag-injection-core.js`. New Jest suite
  `tests/second-brain-rag.test.js` imports the real core
  (RFST-007/011 pattern, nothing replicated).
  - **Zero-config by construction:** the core accepts no
    character identity and no per-character settings anywhere;
    its only inputs are the discussion, recent context, and one
    global config (defaults from the roadmap sketch: top_k 8,
    max_context_tokens 1800, relevance cutoff 0.3; global env
    overrides SECOND_BRAIN_RAG_ENABLED / _TOP_K /
    _MAX_CONTEXT_TOKENS / _MIN_SCORE). The suite proves a new
    character context retrieves with no config, and that adding
    character identity fields changes neither the query nor
    the injected block.
  - **Pipeline:** buildRetrievalQuery formulates the query
    from the current discussion + recent turns (system messages
    excluded); the injected search function is the RFST-011
    gateway search (all collections by construction, RFST-010);
    planInjection deduplicates exact + near-identical snippets
    (token-set Jaccard >= 0.8), ranks by score, applies the
    relevance cutoff, and trims to the token budget (final
    snippet trimmed at a word boundary); formatInjectionBlock
    renders an ephemeral block with provenance tags (title,
    source, id) framed explicitly as data, not instructions.
    Inputs are never mutated; nothing is written back - the
    injector exposes only inject/resetHistory/config and the
    mock records calls carrying only { q, k }.
  - **Loop/repeat suppression:** snippets injected on earlier
    turns are suppressed on later turns (per-injector history,
    resettable), and any text already containing an injection
    block is excluded from query building, so a fed-back block
    cannot trigger recursive retrieval.
  - **Graceful failure:** global off (no gateway call at all),
    unconfigured, empty results, gateway throwing, and
    malformed/null results all yield no injection and never
    throw into the chat path.
  - **Result:** targeted suite **23 passed / 23**; full unit
    suite **24 suites, 545 passed / 545** (baseline 522 + 23
    new), snapshots 2 passed; eslint clean on the new core
    and suite. No production wiring was changed.
  - **Seam inspection (honest):** the browser-side prompt
    seams (vectors extension, world-info, extension prompts)
    all depend on the full browser app (script.js graph) and
    cannot be exercised or safely wired headlessly; the
    server side has no chat-prompt assembly seam (prompt
    building is client-side in SillyTavern). The proven
    vertical slice is therefore the core + suite, with
    createRagInjectorFromGateway ready to wrap the RFST-011
    gateway; live/UI wiring is GATED, not done.
  - **GATED (not done):** authenticated live injection - it
    needs the same read-scoped key as RFST-011; no key was
    borrowed or read this package and no second-brain records
    were read. Gate C stays OPEN - it needs that live search
    plus injection.

- 2026-11-17: **RFST-013 DONE - ComfyUI remote endpoint
  baseline proven against a mock ComfyUI; live
  image-into-chat GATED on ComfyUI being started.** No new
  production code: the roadmap (section 10) makes the
  built-in ComfyUI path the first integration path, so this
  package audits and proves it. New Jest suite
  `tests/comfyui-remote-endpoint.test.js` runs the REAL
  server router `src/endpoints/stable-diffusion.js` over
  real HTTP (node-fetch NOT mocked, unlike the older
  stable-diffusion suite) against a node-http mock ComfyUI
  on an ephemeral 127.0.0.1 port; only the browser client
  glue is replicated line-for-line (RFST-006 pattern -
  index.js cannot be imported headlessly) and pinned to the
  real source by static tests.
  - **Audit findings:** browser defaults are comfy_url
    http://127.0.0.1:8188, workflow
    Default_Comfy_Workflow.json, comfy_type standard.
    generateComfyImageCommon loads the workflow via
    POST /api/sd/comfy/workflow (missing file falls back to
    the default workflow), substitutes the quoted
    placeholders "%prompt%" / "%negative_prompt%" /
    "%seed%" / "%denoise%" / "%clip_skip%" plus
    model/vae/sampler/scheduler/steps/scale/width/height,
    and POSTs { url, prompt: '{ "prompt": <workflow> }' }
    to /api/sd/comfy/generate. The server POSTs the prompt
    body VERBATIM to <url>/prompt (expects { prompt_id }),
    polls GET <url>/history/<id> every 100 ms until the id
    appears, throws on status_str error with the
    execution_error node messages, takes the first images
    entry (a_images ignored) else the first gifs entry,
    fetches GET <url>/view?filename=&subfolder=&type=, and
    answers { format: <extension>, data: <base64> }; the
    browser saves that via saveBase64AsFile and puts it in
    chat with sendMessage. /comfy/ping proxies
    /system_stats; samplers/models/schedulers/vaes proxy
    /object_info. Workflows must be API format (object keyed
    by node-id strings with class_type/inputs), not UI
    format; the bundled default workflow follows it.
  - **Honest limits found:** the history poll has NO
    server-side timeout - cancellation is the client
    disconnect, which fires POST <url>/interrupt (the
    AbortController in the route is not wired into its
    fetches); and no auth is sent on /prompt, /history or
    /view (Authorization only on /interrupt), so the
    endpoint assumes a trusted private network, exactly as
    roadmap section 3 requires.
  - **Suite proves (18 tests):** workflow load + fallback;
    an API-format workflow submitted with substitutions
    applied (fake checkpoint/seed/steps asserted at the
    mock), completion polled (>= 3 history hits across two
    pending replies), image bytes fetched via /view with
    the exact filename/subfolder/type query and returned
    as { format: png, data: base64 } decoding byte-equal
    to a tiny valid PNG generated in-test; a_images-only
    outputs skipped; gif fallback (webp); failure cases
    all surface catchably as ST 500s and never crash the
    caller - /prompt 500, workflow error status with node
    message, no recognizable outputs, /view 404, server
    down, /system_stats 500 on ping - and a client-side
    timeout aborts catchably against a slow history, with
    a successful generation afterwards proving survival.
  - **Result:** targeted suite **18 passed / 18**; full
    unit suite **25 suites, 563 passed / 563** (baseline
    545 + 18 new), snapshots 2 passed; eslint clean on
    the new suite. No production wiring was changed.
  - **GATED (not done):** a live image returned into chat
    from the real ComfyUI - it is installed on
    purpleraider at /home/volmarr/ai/ComfyUI but was NOT
    running at audit time (no process, port 8188 closed),
    and no service was started for this package. The live
    leg waits on ComfyUI being started under a roadmap
    step / the owner word. Gate D stays OPEN - it needs
    that live run plus RFST-014/015/016.

- 2026-11-17: **RFST-014 DONE - reviewed local registry
  with scoring proven by suite; live benchmarks GATED on
  ComfyUI being started.** New dependency-free core
  `src/media/image-registry-core.js`. New Jest suite
  `tests/image-registry.test.js` imports the real core
  (RFST-007/011/012 pattern, nothing replicated) and reads
  the real bundled workflow JSON files.
  - **Inventory (read-only probe of purpleraider, names +
    sizes only; no service started, nothing reconfigured):**
    ComfyUI 0.45.0 is installed at /home/volmarr/ai/ComfyUI
    but NOT running (no process, port 8188 closed). Its own
    models/ tree holds only placeholder files; the real
    models live in the vault its extra_model_paths config
    points at. Found there: **15 checkpoints** (SD1.5:
    CyberRealistic, epiCRealism, Realistic Vision V6 fp16 +
    full, v1-5-pruned-emaonly; SDXL: JuggernautXL Ragnarok,
    RealVisXL V5, Lustify V9; Pony: Babes / Realism / Ultra
    Realistic by Stable Yogi, PonyRealism V22; Illustrious:
    Babes, Realism / Ultra Realistic by Stable Yogi),
    **5 diffusion models** (Flux.1 dev, Chroma1 Base / HD /
    HD-Flash, Z-Image Turbo unlock), **2 LoRAs** (chrxma-v2,
    flux lustly-ai v1), **3 text encoders** (clip_l,
    qwen_3_4b, t5xxl_fp16), **1 VAE** (ae). Custom nodes:
    only the stock examples - notably NO comfyui-tooling-
    nodes. The same checkpoint names also appear under the
    A1111 tree on that machine; they were counted once, as
    ComfyUI-vault entries.
  - **Registry (28 entries):** the 26 vault models plus the
    2 workflows bundled with SillyTavern, analysed
    structurally with the core's own analyzeWorkflow:
    Default_Comfy_Workflow.json (API format, 7 nodes,
    KSampler + CheckpointLoaderSimple, %prompt% / %model% /
    %seed% style placeholders, no external nodes) and
    Char_Avatar_Comfy_Workflow.json (API format, 9 nodes,
    img2img avatar; requires ETN_LoadImageBase64 from
    comfyui-tooling-nodes, which is NOT installed - recorded
    on the entry as a compatibility note, not hidden).
    Entries carry id/kind/categories/tags/priority/source/
    sizeBytes/family/license only - no absolute paths, no
    assets. Family labels are a name-and-size heuristic and
    every entry says so (familyBasis); every license is
    honestly 'unknown' (per-model terms not yet reviewed).
  - **Scoring:** scoreEntry is a pure deterministic function
    of KNOWN signals only - availability (30), curated
    priority (20), benchmark coverage (20), measured quality
    (30: anatomy / identity continuity / prompt fidelity /
    1 - artifactRate; runtime + memory are coverage-only,
    never normalised into fake quality). Unknown dimensions
    score nothing and are reported by name. rankEntries
    filters by category/kind/tags and sorts score desc,
    priority desc, id asc (order-independent, proven).
    resolveSelection is the RFST-015 seam: a manual override
    wins when it names a real non-missing entry; unknown or
    missing overrides fail honestly with the automatic
    fallback attached; no candidates is a clean failure.
  - **Suite proves (25 tests):** the shipped registry
    validates clean (unique ids, valid categories, benchmark
    ranges); inventory counts + spot-checked byte sizes
    match the probe; category coverage spans all six roadmap
    categories (image-editing only via the avatar workflow);
    validation rejects duplicates / bad kinds / out-of-range
    benchmarks while accepting measured runtime/memory;
    scoring determinism, monotonicity in known benchmarks,
    artifact-rate sensitivity, tie-breaking, non-mutation;
    override applied / not-found / unavailable / empty.
  - **Result:** targeted suite **25 passed / 25**; full
    unit suite **26 suites, 588 passed / 588** (baseline
    563 + 25 new), snapshots 2 passed; eslint clean on the
    new core and suite. No production wiring was changed.
  - **GATED (not done):** real benchmark scores - running
    the consistent private benchmark prompts (roadmap
    section 10) needs a live ComfyUI, which was not running
    and was not started for this package. Every benchmark
    dimension in the shipped registry is therefore null
    (unknown), the suite asserts exactly that, and no number
    was invented. Per-model license review is likewise not
    done (all 'unknown'). Gate D stays OPEN - it needs the
    RFST-013 live run, these live benchmarks, and
    RFST-015/016.

- 2026-11-17: **RFST-015 DONE - correct category selection
  plus manual override proven by suite; live routing GATED
  on ComfyUI being started.** New dependency-free core
  `src/media/image-workflow-router-core.js` builds only on
  the RFST-014 registry core (its categories, scoring and
  ranking - nothing duplicated). New Jest suite
  `tests/image-workflow-router.test.js` imports the real
  core and the real registry.
  - **Classification:** explicit category field wins, then
    edit-with-source-image shape, then deterministic keyword
    scoring over prompt/text/description/subject/tags, then
    orientation hints (weak, only when no keyword fires).
    All six registry categories are covered: portrait,
    full-body, environment, illustration,
    scene-continuation, image-editing.
  - **Selection:** per category, the best-scoring workflow
    and the best-scoring checkpoint/diffusion model from the
    registry ranking (portrait/environment/illustration/
    full-body/scene-continuation -> bundled default
    workflow; image-editing -> bundled avatar workflow, its
    only editing candidate).
  - **Manual override always wins:** a named entry id,
    workflow file, model filename or label, an override
    category, or the object form - every one of the 28
    registry entries can be forced by override, even on a
    category mismatch (the mismatch is reported, not
    silently corrected).
  - **Fallback:** unknown or tied/ambiguous requests, and
    unknown or missing-entry overrides, never throw - they
    fall back deterministically to the top-ranked automatic
    pick and report the reason by name
    (no_category_signals / ambiguous_category_signals /
    override_not_found / override_unavailable); repeated
    calls are byte-identical and neither registry nor
    request is mutated.
  - **Result:** targeted suite **29 passed / 29**; full
    unit suite **27 suites, 617 passed / 617** (baseline
    588 + 29 new), snapshots 2 passed; eslint clean on the
    new core and suite. No production wiring was changed
    and no service was started or reconfigured.
  - **GATED (not done):** live routing against a real
    ComfyUI - dispatching a routed job and returning an
    image into chat needs ComfyUI running, which it was
    not, and it was not started for this package. The
    router only selects; it never dispatches. Gate D stays
    OPEN - it needs the RFST-013 live run, the RFST-014
    live benchmarks, and RFST-016.
- 2026-11-17: **RFST-016 DONE - memory returns to the defined
  idle state proven by mock suite; live unload GATED on
  ComfyUI being started.** New dependency-free core
  `src/media/comfyui-idle-lifecycle-core.js` manages the
  unload-on-idle lifecycle for the RFST-013 ComfyUI endpoint
  contract (GET /queue, GET /system_stats, POST /free with
  unload_models + free_memory). New Jest suite
  `tests/comfyui-idle-lifecycle.test.js` (27 tests) exercises
  the real core against a mock ComfyUI client with an
  injected fake clock.
  - **Defined idle state (roadmap section 10):** healthy
    ComfyUI HTTP service stays alive, no image model
    residency, empty queue, free VRAM back at the recorded
    idle baseline (within 64 MiB tolerance). The baseline is
    captured from the first quiet stats observation or set
    explicitly.
  - **Lifecycle:** activity/in-flight tracking, a tunable
    idle grace period (default 60 s, prioritizing freeing
    memory for text inference), unload only once the grace
    period elapses with zero local in-flight jobs and an
    empty remote queue, and post-unload verification against
    the defined idle state.
  - **Races (section 13 matrix):** a busy observation always
    defers; a job arriving while an unload is scheduled
    cancels it and restarts the grace period; a job arriving
    while /free is in flight is kept, the unload settles, and
    the manager returns to active with
    needsReloadAfterUnload set - the job is never lost and
    never silently run against unloaded weights. Repeated
    idle ticks are idempotent (no repeat /free calls); a
    second activity cycle unloads a second time.
  - **Cancellation:** cancelPendingUnload clears a scheduled
    unload; an in-flight unload honestly reports itself not
    cancellable. Unreachable endpoint and failed /free are
    reported as errors, never faked as idle.
  - **Full unit suite: 644/644** (617 at RFST-015 + 27 new).
  - **GATED (not done):** a live unload against a real
    ComfyUI - it was not started for this package and no
    service was touched, exactly as RFST-013/014/015 gated
    their live legs.
  - **RFST-008 stays QUEUED/GATED:** its live STT benchmark
    awaits a backend install on the Z13 (Gufo ASR route 404,
    whisper not installed; docs commit 2cc98f1ea). Not
    attempted this tick; RFST-009 likewise untouched.

- 2026-11-17: **RFST-011/012 LIVE LEGS DONE - scoped read-only
  key issued and registered; Gate C PASSED.** Volmarr ordered
  the key made; the finish below was verified end to end
  against the real second brain (statuses and counts only;
  no records were read into this ledger).
  - **The key:** a bearer token registered in the second
    brain's OWN security store via its create_key mechanism -
    name "SillyTavern gateway read-only (RFST-011/012)", key id
    643c265b213b609c5a530957, scopes ["read"] ONLY (no ingest),
    not revoked, 1-year expiry (to 2027-11-17). The env token
    was hash-matched to exactly this key. Server-side only:
    the machine integration profile outside the git tree
    (/home/volmarr/.config/sillytavern-forge/second-brain.env,
    mode 600) holds SECOND_BRAIN_URL + SECOND_BRAIN_READ_TOKEN
    + the documented SECOND_BRAIN_RAG_MIN_SCORE override. The
    token value appears nowhere in this repo or its history.
  - **Proof (a) authenticated search:** through the real
    gateway, four broad queries each returned 200 with 12 hits
    spanning 7-10 distinct documents and 4 distinct sources
    (the upstream corpus is unified, so all-collections holds
    by construction, RFST-010); gateway overview matches the
    upstream counts (4776 documents / 100008 chunks).
  - **Proof (b) rejection:** upstream with no token 401, with
    a wrong token 401.
  - **Proof (c) writes rejected, brain unchanged:** gateway
    POST rejected 403 (write_rejected, before any upstream
    call) and GET on a write-shaped path 404; a direct
    upstream POST /api/ingest/text carrying the read token
    returned 403 (scope enforced by the second brain itself);
    overview counts identical before and after (4776 / 100008).
  - **Proof (d) live injection:** the RFST-012 injector over
    the real gateway injected context from a plain discussion
    context - injected=true, 5 snippets, tokenEstimate 1799
    of the 1800 budget. No character configuration exists or
    was used.
  - **Bug found and fixed (never-leave-a-bug law):** the
    first live injection returned no_relevant_results. Cause:
    the upstream keyword (degraded) mode reports sim 0 on
    every hit with the real relevance in score, and hitScore
    preferred any finite sim, so every hit scored 0 and fell
    under the cutoff. Fix in src/second-brain/
    rag-injection-core.js: only a positive sim outranks
    score. Regression test added (tests/
    second-brain-rag.test.js, keyword-mode case); targeted
    suite 24/24, full unit suite 645/645.
  - **Honest observation:** live search currently runs in
    the upstream's keyword mode (degraded=true) because the
    second brain's own Ollama is down (its /api/health
    reports ollama:false, db:true); hybrid ranking returns
    when that service does. That is the second brain's own
    state - not a gateway or key defect - and this campaign
    did not touch it.
  - **Gate C: PASSED.** Every section-16 criterion is met
    live: one read-only all-collections retrieval service,
    working for every character automatically, with no
    character-specific setup.
- 2026-11-17: **RFST-009 DONE - no duplicate messages plus
  typed fallback proven against mock STT; live transcription
  GATED on an STT backend on the Z13 (RFST-008).** New
  dependency-free core `src/voice/push-to-talk-core.js`
  implements the push-to-talk session against the
  OpenAI-compatible STT contract of section 8 (POST
  /v1/audio/transcriptions), with the client and clock
  injected. New Jest suite `tests/push-to-talk.test.js`
  (29 tests) exercises the real core against a mock STT
  client.
  - **Lifecycle:** idle -> recording -> uploading ->
    transcribing -> preview -> send. Partial transcripts
    are held apart from final ones (previewKind) and can
    never be sent; the user may edit/correct the final
    transcript in preview before send. Auto-send fires only
    when explicitly enabled (default off) and then exactly
    once. Capture, upload, transcription and round-trip
    timing are recorded on the session.
  - **Cancel and retry:** cancel during recording or during
    upload/transcription drops any late result; retry reuses
    the captured audio as a fresh attempt.
  - **No double-send:** each finalized transcript cycle
    carries one send token; a second send for the same
    token - after reconnect or a partial-then-final
    sequence - is rejected as a duplicate and never
    re-invokes the host send callback. A new capture is a
    new logical message with a new token.
  - **Typed fallback:** when the STT client errors or is
    absent, manual typing enters the same preview / edit /
    send path (source: 'typed') as a fully functional path.
  - **Bounded and local-only:** audio format allowlist
    (webm/ogg/wav/mp3/m4a/flac), max upload size and a
    request timeout are enforced; the STT endpoint must be
    loopback, private, LAN or tailnet - public/cloud
    recognizer endpoints are rejected before any upload.
  - **TTS-playback guard:** beginCapture is rejected while
    the host's playbackActive flag is set, so TTS playback
    can never be captured back into a user message.
  - **Result:** targeted suite **29 passed / 29**; full
    unit suite **29 suites, 674 passed / 674** (645 at
    RFST-016 HEAD measured this tick + 29 new), snapshots
    2 passed; eslint clean on the new core and suite. No
    production wiring was changed and no service was
    started, installed or reconfigured.
  - **GATED (not done):** live transcription against a real
    STT backend - none is installed on the Z13 (RFST-008:
    Gufo ASR route 404, whisper not installed), and nothing
    was installed for this package, exactly as RFST-013..016
    gated their live legs. Gate B stays OPEN - it needs the
    RFST-008 live benchmark and this live transcription leg.

- 2026-11-17: **RFST-017 DONE - interactive text preserved
  under contention proven by mock suite; live contention
  GATED on the real services running together.** New
  dependency-free core `src/scheduling/resource-queue-core.js`
  implements the section 12 (Phase 7) scheduling policy.
  New Jest suite `tests/resource-queue.test.js` (34 tests)
  exercises the real core with injected mock executors and
  an injected fake clock; no live service is contacted.
  - **Priority policy (section 12):** 1 Gufo chat + user
    STT, 2 second-brain retrieval for the current prompt,
    3 AllTalk, 4 ComfyUI image jobs (queueable; an
    explicitly user-prioritized image job is boosted to
    priority 2), 5 background. Jobs run in priority order,
    FIFO within a priority.
  - **Bounded queues + admission control:** per-class
    queue limits; a full class rejects only its own class
    (queue_full); Offline services reject as
    service_offline and Misconfigured as
    service_misconfigured, never as silent retry loops.
  - **KEY ACCEPTANCE:** with the ComfyUI and background
    queues saturated (and overflow refused), an interactive
    Gufo text job is still admitted, runs first, succeeds
    exactly once, and is never dropped; a duplicate submit
    of the same text request under contention returns the
    existing job and the executor runs once.
  - **Ids, tokens, tracking, idempotency:** every job
    carries a request ID (auto-assigned when absent), a
    cancellation token (cancel / onCancel /
    throwIfCancelled), and a tracked state (queued /
    running / retry-scheduled / succeeded / failed /
    cancelled / timed-out). Duplicate submission at any
    point, including after completion, returns the same
    job and never duplicates work.
  - **Cancel, timeout, retry:** cancelling a queued job
    removes it from scheduling; cancelling a running job
    discards its result. Timeouts are judged on the
    injected clock; failures retry finitely (default 3)
    with exponential backoff (base x 2^(n-1)) and a
    retry-scheduled job never spins or starves others.
  - **Service states + degraded mode:** the six common
    states (Ready / Loading / Busy / Offline / Degraded /
    Misconfigured) and the section 12 failure matrix as
    data: AllTalk offline -> text continues without voice;
    ComfyUI offline -> chat and voice continue, images
    unavailable; second brain offline -> chat proceeds
    without knowledge with an indicator; STT offline ->
    typing continues; Gufo offline -> inference
    unavailable with a clear message.
  - **RFST-016 race guard:** canCleanup(service) refuses
    cleanup / unload while any queued, running, or
    retry-scheduled job for that service exists, and frees
    the moment the last such job finishes or is cancelled.
  - **Full unit suite: 708/708** (674 at RFST-009 HEAD +
    34 new), 30 suites, snapshots 2 passed.
  - **GATED (not done):** live contention proof against
    the real Gufo / AllTalk / ComfyUI services running
    together - none was started or reconfigured for this
    package, exactly as RFST-013..016 gated their live
    legs. Gate E stays OPEN.

- 2026-11-17: **RFST-018 DONE - global integration
  status/settings panel core.** Pure dependency-free
  core at `src/settings/integration-panel-core.js` with
  its suite at `tests/integration-panel.test.js`
  (26 tests), following the RFST-013..017 pattern; the
  live Windows panel UI leg is GATED on the F15 UI host.
  - **Five-service registry:** Gufo / AllTalk / STT /
    ComfyUI / Second Brain, each with ONE machine-wide
    endpoint URL, editable centrally (roadmap section
    13). Endpoint validation rejects invalid URLs,
    non-http(s) schemes and embedded credentials, and
    normalizes trailing slashes.
  - **Status model:** per-service states (unknown /
    checking / ok / degraded / down / unconfigured)
    aggregate to one overall status; last error and
    last-ok are retained per service. A down or
    unconfigured service never disables chat - panel
    state is advisory and feature availability follows
    service states plus the knowledge toggle.
  - **Global settings only:** conversation mode
    (text-only / text+voice / push-to-talk /
    hands-free), audio defaults, image settings (auto
    model selection, manual workflow override, idle
    unload), and knowledge as ONE global enabled toggle
    + relevance threshold + token budget. No
    per-character keys exist; migration fills defaults,
    drops unknown/per-character keys and clamps ranges,
    so newly imported characters work immediately.
  - **Diagnostics:** copyable local debug report lists
    every service state, the overall status and last
    errors with secrets stripped (URL userinfo, secret
    query params, bearer tokens and password fields
    redacted).
  - **Full unit suite: 734/734** (708 at RFST-017 HEAD +
    26 new), 31 suites.
  - **GATED (not done):** the live Windows UI panel on
    the F15 host - no service was started or
    reconfigured for this package. Gate E stays OPEN.

- 2026-11-17: **RFST-019 DONE - network and
  transport hardening.** Evidence required (roadmap
  section 14): tailnet-only, no accidental public
  endpoints.
  - **Core:** new dependency-free module
    `src/settings/transport-hardening-core.js` classifies
    bind addresses and endpoint hosts as loopback /
    tailnet (100.64.0.0/10 CGNAT range plus *.ts.net
    hostnames) / LAN-private (RFC1918) / link-local /
    wildcard / public / invalid. Its audit over the
    five RFST-018 service configs (gufo, alltalk, stt,
    comfyui, second-brain) reports ok / warning /
    violation / unconfigured per service: public
    endpoints and wildcard binds are violations unless
    an explicit opt-in flag is set (then warnings,
    never silent ok); credentialed URLs and
    non-http(s) schemes are always violations;
    LAN-private endpoints warn as not tailnet-only.
    URL validation rejects embedded credentials and
    non-http(s) schemes, and the diagnostics report
    builder emits per-service verdicts with endpoint
    credentials and secret query values stripped.
    The core is pure and injected - no live network
    calls, no sockets opened.
  - **Suite:** `tests/transport-hardening.test.js`,
    28 tests against mock configs: tailnet and
    loopback accepted, public and wildcard flagged,
    credentialed URLs rejected, aggregation correct.
  - **Full unit suite: 762/762** (734 at RFST-018
    HEAD + 28 new), 32 suites.
  - **GATED (not done):** a live audit of the actually
    running services across all machines - gated
    where a machine is asleep or unavailable. No
    running service was reconfigured or disturbed
    for this package. Gate E stays OPEN.

- 2026-11-17: **RFST-020 DONE - integration tests
  across all three computers.** Evidence required
  (roadmap section 14): full scenario matrix passes.
  - **Core:** new dependency-free module
    `src/integration/scenario-matrix-core.js` defines
    the full cross-machine scenario matrix as data:
    13 scenarios across the three host ROLES only
    (ui-host / inference-host / services-host - never
    real hostnames or network addresses), covering
    every already-banked integration (Gufo text
    streaming/cancel, AllTalk TTS segmentation,
    second-brain RAG injection, ComfyUI routing and
    idle lifecycle, resource queues and cross-host
    failure degradation, the status panel, and
    transport hardening). Each scenario carries its
    host roles, preconditions, steps, and expected
    result. A completeness validator reports missing
    integrations, duplicate ids, and malformed
    scenarios, and a runner executes scenarios against
    mock/pluggable executors and produces a
    pass/fail/gated matrix report with accurate
    summary counts.
  - **Gating, never faking:** a scenario whose live
    preconditions are unmet (a required host or
    service unavailable, or a live-only scenario
    outside a live run) is reported GATED - skipped,
    not passed and not failed - with the unmet
    preconditions named, and the executor is never
    invoked for it. A failing step fails only its own
    scenario; the rest of the matrix still runs. In
    the mock run 10 scenarios pass and the 3 live-only
    scenarios gate.
  - **Suite:** `tests/scenario-matrix.test.js`,
    21 tests against mock executors and mock
    environments: matrix completeness (every banked
    integration has at least one scenario), all
    mock-executable scenarios pass, failure isolation,
    gated reporting, and accurate report counts.
  - **Full unit suite: 783/783** (762 at RFST-019
    HEAD + 21 new), 33 suites.
  - **GATED (not done):** the live three-machine run
    of the live-only scenarios - gated on all three
    machines being available together (the F15 UI
    host, the inference host, and the services host).
    No running service was started, reconfigured, or
    disturbed for this package. Gate E stays OPEN.

- 2026-11-17: **RFST-021 DONE - update/merge
  compatibility harness.** Evidence required (roadmap
  section 14): upstream merges do not silently break
  adapters.
  - **Core:** new dependency-free module
    `src/integration/merge-compatibility-core.js`
    inventories the fork's ten RuneForgeAI adapter/core
    modules that actually exist on disk (second-brain
    gateway + RAG, push-to-talk, image registry +
    workflow router, ComfyUI idle lifecycle, integration
    panel, transport hardening, resource queue, and the
    scenario matrix), each with the exports the rest of
    the fork relies on (name, kind, and arity where the
    signature is part of the contract). Its checker loads
    each module through an injected loader and verifies
    every expected export, and contract probes catch
    behavior drift an export list alone cannot. A module
    that fails to load is a failure, never a skip.
  - **Fails loudly, never silently:** the report is ok
    only when every adapter passes; every failure is
    named by type (missing-module, missing-export,
    wrong-kind, wrong-arity, probe-failed, probe-error)
    and `assertCompatible` throws listing all of them.
    A mock loader with simulated merge damage (dropped
    module, dropped export, renamed export, replaced
    export) proves each breakage class is caught without
    performing a real upstream merge.
  - **Suite:** `tests/merge-compatibility.test.js`,
    17 tests against the real adapter modules plus
    simulated merge damage: inventory grounded in the
    modules on disk, all real adapters pass their
    contracts and probes, and every damage class fails
    loudly with named failures.
  - **Full unit suite: 800/800** (783 at RFST-020
    HEAD + 17 new), 34 suites.
  - **GATED (not done):** running the harness as part
    of an actual upstream merge - gated on a merge
    actually being performed. No upstream merge was
    performed and no running service was started,
    reconfigured, or disturbed for this package.
    Gate tracker unchanged.

- 2026-11-17: **RFST-022 DONE - optional hands-free
  VAD / barge-in.** Evidence required (roadmap
  section 14): stable end-to-end voice turn-taking.
  Section 8 eligibility met: hands-free is added only
  after push-to-talk is stable (RFST-009 DONE).
  - **Core:** new dependency-free module
    `src/voice/hands-free-core.js` implements a
    hands-free turn-taking session against injected
    collaborators (audio frame stream, STT client,
    playback controller, clock - the RFST-009 pattern).
    Hands-free is an explicit user opt-in and is
    DISABLED by default: while disabled every frame is
    rejected, so push-to-talk behavior is unchanged.
    The core performs VAD itself from injected frame
    levels with configurable speech threshold and a
    silence hangover - speech ends only after the full
    hangover, so a short mid-utterance pause never
    splits one utterance into two turns, and blips
    below a minimum speech span are dropped as noise.
  - **Barge-in + feedback guard:** while playback is
    active, frames are treated as playback echo and
    suppressed, never as user speech - unless a frame
    at or above the higher barge-in threshold is
    sustained continuously for the full barge-in
    sustain window, which counts as a deliberate
    talk-over: playback.stop() is called exactly once,
    a barge-in is recorded, and that speech opens a
    new user utterance. Barge-in stops playback only:
    the core only fingerprints the injected chat
    history (never writes it) and every snapshot
    reports historyUnchanged, proving a barge-in does
    not rewrite chat history.
  - **No duplicate turns:** a closed utterance is
    transcribed exactly once and sent exactly once;
    duplicate transcribe / send calls for the same
    utterance are rejected with its send token, in
    the spirit of the RFST-009 dedupe guard. Turn
    states and timing (listening, speech, silence,
    transcription, round trip) are tracked on the
    injected clock. When STT is unavailable (no
    client, or a transcription error) the failure is
    recorded honestly and the session can fall back
    to push-to-talk mode or to the typed path, which
    sends through the same preview / send path.
  - **Suite:** `tests/hands-free.test.js`, 28 tests
    against mock VAD frames / STT / playback:
    opt-in default-off behavior, VAD detection,
    hangover and pause handling, timing, single-send
    turn-taking, the echo/feedback guard, sustained
    barge-in stopping playback exactly once with
    history untouched, and the STT-unavailable
    fallbacks.
  - **Full unit suite: 828/828** (800 at RFST-021
    HEAD + 28 new), 35 suites.
  - **GATED (not done):** live end-to-end hands-free
    turn-taking - GATED on an STT backend on the
    Z13 (RFST-008: Gufo ASR route 404, whisper not
    installed) and on live TTS playback to barge in
    on. No running service was started, reconfigured,
    or disturbed for this package. Gate tracker
    unchanged.

- 2026-11-17: **RFST-023 DONE - optional context-sensitive
  character image suggestions.** Evidence required (roadmap
  section 14): opt-in, non-destructive triggers. Section 10
  eligibility met: suggestions are one of the global user
  choices, offered only as an explicit opt-in.
  - **Core:** new dependency-free module
    `src/media/image-suggestions-core.js` implements an
    image suggestion session against injected collaborators
    (roster, clock, the RFST-015 router seam, an optional
    suggester, and the chat history - the RFST-009/022
    pattern). It builds ONLY on the RFST-014 registry
    categories and never duplicates registry data; it never
    dispatches or generates an image. Suggestions are
    DISABLED by default: while disabled, context evaluation
    is a no-op rejected with the named reason
    `suggestions_disabled`, no suggestion is ever produced,
    and no collaborator is called.
  - **Context-sensitive triggers:** signal classification
    is a deterministic keyword/signal function of the
    inputs - new character introduction, scene/location
    change, outfit mention, appearance mention, or a
    character simply present - and produces a suggestion
    {character, category, prompt sketch, trigger reason,
    confidence} only when a real signal fires. No signal
    yields no suggestion (`no_signal`); missing context is
    `no_context`. Categories come from the RFST-014
    registry (outfit -> full-body, appearance/introduction
    -> portrait, scene change -> scene-continuation).
  - **Non-destructive:** a suggestion is a proposal only.
    It never auto-generates and never inserts into chat;
    the injected chat history is only fingerprinted, never
    written, and every result reports historyUnchanged
    (the RFST-022 pattern). The user must explicitly
    accept - which returns the request for the injected
    RFST-015 router seam, called exactly once - or dismiss,
    which records the dismissal. A resolved suggestion
    cannot be accepted or dismissed twice.
  - **Throttling:** repeated suggestions for the same
    character + trigger are suppressed by a cooldown
    window on the injected clock (`cooldown_active`), a
    per-session maximum applies (`session_limit_reached`),
    and a dismissal snoozes that character + trigger for
    longer than the plain cooldown (`dismissed_snooze`).
  - **Honesty:** a character outside the provided roster
    is reported `unknown_character` and never suggested;
    no character is ever invented. A suggester
    collaborator that throws or offers nothing is recorded
    `suggester_unavailable`. Nothing ever throws.
  - **Suite:** `tests/image-suggestions.test.js`, 33 tests
    against a mock router seam / suggester / fake clock:
    opt-in default-off and disabled no-op behavior, every
    trigger kind, determinism, no-signal and no-context
    reasons, unknown-character honesty, suggester failure
    honesty, history-unchanged proof, accept returning the
    router request exactly once, dismissal recording, and
    cooldown / snooze / session-cap throttling.
  - **Full unit suite: 861/861** (828 at RFST-022 HEAD
    + 33 new), 36 suites.
  - **GATED (not done):** live image generation from an
    accepted suggestion - GATED on ComfyUI being started
    (the RFST-013..016 live legs). No running service was
    started, reconfigured, or disturbed for this package,
    and ComfyUI was not started. Gate tracker unchanged.

- 2026-11-17: **RFST-024 DONE - multi-character voice
  routing refinements.** Evidence required (roadmap
  section 14): "Group chat speaker handling tested."
  - **Core:** new dependency-free module
    `src/voice/multi-character-voice-core.js` implements
    a group-chat voice router against injected
    collaborators (renderer / TTS client, segmenter,
    clock - the RFST-009/022 pattern). It builds ONLY on
    the RFST-007 segmentation output shape
    ({ type, text } from parseMessageSegments) and the
    RFST-006 AllTalk contract seam: messages arrive
    already segmented, or as raw text plus an injected
    segmenter with that same output shape; segmentation
    logic is never duplicated. The core only SELECTS
    routes; dispatch happens through the injected
    renderer seam exactly once per routed segment.
  - **Speaker handling:** dialogue segments are voiced
    by the message speaker's per-character assigned
    voice; narration segments (RFST-007 types 'other'
    and 'action', plus 'narration') are voiced by the
    narrator voice. Messages are routed in list order
    and segments in message order, so speaker changes
    across and within a turn keep their turn order.
    Routing is DISABLED by default (the global voice
    off state): while disabled, no routing happens and
    nothing is dispatched.
  - **Fallback + honesty:** a KNOWN character with no
    voice assignment uses the configured default /
    fallback voice, and that fallback use is always
    recorded on the route, in the result, and in the
    router counters - a voice is never invented or
    randomized silently, and with no fallback voice
    configured the segment is reported unrouted
    (`voice_not_assigned`), never guessed. An UNKNOWN
    speaker (in neither the roster nor the
    assignments) is reported in unknownSpeakers and
    its dialogue is NOT voiced as someone else;
    narration attached to it still goes to the
    narrator voice. Nothing ever throws: malformed
    messages, a missing renderer, and renderer
    failures are recorded and reported.
  - **No duplicates, no mutation:** each message id
    (or a content fingerprint when no id is given) may
    be routed only once per router; a repeat is
    reported as a duplicate and dispatches nothing,
    in the RFST-009 dedupe spirit. Routing never
    mutates chat history or the routed messages: the
    injected history is only fingerprinted, never
    written, and every result reports
    historyUnchanged (the RFST-022/023 pattern).
  - **Suite:** `tests/multi-character-voice.test.js`,
    40 tests against a mock renderer and the real
    RFST-007 segmenter: default-off behavior, assigned
    / narrator / fallback resolution, in-order speaker
    changes, unknown-speaker honesty, duplicate
    rejection and reset, history-unchanged proof,
    renderer failure honesty, and malformed input.
  - **Full unit suite: 901/901** (861 at RFST-023
    HEAD + 40 new), 37 suites.
  - **GATED (not done):** live group voice render -
    GATED on live AllTalk render / GPU headroom per
    RFST-006 gating. No running service was started,
    reconfigured, or disturbed for this package, and
    AllTalk was not started. Gate tracker unchanged.

- 2026-11-17: **RFST-025 DONE - packaging and one-click
  local diagnostics.** Evidence required (roadmap
  section 14): "Reproducible deployment instructions."
  - **Deployment instructions:** new root-level document
    `DEPLOYMENT_RuneForgeAI.md` (no README.md was touched)
    covers cloning the fork branch
    `yrsa/our-sillytavern`, native install (no containers),
    configuring one machine-wide endpoint per service,
    the roadmap section 17 startup order, updating, and
    running the one-click diagnostics. Hosts appear by
    role only (ui-host / inference-host / services-host)
    and example endpoints are loopback with placeholder
    ports - no real hostnames, private addresses, or
    credentials.
  - **Core:** new dependency-free module
    `src/integration/diagnostics-core.js` implements a
    one-click local diagnostics runner against injected
    collaborators (probe, system-info provider, config
    provider, clock - the RFST-018/020 pattern; no real
    I/O in the core). It runs a named set of local
    checks: runtime/Node.js version, required config
    presence, free disk space, and one reachability
    check per configured service endpoint with named
    states (reachable / unreachable / unconfigured).
  - **Honesty, never faking:** the runner NEVER throws -
    collaborator failures are recorded as failed/warned
    checks with reasons. An unreachable OPTIONAL service
    is a warning in the report, never hidden and never
    counted as a pass; an unreachable required service
    or a missing required config value is a failure.
    The summary counts pass/warn/fail honestly.
  - **Copyable report, secrets redacted:** the runner
    produces a single plain-text diagnostic report
    (deterministic for a given run) with secrets
    redacted in the RFST-018 spirit - URL userinfo
    stripped, secret-looking query parameters and
    key=value / Bearer secrets replaced.
  - **Suite:** `tests/diagnostics.test.js`, 24 tests
    against a mock probe, fake system-info/config
    providers, and a fake clock: all-checks-pass,
    unreachable optional/required services recorded
    honestly, missing config recorded, secret redaction
    in the report, never-throws on collaborator failure,
    and a deterministic report.
  - **Full unit suite: 925/925** (901 at RFST-024
    HEAD + 24 new), 38 suites.
  - **GATED (not done):** live one-click diagnostics
    run on the Windows UI host - GATED on the F15 UI
    host. No running service was started, reconfigured,
    or disturbed for this package, and AllTalk, the
    second brain, and Gufo were not disturbed. Gate
    tracker unchanged.

- 2026-11-17 13:01 EST: **Keeper tick - no builder live, head verified.**
  Local HEAD aeaa638379 matches the fork remote head for
  yrsa/our-sillytavern exactly; working tree clean. 24 of 25
  packages are DONE and banked; the only remaining package is
  RFST-008, still QUEUED/GATED. Its gating was re-verified
  read-only on purpleraider this tick: Gufo ASR route still
  returns 404 and neither whisper nor faster-whisper is
  installed on the Z13, so no backend exists to benchmark.
  No service was changed and no work was started on the
  gated package. Gates unchanged (only Gate C passed; the
  other gates wait on their gated live legs).

- 2026-11-17 13:21 EST: **Keeper tick - no builder live, head verified.**
  Local HEAD 8ecf668489 matches the fork remote head for
  yrsa/our-sillytavern exactly; working tree clean. 24 of 25
  packages are DONE and banked; the only remaining package is
  RFST-008, still QUEUED/GATED. Its gating was re-verified
  read-only on purpleraider this tick: Gufo is running but its
  ASR route still returns 404, and neither whisper,
  whisper-cli, nor faster-whisper is installed on the Z13,
  so no STT backend exists to benchmark. No service was
  changed and no work was started on the gated package.
  Gates unchanged (only Gate C passed).
- 2026-11-17 13:31 EST: **Keeper tick - no builder live, head verified.**
  Local HEAD 229be8948b matches the fork remote head for
  yrsa/our-sillytavern exactly; working tree clean. 24 of 25
  packages are DONE and banked; the only remaining package is
  RFST-008, still QUEUED/GATED. Its gating was re-verified
  read-only on purpleraider this tick: Gufo is running
  (GET /v1/models lists only the gemma chat model), its ASR
  route POST /v1/audio/transcriptions still returns 404, and
  neither whisper, whisper-cli, nor faster-whisper is
  installed on the Z13, so no STT backend exists to benchmark.
  No service was changed and no work was started on the
  gated package. Gates unchanged (only Gate C passed).
- 2026-11-17 13:41 EST: **Keeper tick - no builder live, head verified.**
  Local HEAD 28d135befd matches the fork remote head for
  yrsa/our-sillytavern exactly; working tree clean. 24 of 25
  packages are DONE and banked; the only remaining package is
  RFST-008, still QUEUED/GATED. Its gating was re-verified
  read-only on purpleraider this tick: Gufo is running
  (GET /v1/models lists only the gemma chat model), its ASR
  route POST /v1/audio/transcriptions still returns 404, and
  neither whisper, whisper-cli, nor faster-whisper is
  installed on the Z13, so no STT backend exists to benchmark.
  No service was changed and no work was started on the
  gated package. Gates unchanged (only Gate C passed).
- 2026-11-17 13:51 EST: **Keeper tick - no builder live, head verified.**
  Local HEAD 52801724dc matches the fork remote head for
  yrsa/our-sillytavern exactly; working tree clean. 24 of 25
  packages are DONE and banked; the only remaining package is
  RFST-008, still QUEUED/GATED. Its gating was re-verified
  read-only on purpleraider this tick: Gufo is running
  (gufo-resident.service active, GET /v1/models lists only
  the gemma chat model), its ASR route POST
  /v1/audio/transcriptions still returns 404, and neither
  whisper, whisper-cli, nor faster-whisper is installed on
  the Z13, so no STT backend exists to benchmark.
  No service was changed and no work was started on the
  gated package. Gates unchanged (only Gate C passed).
