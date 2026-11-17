# RuneForgeAI SillyTavern: Distributed AI Companion Roadmap

**Project:** Custom SillyTavern fork for a private, immersive, local-first AI companion environment  
**Repository:** https://github.com/hrabanazviking/SillyTavern  
**Upstream:** https://github.com/SillyTavern/SillyTavern  
**Plan authored:** 2026-11-17  
**Status:** Architecture and implementation roadmap, **not** a claim that features have been implemented  
**Target branch at planning time:** release (SillyTavern 1.19.0 as inspected)  
**License:** Preserve SillyTavern's GNU AGPL-3.0 terms, copyright, notices, and network-source obligations.

> **North star:** Keep SillyTavern's mature character-first user experience intact. Make it the friendly control deck for powerful, independently managed local AI services. Rich personality, dialogue, and roleplay are primary; TTS, images, speech recognition, and optional actions enhance the text instead of replacing or hiding it.

---

## 1. Vision, explicit owner decisions, and boundaries

This fork will serve one person's character-driven AI environment across three existing computers. It must prioritize reliability, extensibility, detailed characters, high-quality dialogue, roleplay, expressive emotes, private on-premises inference, and very little repetitive character-by-character configuration.

### Firm decisions

1. **SillyTavern remains the primary UI** on the middle Windows laptop with the largest/best typing and viewing setup. Avoid rebuilding a frontend that already works.
2. **The main text inference server is a personally modified Gufo** hosted on the AMD Ryzen AI MAX+ 395 / Radeon 8060S / 128 GB unified-memory ASUS ROG Flow Z13 running Linux.
3. **AllTalk V2 provides TTS** as an independent service on the older Linux ASUS ROG Zephyrus G14 with an RTX 2060 6 GB GPU.
4. **Speech-to-text runs on the Z13** as a service, initially benchmarking Whisper/faster-whisper and Gufo's Qwen3-ASR implementation or another suitable option.
5. **ComfyUI runs on the Z13** and provides local image generation. It selects among locally available workflows/models for photorealistic adult characters and other requests. The ComfyUI process can remain available, but image models should be unloaded when idle or once a job finishes, to return resources to text inference.
6. **The existing second brain stays on the G14** as the source of knowledge for every character.
7. **Every character automatically receives the same, full, read-only retrieval access to all second-brain collections.** No per-character collection selection, permission menus, whitelists, or individual knowledge setup. Enforce read-only at the service/data layer, not by relying on a prompt.
8. **Do not give characters external file-editing or coding tools as part of this project.** Knowledge retrieval is not file-edit access.
9. **Preserve the entire original character message and visible emotes.** Any optional action detection, TTS preparation, or image trigger must be non-destructive.
10. **No compulsory short/simple character prompts.** Retain full character cards, detailed personality instructions, lorebooks, scenario material, sample dialogue, and roleplay conventions.
11. **Local-first by default.** No cloud API dependency and no hidden automatic upload to third parties. Use explicitly configured local and tailnet endpoints.
12. **Minimize upstream divergence.** First prefer normal SillyTavern settings, then existing extensions, then new frontend extensions and backend plugins; fork core source only for demonstrated gaps.
13. **This is a reusable public code fork, not a publication of private data.** Public Git commits must not contain chat logs, second-brain records, personal media, paid model assets, service credentials, private Tailscale addresses, or unrestricted backups.

### Non-goals for the initial release

- No replacement of the whole SillyTavern interface or character-card standard.
- No new all-purpose agent framework or autonomous operating-system agent inside SillyTavern.
- No per-character access control to the second brain.
- No requirement to use Voxta, its action conventions, or its character-prompt philosophy.
- No forced visual actions in place of textual roleplay.
- No automatic public internet exposure of any inference, TTS, STT, image, or knowledge service.
- No mandatory cloud accounts or subscription services.
- No large-scale rewrite of the second-brain implementation.

---

## 2. Known starting point and technical reconnaissance

The fork was inspected on 2026-11-17. Its default branch is **release**, and package.json declares **SillyTavern 1.19.0** with **AGPL-3.0** licensing. This is a snapshot, not a guarantee of future upstream file stability.

### Existing extension and server integration points

| Verified file or path in this fork | Why it matters |
| --- | --- |
| public/scripts/openai.js | Existing chat-completion client/preset/model/API flow; review for Gufo compatibility and parameter handling. |
| src/endpoints/openai.js | Existing server-side handling of chat-completion providers; potential compatibility and proxy inspection point. |
| public/scripts/extensions/tts/alltalk.js | Built-in AllTalk provider, including server-version selection, voices, narrator options, and streaming choices. |
| public/scripts/extensions/tts/index.js | Central TTS event/queue behavior; inspect before introducing interruption or segmenting rules. |
| public/scripts/extensions/stable-diffusion/index.js | Existing image generation / ComfyUI integration and workflow selection. |
| public/scripts/extensions/stable-diffusion/comfyWorkflowEditor.html | Existing ComfyUI workflow editor UI; reuse rather than replacing. |
| src/endpoints/stable-diffusion.js | Server-side image generation and remote backend requests. |
| src/endpoints/speech.js | Existing speech-related server routes; inspect for suitability before extending. |
| public/scripts/extensions.js | Client extension framework / settings integration. |
| public/scripts/events.js and public/scripts/st-context.js | Event and context access touchpoints; use documented APIs rather than undocumented internal state where possible. |
| public/scripts/tool-calling.js | Inspect only if later implementing a narrowly scoped, read-only retrieval tool path. Do not accidentally add write-capable tool execution. |
| public/scripts/world-info.js | Existing lorebook behavior to preserve. |
| public/scripts/message-formatter.js | Rendering path to regression-test for unchanged emotes and narration. |
| src/plugin-loader.js and plugins/ | Optional Node.js server-plugin mechanism. In this inspected version, server plugins are disabled by default unless configured. |
| tests/ | Existing automated test patterns, including image-generation and frontend tests. |

The built-in AllTalk provider defaults to an endpoint on port **7851** and has a **v2** server version option. Its streaming option and narrator controls must be evaluated together: the inspected provider UI indicates narrator controls are disabled during its streaming mode. Do **not** assume streaming plus separate narrator voices works out of the box. Test it or implement a compatible adapter.

SillyTavern documentation already describes configuring ComfyUI with **API-format workflows**. Use that supported integration first; develop a dynamic workflow router only where the built-in selector is insufficient.

**Gufo reference:** https://github.com/gufo-org/gufo  
Gufo documents an OpenAI-compatible **POST /v1/chat/completions**, **GET /v1/models**, **GET /ready**, and **GET /health**. Its server can return **503 while loading** and **400 for fields it does not support**. It also documents STT via **POST /v1/audio/transcriptions** when an ASR service is running. A customized Gufo build may vary: feature-detect the actual deployment.

**Other official references:**

- SillyTavern docs: https://docs.sillytavern.app/
- SillyTavern image-generation docs: https://docs.sillytavern.app/extensions/stable-diffusion/
- SillyTavern TTS docs: https://docs.sillytavern.app/extensions/tts/
- SillyTavern AllTalk docs: https://docs.sillytavern.app/extensions/alltalk/
- Gufo server/API docs: https://github.com/gufo-org/gufo/blob/main/docs/server.md
- ComfyUI: https://github.com/comfyanonymous/ComfyUI
- AllTalk V2: https://github.com/erew123/alltalk_tts

**Engineering caveat:** Verify the exact endpoints, arguments, hardware support, and API behavior at implementation time. Some capabilities are documented upstream but not yet demonstrated on the owner's modified binaries or system.

---

## 3. Target deployment topology

| Node | Intended OS and hardware | Services | Responsibilities |
| --- | --- | --- | --- |
| **Frontend / Windows laptop** | ASUS TUF F15; Intel i7-12700H, RTX 4070, large preferred display/keyboard | Customized SillyTavern server and browser UI | Chat, character management, lorebooks, prompt orchestration, microphone capture, audio playback, displayed images, user settings. |
| **Inference / Linux laptop** | ASUS ROG Flow Z13 (2025), Ryzen AI MAX+ 395, Radeon 8060S, 128 GB unified memory | Modified Gufo, STT/ASR server, ComfyUI, lightweight resource coordinator | Stream LLM responses; transcribe speech; generate images on demand; prioritize interactive generation over large image jobs. |
| **Voice + knowledge / Linux laptop** | ASUS ROG Zephyrus G14, RTX 2060 6 GB, 40 GB RAM | AllTalk V2, existing second brain, read-only retrieval gateway | Generate speech and answer knowledge lookups; keep second-brain storage isolated from SillyTavern writes. |

All three communicate over a **trusted private LAN or Tailscale tailnet**. The Windows SillyTavern host must be able to reach the remote APIs. Do not assume that 127.0.0.1 on Windows points to either Linux machine.

### Architecture diagram

~~~mermaid
flowchart TB
    U[User: text and microphone] --> ST[SillyTavern fork on Windows TUF F15]
    ST --> UI[Character cards, lorebooks, chat, visible emotes, galleries]
    ST --> ORCH[Lightweight integration / orchestration layer]
    ORCH --> GUFO[Modified Gufo: Z13 Linux]
    ORCH --> ASR[Whisper or Gufo ASR: Z13 Linux]
    ORCH --> COMFY[ComfyUI model/workflow router: Z13 Linux]
    ORCH --> TTS[AllTalk V2: G14 Linux]
    ORCH --> RAG[Universal read-only second-brain API: G14 Linux]
    RAG --> DB[(All collections: second brain)]
    GUFO --> ORCH
    ASR --> ORCH
    COMFY --> ORCH
    TTS --> ORCH
    RAG --> ORCH
    ORCH --> ST
    ST --> U
~~~

### Port and address conventions

All values below are **examples, not discovered machine addresses or promised service defaults**.

| Service | Example URL | Purpose |
| --- | --- | --- |
| Gufo | http://Z13-TAILNET-NAME:8080/v1 | Chat-completions API. Verify actual listener and access rules. |
| Gufo ready | http://Z13-TAILNET-NAME:8080/ready | Readiness probe; not the same as liveness. |
| STT | http://Z13-TAILNET-NAME:8750/v1/audio/transcriptions | Illustrative STT port if using a separate service; if Gufo ASR is used, configure its actual address and port instead. |
| ComfyUI | http://Z13-TAILNET-NAME:8188 | Example ComfyUI HTTP API endpoint. |
| AllTalk V2 | http://G14-TAILNET-NAME:7851 | Provider endpoint; verify actual bind address/port. |
| Second-brain gateway | http://G14-TAILNET-NAME:8733 | Proposed project-specific read-only service, not a pre-existing API claim. |
| SillyTavern | Local Windows installation URL | Browser UI on the Windows machine. |

Prefer tailnet DNS names, not hardcoded DHCP IP addresses. Keep ports in an editable **machine-level integration profile**, separate from character cards. For HTTP services with no built-in authentication, use a restricted private network and/or an authenticated gateway. Never expose raw Gufo, ComfyUI, or knowledge endpoints to the public internet.

---

## 4. Integration approach: preserve upstream

Use a layered design:

**Layer A: Existing SillyTavern built-ins**  
Character cards, World Info, chat persistence, completion settings, AllTalk TTS, ComfyUI integration, and normal UI.

**Layer B: New frontend extension**  
A small RuneForgeAI companion bridge for service health, global configuration, retrieval context insertion, voice controls, and optional image request triggers.

**Layer C: Optional server plugin or local bridge**  
Only where direct frontend calls fail due to browser CORS, service credentials, request normalization, streaming semantics, or auditability. Add a project-owned HTTP adapter rather than scattering special cases throughout upstream.

**Layer D: Independent AI services**  
Modified Gufo, AllTalk V2, Whisper/ASR, ComfyUI, and the second-brain reader. They should remain deployable and testable without SillyTavern.

### Design rules for all adapters

- Every service gets a provider name, base URL, health check, timeout, cancellation policy, and a small capabilities description.
- Configuration is global per installation, **not copied into each character**.
- Preserve a canonical untouched character output message. Derived narration/audio/action annotations are separate data.
- Stream progressively where supported; never wait for a full generation unless the mode requires it.
- Distinguish **offline**, **loading**, **ready**, **degraded**, **busy**, **timed out**, and **misconfigured**.
- If voice, images, or retrieval fails, ordinary text chat must still work.
- No privileged shell, filesystem, or code-edit execution APIs are added for the characters.
- Avoid building a frontend dashboard jungle; prefer a compact single diagnostics/settings pane.
- Pin integration versions and test after upstream merges.

### Suggested new project-owned components (proposals)

- **RuneForgeAI Companion Bridge**: frontend extension implementing global integration settings and event hooks.
- **RuneForgeAI Service Gateway**: small optional backend plugin/reverse proxy for stable API contracts.
- **RuneForgeAI Knowledge Reader**: read-only service running alongside the second brain.
- **RuneForgeAI Media Router**: image workflow/model selector and idle-memory controller on the Z13.
- **RuneForgeAI Health Matrix**: simple diagnostic view surfacing each service's readiness, latency, and last failure.

Do not assume these components exist yet. File layout and final names should be finalized only after an extension API spike.

---

## 5. Phase 0: repo baseline, backups, and a working reference chat

**Priority:** P0. **Goal:** Establish a verifiably working baseline before modifying anything.

### Tasks

- [ ] Inspect fork-to-upstream divergence, existing branches, pending commits, active extensions, and release history.
- [ ] Record the exact Git SHA, SillyTavern version, Node.js version, and extension versions.
- [ ] Confirm Windows Node requirements, startup procedure, browser compatibility, and current character-card storage.
- [ ] Export a backup of the owner's SillyTavern user data **outside the public repository** before making changes.
- [ ] Preserve existing characters, World Info entries, prompt presets, avatars, chats, and image folders.
- [ ] Install/run the clean fork on the Windows laptop; verify one local chat with a basic test backend.
- [ ] Create a development branch for each feature; keep release branch installable.
- [ ] Create an upgrade strategy from upstream release (and optionally staging only when testing demands it).
- [ ] Add baseline scripted lint and smoke tests; record known upstream failures instead of treating them as regressions.

### Deliverables and acceptance

- A documented baseline revision.
- A repeatable Windows startup and backup/restore procedure.
- Successful chat with no added extensions.
- Successful restore of a sample character/chat from backup.
- Nothing in the public repo contains live character histories, personal model vault contents, or service secrets.

---

## 6. Phase 1: Gufo as the primary text inference service

**Priority:** P0. **Machine:** Z13. **User experience:** SillyTavern streams full, character-rich replies from the modified Gufo server.

### Tasks

- [ ] Start the modified Gufo LLM service on the Z13 using a model known to fit the memory budget.
- [ ] Record actual commands, version, model ID, host/port, and any build-specific API differences in **local, uncommitted configuration**.
- [ ] Confirm cross-device access from the Windows laptop; ensure private interfaces are correctly bound.
- [ ] Probe GET /ready and GET /v1/models from Windows.
- [ ] Test POST /v1/chat/completions with streaming off and on.
- [ ] Configure SillyTavern's **OpenAI-compatible Chat Completion / custom endpoint** path first.
- [ ] Confirm exact base URL format, model name, message roles, and request headers.
- [ ] Build a capability compatibility test for supported sampling parameters, stop sequences, reasoning options, image input, streaming, tool calls, and structured output.
- [ ] Gufo may reject unsupported fields with HTTP 400: remove or translate unsupported parameters in a **small adapter** only when necessary; do not silently discard major prompting behavior.
- [ ] Check whether SillyTavern's system/developer message ordering and instruction template match the selected model.
- [ ] Verify large character cards and World Info entries remain present and ordered in the final prompt.
- [ ] Handle a 503 / loading state with readiness polling and bounded retry, not an infinite spinner.
- [ ] Support user cancellation mid-generation and safe recovery after model restart.
- [ ] Preserve the user's original raw roleplay output, including markdown, line breaks, and emotes.
- [ ] Keep externally executable tool calling **disabled** unless a later explicitly scoped feature needs a non-write retrieval call.

### Adapter contract (illustrative)

~~~json
{
  "provider": "modified-gufo",
  "base_url": "http://Z13-TAILNET-NAME:8080/v1",
  "model": "ACTUAL_SERVED_MODEL_ID",
  "stream": true,
  "health_url": "http://Z13-TAILNET-NAME:8080/ready",
  "timeout_ms": 120000,
  "capabilities": {
    "chat_completions": true,
    "streaming": true,
    "tool_calls": "probe",
    "vision": "probe",
    "reasoning": "probe"
  }
}
~~~

**Not a configuration file to commit as-is.** The model ID, URL, timeout, and capabilities require deployment-time validation.

### Acceptance tests

- [ ] A long, detailed character card is preserved and produces coherent character-specific replies.
- [ ] Tokens stream visibly and can be stopped without breaking the next turn.
- [ ] Unsupported completion fields produce a readable diagnostic rather than corrupting the prompt.
- [ ] Gufo restarting or loading cannot permanently freeze the chat UI.
- [ ] No automatic cloud fallback occurs.
- [ ] Text generation functions even if TTS, STT, ComfyUI, or the second brain is temporarily unavailable.

---

## 7. Phase 2: AllTalk V2 on the G14

**Priority:** P0. **Machine:** G14. **Goal:** Realistic local voice playback without forcing the character to sacrifice descriptive text.

### Tasks

- [ ] Install/configure AllTalk V2 as a standalone Linux service on the G14.
- [ ] Verify compatibility of candidate TTS engines with the RTX 2060 **6 GB VRAM**; do not assume the highest-quality model fits.
- [ ] Confirm available voices and backend readiness before integrating with SillyTavern.
- [ ] Start with the **existing** public/scripts/extensions/tts/alltalk.js provider and configure the real G14 endpoint.
- [ ] Select the v2 server mode; validate that its voice-list and generation routes work.
- [ ] Benchmark a normal paragraph, a long reply, multiple sequential replies, and narrator/dialogue alternation.
- [ ] Test both standard and streaming generation. The inspected provider may disable narrator features in streaming mode.
- [ ] If simultaneous streaming and narrators are required, implement a separate TTS text segmentation / routing adapter rather than destroying narration text.
- [ ] Make voice maps optional: a global fallback voice must work for any newly imported character with no setup.
- [ ] Optionally allow one-click character-to-voice mapping without making it mandatory.
- [ ] Support text-to-audio splitting by sentence/segment while preserving original message offsets.
- [ ] Use bounded generation queues, stop/replay controls, cancellation, and reconnect behavior.
- [ ] Avoid speaking raw markup, control strings, or action metadata as though it were dialogue.
- [ ] Keep a simple global toggle for auto-speak, manual speak, narration inclusion, and subtitles.
- [ ] Monitor coexistence with the second-brain process on G14; do not starve retrieval latency.

### Mandatory narrative-preservation rule

Given the canonical response:

> *She places the rune stone on the table and smiles.* "Come closer. I have something to show you."

The **text remains exactly visible** in chat. TTS can receive an independently prepared representation, such as dialogue-only, narrator plus dialogue, or role-assigned segments. Neither the TTS provider nor an action parser may remove the original emote.

### Acceptance tests

- [ ] No text or emote disappears when TTS is enabled.
- [ ] Voice uses the G14 server, not an accidental cloud provider.
- [ ] Changing a voice or TTS engine does not require editing character prompts.
- [ ] A failed TTS job never deletes a generated text message.
- [ ] Audio stop or barge-in stops playback without rewriting chat history.
- [ ] AllTalk running alongside the second brain remains responsive under realistic load.

---

## 8. Phase 3: STT service on the Z13 and voice conversation flow

**Priority:** P1. **Machine:** Z13. **Goal:** Microphone-to-text-to-LLM-to-speech flow, while text chat remains the default fallback.

### Candidate ASR implementations

1. **Whisper / faster-whisper** behind a self-hosted HTTP API.
2. **Gufo Qwen3-ASR**, which documents POST /v1/audio/transcriptions, if present in the locally modified build.
3. Another locally benchmarked recognizer meeting the accuracy and hardware requirements.

Choose based on measured quality for natural speech, accents, punctuation, proper names, Norse names, low-level background noise, latency, and interference with concurrent Gufo inference. Do not hard-code a winner before tests.

### Tasks

- [ ] Choose browser microphone-capture path and ensure Windows microphone permissions work.
- [ ] Determine whether an existing SillyTavern extension suffices or a small bridge must be written.
- [ ] Implement push-to-talk first, as the most reliable initial input mode.
- [ ] Add optional VAD / hands-free mode only after push-to-talk is stable.
- [ ] Send audio to the Z13 STT endpoint, not to an external recognizer.
- [ ] Support common audio formats, bounded upload size, timeouts, and transcript correction/editing before send.
- [ ] Provide text preview and clear distinction between partial and final transcriptions.
- [ ] Add explicit user-controlled auto-send and optional auto-play TTS.
- [ ] Handle talk-over/interruption and avoid microphone feedback loops from AllTalk playback.
- [ ] Track capture start, upload, transcription, response-first-token, first audio, and total round-trip time.
- [ ] When STT is unavailable, preserve manual typing as a fully functional path.

### Acceptance tests

- [ ] Push-to-talk transcribes speech correctly and returns text for optional edit.
- [ ] User can cancel and retry an STT request.
- [ ] No double-send after reconnect or partial transcription.
- [ ] TTS playback does not recursively trigger another user message.
- [ ] All cloud STT options remain disabled in the local profile.
- [ ] Heavy image generation does not indefinitely block a voice turn.

---

## 9. Phase 4: universal read-only second-brain knowledge

**Priority:** P0/P1. **Machine:** G14. **Goal:** Every character can retrieve relevant knowledge from the complete second brain automatically, without individual configuration.

### Exact behavior required

- **Single shared integration** enabled once for the SillyTavern installation.
- **All characters have identical access** to the full searchable contents of the second brain.
- **All collections/indexes are included** in retrieval, without character-by-character scopes.
- **Read-only in the data service**, regardless of what the model says or requests.
- **No second-brain writes, edits, deletes, reindexing, or ingestion** from SillyTavern.
- **Retrieval is not a capability to edit unrelated external files.**
- **No duplicated per-character knowledge database.** The G14 remains the authority.
- Character personality, prompt structure, and lorebooks remain independent of the shared knowledge service.

### Proposed read-only gateway

Expose a minimal endpoint from the G14 that queries the existing second brain through its actual supported search/query interface. The gateway must be designed **after inspecting the owner's second-brain APIs and database schema**, not invented against an assumed implementation.

Possible service interface:

~~~json
{
  "request": {
    "query": "What do we know about the topic being discussed?",
    "top_k": 8,
    "max_context_tokens": 1800,
    "include_all_collections": true
  },
  "response": {
    "results": [
      {
        "id": "opaque-record-id",
        "title": "Knowledge excerpt title",
        "text": "Relevant retrieved excerpt",
        "source": "knowledge-source-reference",
        "score": 0.87
      }
    ],
    "read_only": true
  }
}
~~~

This is a **proposed interface sketch**, not a representation of a working second-brain API. IDs, sources, scores, schema, and token budgets should be adapted to the real system.

### Retrieval pipeline

1. A chat turn arrives in SillyTavern.
2. Global bridge formulates a retrieval query from the current discussion and recent conversational context.
3. The G14 gateway searches **across every collection**.
4. Deduplicate, rank, and trim results to a bounded token budget.
5. Inject retrieved snippets into an appropriate ephemeral context section, with source identifiers where available.
6. Preserve original character instructions, World Info, and the visible chat transcript.
7. Send augmented prompt to Gufo on the Z13.
8. **Do not write retrieved or generated text back to the second brain.**

### Engineering details

- [ ] Discover the existing second-brain system's actual query API, index layout, embedding compatibility, and permissions.
- [ ] Build a small **read-only** retrieval endpoint; prefer database credentials/OS access that cannot modify storage.
- [ ] Ensure no HTTP endpoints capable of insert/update/delete/reindex exist in the exposed reader.
- [ ] Search all collections in one request or perform a transparent server-side fan-out with merged ranking.
- [ ] Use hybrid lexical/vector search if supported by the underlying second brain; do not mandate a new vector database.
- [ ] Define a global retrieval budget, relevance cutoff, and deduplication strategy without per-character settings.
- [ ] Preserve citation or provenance tags **inside prompt context** so the model can distinguish stored knowledge from instructions.
- [ ] Treat knowledge excerpts as data, not commands to change configuration or execute tools.
- [ ] Prevent recursive retrieval loops and repetitive injection of near-identical snippets.
- [ ] Gracefully handle empty responses, slow searches, backend restart, malformed results, and long records.
- [ ] Use one shared health indicator and one configuration profile for all characters.
- [ ] Allow a global on/off setting for troubleshooting; never require users to customize each character.
- [ ] Preserve G14 memory/CPU budget for AllTalk and second-brain services simultaneously.

### Acceptance tests

- [ ] Import an entirely new character and start chatting: knowledge retrieval works with **zero character configuration**.
- [ ] A query matching documents in different collections returns relevant results from both, subject only to relevance and token limits.
- [ ] A write attempt through the gateway is rejected; the backing second brain remains byte-for-byte unchanged.
- [ ] Absent knowledge does not cause invented source quotations or application failure.
- [ ] Knowledge downtime never blocks ordinary text chat.
- [ ] Ingesting no new information into SillyTavern does not degrade existing second-brain data.

**Crucial distinction:** Full database **search access** is not the same as stuffing the entire database into each prompt. All indexed content must be eligible for retrieval, while only the relevant excerpts are injected per turn.

---

## 10. Phase 5: ComfyUI, adult photorealism, model routing, and idle unload

**Priority:** P1. **Machine:** Z13. **Goal:** Rich local image generation on request, with good model selection and minimal idle resource consumption.

### User experience requirements

- Generate images from selected messages, explicit user commands, optional character-initiated image requests, or scene descriptions.
- Support portrait/face, full-body character, environment, illustration, scene continuation, and image editing workflows if locally available.
- Prioritize realistic adult women and high-quality portraits when the request calls for them; preserve support for other visual styles and subjects.
- Support consensual **adult-only** nude character imagery where allowed by the installed model's terms and the user's selected workflows. Do not infer adulthood from an ambiguous character description; do not generate sexualized minors.
- Do not force an image merely because a message contains an emote.
- Preserve all roleplay text; pictures attach alongside the narrative rather than replacing it.
- Avoid manual model loading for routine requests.
- Return image output and metadata to SillyTavern's existing gallery/chat display.
- After generation, unload image weights and free reclaimable memory when there are no queued jobs; keep the service ready to receive the next job.

### Architecture

**SillyTavern built-in ComfyUI workflow support** is the first integration path. A dedicated **Media Router** is added to choose the best available preset and manage model lifecycle.

Suggested model/workflow registry fields:

~~~yaml
workflows:
  photorealistic_portrait:
    workflow_file: local-workflows/photorealistic_portrait_api.json
    tags: [portrait, realistic, adult]
    priority: 100
    model_id: locally-installed-model-id
  full_body_character:
    workflow_file: local-workflows/full_body_api.json
    tags: [full-body, realistic, adult]
    priority: 90
    model_id: locally-installed-model-id
  scenery:
    workflow_file: local-workflows/environment_api.json
    tags: [environment, scenery]
    priority: 80
    model_id: locally-installed-model-id
~~~

This example is a **planned schema**. It deliberately does not invent installed model names. Actual model selection depends on benchmarked visual quality, availability, hardware compatibility, adult-content suitability where requested, and each model's usage license.

### Routing and resource-management tasks

- [ ] Inventory actual checkpoints, LoRAs, VAEs, CLIP encoders, and ComfyUI custom nodes in the owner's model vault without committing models to Git.
- [ ] Evaluate realistic image models and workflows through consistent private benchmark prompts. Score anatomy, identity continuity, prompt fidelity, runtime, memory use, and artifact rate.
- [ ] Build a manifest/registry for installed workflow+model combinations.
- [ ] Export ComfyUI workflows in **API format** and confirm compatibility with SillyTavern's workflow editor.
- [ ] Establish a prompt normalizer that does not silently erase descriptions, emotions, or scene context.
- [ ] Add request categorization and automatic workflow selection; allow manual workflow override from one global control.
- [ ] Create a queue with concurrency **1 initially** on Z13; do not assume simultaneous large Gufo and diffusion workloads fit well.
- [ ] Measure memory before/after model load and after cleanup; identify resident buffers and any backend-specific caching.
- [ ] When a job completes, check for additional jobs; if none, call ComfyUI's supported memory-release operation or its current equivalent after confirming the installed version's API.
- [ ] Distinguish **ComfyUI server stays alive** from **model weights remain loaded**. The desired idle state is a healthy HTTP service with no unnecessary image model residency.
- [ ] Add a tunable short idle grace period if immediate unload leads to excessive thrashing; default choice should prioritize freeing memory for Gufo.
- [ ] Ensure Gufo inference is favored when interactive chat and image generation compete. Consider pausing image dispatch until conversational latency returns to baseline.
- [ ] Keep image gallery storage, thumbnails, and output directories separate from Git-tracked source.
- [ ] Support cancel, failure/retry, timeout, queue depth, output validation, and visibility of selected workflow/model.
- [ ] Verify that any image model weights or LoRAs used in this personal setup permit the intended use; project code and weights have independent licenses.

### Idle-state invariant

**No active or queued image jobs → ComfyUI model weights released, within the measured cleanup window.** The ComfyUI process need not terminate. If a specific node or backend retains memory, document the limitation and evaluate whether restarting that worker is a better idle-cleanup strategy.

### Acceptance tests

- [ ] An image request automatically chooses a locally installed compatible workflow and produces a visible image.
- [ ] The user may manually select a workflow without editing character cards.
- [ ] Generated pictures never erase or replace narrative/emote text.
- [ ] No unrelated image generation occurs without a configured trigger.
- [ ] Once the queue drains, image-model residency decreases to the defined idle baseline.
- [ ] Gufo text chat can continue during or recover promptly after image work.
- [ ] Failed model loads and corrupt workflows do not crash SillyTavern or discard messages.

---

## 11. Phase 6: roleplay-first interaction engine

**Priority:** P0 for preservation, P2 for advanced enhancements.

The application must never reproduce the interaction pattern that motivated this fork: suppressing character actions and emotes in order to drive external visuals.

### Canonical message model

Maintain a separation between:

- **Canonical character reply:** Original generated markdown/text, including dialogue, narration, roleplay actions, and line breaks.
- **Derived spoken segments:** Audio-friendly narration/dialogue strings derived from the canonical reply.
- **Optional visual/action annotations:** Non-destructive tags used to suggest images, expressions, sound effects, or animation.
- **Provenance and retrieval context:** Background data for generation, not a replacement for visible narrative.
- **External media assets:** Image and audio attachments linked to the message.

### Required processing order

1. Receive Gufo output.
2. Save/display the complete character message.
3. Optionally parse the message into speech segments, keeping original byte/character offsets.
4. Optionally suggest a ComfyUI image based on user settings and context.
5. Optionally trigger harmless UI effects; never consume source text.
6. Associate audio and images with the unchanged original message.
7. On regeneration or swipe, invalidate only the derived outputs for the old version, not other conversation history.

### Tasks

- [ ] Write snapshot tests for complex markdown, nested quotation, action asterisks, Unicode, runes, line breaks, and mixed dialogue/narration.
- [ ] Preserve descriptive roleplay in ordinary display mode and any optional visual-novel layout.
- [ ] Support long-form replies without automatic truncation for the sake of TTS or action extraction.
- [ ] Support full character fields and World Info without requiring a short-character template.
- [ ] Give users global choices for automatic voice, manual voice, image-on-command, and optional image suggestions.
- [ ] Keep any image trigger opt-in, explainable, and reversible.
- [ ] Avoid unbounded automatic multi-step action loops.
- [ ] Test group chats, swipes, edits, regenerated messages, and alternative responses for media association correctness.

### Acceptance tests

- [ ] Raw generated reply equals the persisted/displayed canonical content, modulo existing intended SillyTavern markdown rendering.
- [ ] Turning off the new bridge produces the same narrative text experience as normal SillyTavern.
- [ ] Disabling TTS, media, and retrieval does not change the character-card format.
- [ ] New characters automatically inherit global integrations without per-character feature plumbing.

---

## 12. Phase 7: scheduling, resource priority, and resilience

The Z13 has powerful but **shared** CPU/GPU/unified-memory resources. Fast interactive text inference and large image generation may contend; G14 voice and second-brain queries share older CPU/RAM/GPU resources.

### Service priority policy

1. **Highest interactive priority:** Current Gufo chat generation and user-requested STT.
2. **Next:** Second-brain retrieval needed to complete the current prompt, running independently on G14.
3. **Next:** AllTalk speech generation / playback on G14.
4. **Lower / queueable:** ComfyUI image jobs on Z13, except an explicitly user-prioritized image request.
5. **Background:** Health polling, gallery cleanup, cache housekeeping, benchmarks.

This is a conceptual scheduling policy; implement through bounded queues and service-aware admission control rather than assuming Linux GPU scheduling can perfectly enforce these priorities.

### Common service states

| State | Meaning | UI / retry behavior |
| --- | --- | --- |
| Ready | Backend answering and model usable | Normal operation. |
| Loading | Process alive but weights or models not ready | Show loading; poll readiness within a time budget. |
| Busy | Resource/queue contention | Queue optional work; do not silently send duplicate requests. |
| Offline | Endpoint unreachable | Show clear service-specific message; keep text chat when possible. |
| Degraded | Errors/timeouts or slow responses | Permit manual retry and controlled fallback to typing. |
| Misconfigured | Unsupported endpoint/model/parameter | Show actionable diagnostics, not endless retry loops. |

### Tasks

- [ ] Add request IDs, cancellation tokens, job state tracking, and idempotent submission.
- [ ] Collect **local-only** measurements of TTFT, tokens/sec, prompt size, TTS first-audio latency, STT latency, RAG latency, image load/generation/unload time, memory utilization, and request failure rate.
- [ ] Establish reproducible baseline measurements before setting latency budgets.
- [ ] Avoid inventing performance claims: set explicit numerical pass/fail thresholds **after first hardware benchmarks**.
- [ ] Detect ComfyUI model residency and free memory safely after completed image jobs.
- [ ] Prevent race conditions where image cleanup unloads a model that a second image job is about to use.
- [ ] Rate-limit health probes and avoid excessive polling during long generations.
- [ ] Use exponential backoff for recoverable failures, with finite retry limits.
- [ ] Document service boot order and automatic restart behavior on Linux and Windows.
- [ ] Use startup readiness checks instead of assuming services boot simultaneously.
- [ ] Define a degraded mode for each failure combination.

### Failure behavior matrix

| Failure | Expected user experience |
| --- | --- |
| Gufo offline | Character inference unavailable with clear error; UI and chat history remain usable. |
| AllTalk offline | Text chat continues without voice. |
| STT offline | Typing and manual message sending continue. |
| ComfyUI offline | Chat and voice continue; optional image generation shows unavailable state. |
| Second brain offline | Character chat proceeds without retrieved knowledge, with a clear knowledge-status indicator. |
| G14 reboot | Both voice and knowledge temporarily unavailable; Gufo and SillyTavern still operate. |
| Z13 reboot | Text/STT/image unavailable temporarily; Windows UI and historical chats remain accessible. |
| Windows UI restart | Linux inference and knowledge services remain running; chats persist. |

---

## 13. Phase 8: clean settings and UX

The owner is strongest with backends and wants to avoid a complex custom frontend. Keep UX work intentionally narrow.

### Single global settings panel

Recommended sections:

**Connection status:** Gufo / AllTalk / STT / ComfyUI / Second Brain.  
**Service endpoints:** Edit one machine-wide URL per service, test connection, save.  
**Conversation:** Text-only, text+voice, push-to-talk, hands-free (optional).  
**Audio:** Default voice, narrator behavior, interruption, playback.  
**Images:** Auto model selection, manual workflow override, generation trigger, idle unload.  
**Knowledge:** One global enabled toggle, retrieval relevance and token budget. **No per-character collection controls.**  
**Diagnostics:** Last error, current state, simple copyable local debug report with secrets stripped.

### UX invariants

- Newly imported characters work immediately with the global configuration.
- No character must be reauthored or shortened for this system.
- Existing SillyTavern settings and extension menus remain functional.
- Service failures never hide chat messages or disable the typing interface.
- Preserve keyboard-oriented workflows on the Windows laptop.
- Maintain a fast, uncluttered UI; no full dashboard redesign in the first release.

---

## 14. Proposed backlog: implementation issues and acceptance

The table below can be split into GitHub issues when development begins. IDs are local planning identifiers, not existing GitHub issue numbers.

| ID | Priority | Work package | Evidence of completion |
| --- | --- | --- | --- |
| RFST-001 | P0 | Fork baseline and upstream-diff audit | Pinned baseline and tested Windows launch. |
| RFST-002 | P0 | Backup/restore and public repo exclusion rules | Restore drill; no private data committed. |
| RFST-003 | P0 | Gufo readiness + model capability probe | Real Z13 endpoint and model manifest validated. |
| RFST-004 | P0 | Gufo streaming chat-completion integration | Long-character text streams and cancels correctly. |
| RFST-005 | P0 | Preserve raw roleplay/emotes end-to-end | Automated snapshots pass. |
| RFST-006 | P0 | AllTalk V2 remote G14 connection | Remote voices list and speech render. |
| RFST-007 | P0 | TTS text segmentation with non-destructive narration | Visible emotes unchanged; spoken segments accurate. |
| RFST-008 | P1 | STT backends benchmark on Z13 | Whisper/Gufo-ASR results and selected backend. |
| RFST-009 | P1 | Push-to-talk and transcript correction | No duplicate messages; typed fallback. |
| RFST-010 | P0 | Discover second-brain query schema | Real API/DB interface documented privately. |
| RFST-011 | P0 | Read-only all-collections gateway | Search entire KB; write attempts rejected. |
| RFST-012 | P0 | Global zero-config RAG injection | New character gets knowledge automatically. |
| RFST-013 | P1 | ComfyUI remote endpoint baseline | API-format workflow returns image into chat. |
| RFST-014 | P1 | Image model/workflow inventory and benchmarks | Reviewed local registry with scoring. |
| RFST-015 | P1 | Automatic image workflow router | Correct category selection plus manual override. |
| RFST-016 | P1 | ComfyUI unload-on-idle lifecycle | Memory returns to defined idle state. |
| RFST-017 | P1 | Resource-aware queues and cancellation | Interactive text preserved under contention. |
| RFST-018 | P1 | Global integration status/settings panel | All service endpoints and states usable centrally. |
| RFST-019 | P1 | Network and transport hardening | Tailnet-only/no accidental public endpoints. |
| RFST-020 | P1 | Integration tests across all three computers | Full scenario matrix passes. |
| RFST-021 | P1 | Update/merge compatibility harness | Upstream merges do not silently break adapters. |
| RFST-022 | P2 | Optional hands-free VAD / barge-in | Stable end-to-end voice turn-taking. |
| RFST-023 | P2 | Optional context-sensitive character image suggestions | Opt-in, non-destructive triggers. |
| RFST-024 | P2 | Multi-character voice routing refinements | Group chat speaker handling tested. |
| RFST-025 | P2 | Packaging and one-click local diagnostics | Reproducible deployment instructions. |

### Recommended development sequence / dependencies

~~~mermaid
flowchart LR
    A[RFST-001/002 Baseline] --> B[RFST-003/004 Gufo]
    A --> C[RFST-006/007 AllTalk]
    A --> D[RFST-010/011 Second brain reader]
    B --> E[RFST-012 Global RAG]
    B --> F[RFST-008/009 STT]
    B --> G[RFST-013/014/015 ComfyUI]
    G --> H[RFST-016 Resource cleanup]
    B --> I[RFST-005 Narrative tests]
    C --> I
    E --> I
    F --> J[RFST-017/020 Integration]
    H --> J
    I --> J
    J --> K[RFST-018/021 Release and upkeep]
~~~

---

## 15. Mythic Engineering execution plan

Divide the work into six functional teams, with Yrsa coordinating interfaces and test evidence. Team names are workstreams, not claims of existing GitHub automation.

| Team | Workstream | Principal outputs |
| --- | --- | --- |
| **Architecture & Protocols** | System contracts, version pins, provider interface conventions | Architecture Decision Records (ADRs), API fixtures, dependency graph. |
| **Inference & Retrieval** | Modified Gufo support and all-collections RAG | Streaming adapter, readiness checks, read-only retrieval gateway. |
| **Voice & Interaction** | AllTalk and STT orchestration | TTS speaker/narrator pipeline, STT, interruption behavior. |
| **Media & GPU Systems** | ComfyUI workflows and resource lifecycle | Workflow registry, model routing, unload-on-idle policy. |
| **Interface & Preservation** | Minimal ST extension and character-first UX | Compact settings/health UI; canonical message preservation. |
| **Validation & Release** | Tests, benchmarks, licensing, upgrades | Three-node test matrix, regression suite, release checklist. |

### Collaboration rules

- One owner-defined vision; Yrsa coordinates engineering and integration.
- Every task begins with the actual upstream source code and documented service contract, not assumptions.
- Each workstream must produce small, reviewable changes and test fixtures.
- No broad UI rewrite without documented proof the extension/plugin path cannot meet a requirement.
- Treat upstream updates as a regular maintenance task, not a one-time fork abandonment.
- Demo a working vertical slice before proceeding to optional refinements.
- Record failures honestly and test on the real designated hardware.

---

## 16. Verification matrix and release gates

### Unit/component tests

- Gufo request normalization, optional-field compatibility, streaming chunk parsing, timeout/retry, cancellation.
- Narration/dialogue parser including asterisks, quotes, markdown, multiline roleplay, and unicode runes.
- RAG result validation, empty results, duplicate chunks, token budget, multi-collection merge.
- ComfyUI workflow routing, queueing, idle unload race conditions, and cancellation.
- Settings migration, defaults, invalid URLs, unconfigured services, and removed extensions.

### End-to-end scenarios

| Scenario | Required result |
| --- | --- |
| Fresh character, long prompt | Gufo responds with intact characterization and emotes. |
| New character without knowledge setup | It can retrieve from all second-brain collections. |
| A knowledge search matches multiple collections | Relevant excerpts are available regardless of originating collection. |
| Knowledge service unavailable | Graceful text-chat continuation. |
| Standard TTS enabled | Character reply remains visible; audio comes from G14. |
| Streaming voice and narrator | Tested in the actual selected mode or explicitly documented as a limitation with a viable alternative. |
| Push-to-talk | Speech is transcribed locally and may be edited before sending. |
| Image generation on request | Appropriate ComfyUI workflow chosen, image saved to chat/gallery. |
| ComfyUI idle | Image-model memory released without stopping the service. |
| Concurrent chat and image request | No duplicate events; conversation retains responsiveness. |
| Restart G14 mid-chat | Text service remains usable; knowledge/voice recover cleanly. |
| Restart Z13 mid-turn | UI recovers; user receives clear retry option. |
| Edit/regenerate or swipe a message | Derived media stays attached to the correct message version. |
| All optional services disabled | Original SillyTavern chat features still work. |
| Upstream merge | Lint, core tests, smoke flows, and integration contract tests pass. |

### Release gates

**Gate A: Text baseline**  
SillyTavern on Windows streams usable Gufo responses from Z13; no roleplay loss.

**Gate B: Natural voice**  
AllTalk speech on G14 works independently; STT on Z13 works with microphone input; typing remains fully functional.

**Gate C: Shared knowledge**  
One read-only all-collections retrieval service works for every character automatically. No character-specific setup.

**Gate D: Media**  
ComfyUI selects a workflow/model, produces high-quality results for the user's chosen adult-character and other visual tasks, then relinquishes unnecessary image-model memory.

**Gate E: Daily-driver reliability**  
All three nodes pass real usage, restart/reconnect tests, data recovery, and upstream compatibility checks.

**Gate F: Public fork readiness**  
License notices and modification dates are retained, private data is excluded, README points to this roadmap, and modified source is available under applicable AGPL conditions.

---

## 17. Operations: boot, recovery, and maintenance

### Suggested startup order

1. Connect the three computers to the trusted LAN/tailnet.
2. Start the G14 second brain and its read-only gateway.
3. Start G14 AllTalk V2; confirm readiness and a sample voice render.
4. Start Z13 modified Gufo; wait for /ready.
5. Start Z13 STT service; transcribe a local test sample.
6. Start Z13 ComfyUI with **no unnecessary model weights preloaded**.
7. Launch Windows SillyTavern and open the global integrations view.
8. Verify all service readiness indicators; enter ordinary text chat.

Startup order is a convenience, not a hard dependency. SillyTavern should survive any backend being unavailable at launch.

### Maintenance rhythm

- **After changing Gufo or its models:** Test /v1/models, /ready, sample completion, streaming, and unsupported-parameter behavior.
- **After changing AllTalk:** Refresh voices, validate model/voice mappings, test narration/streaming expectations.
- **After changing ComfyUI/custom nodes:** Validate all saved API-format workflow JSON; run one job per workflow family and an idle-unload check.
- **After changing second brain:** Re-run all-collections retrieval and read-only tests.
- **After updating SillyTavern:** Run canonical-emote snapshots, TTS tests, ComfyUI tests, and the global bridge integration suite.
- **Before public Git push:** Check for private data, credentials, service addresses, user media, and model files.

### Observability without intrusive complexity

Use rotating local service logs and one small diagnostics summary. Include service name, version, last readiness, most recent error class, queue depth, and measured latency. Redact user messages, transcript contents, secrets, and private database records from debug export by default.

---

## 18. Security and data handling as implementation constraints

The owner is comfortable with **all characters knowing the entirety of the second brain**. This design intentionally contains **no per-character knowledge-access filtering**. Acknowledging that preference does not require granting the software unrelated operational privileges.

- Keep second-brain knowledge **readable** through one common reader and **unwritable** through that interface.
- Store any private database credentials outside Git and grant the gateway only the minimum operations needed to query.
- Do not introduce shell execution, write-capable file tools, system administration commands, or an external coding agent into the character interface.
- Keep the services private to the intended machines; avoid public tunnels and raw internet listeners.
- Audit installed SillyTavern extensions/plugins and configured provider URLs because those integrations determine which services data reaches.
- Do not publish personal conversation histories, private embeddings, original database dumps, or character media in this public code repository.
- Maintain ordinary backups of private content and services independently from Git source history.

**Simple policy:** Full shared knowledge for characters; no write access to the second brain; no unnecessary character setup.

---

## 19. Licensing and upstream relationship

SillyTavern is AGPL-3.0 in this inspected fork. Keep the original license, attribution, and notices; clearly mark modified files and modification dates as applicable; make the corresponding source of distributed modified code available under the relevant AGPL terms. If a modified network-facing AGPL work is used by remote users, satisfy the AGPL source-offer requirements applicable to that deployment. Do not treat a public GitHub repository as a substitute for an appropriate source offer in a network interface where required.

The independent Gufo project describes its original code as MIT-licensed; its dependencies and model weights can carry different terms. AllTalk, ComfyUI/custom nodes, ASR engines, checkpoints, and LoRAs also need their own license review. Do **not** assume every installed model is free to redistribute or to use commercially merely because the integration code is open source.

The roadmap is not a legal opinion. Keep the original project's provenance visible in the fork and avoid presenting this fork as an official SillyTavern release.

---

## 20. Definition of done: the intended daily experience

When the roadmap is complete, the owner can sit down at the Windows laptop, launch the customized SillyTavern, import any richly written character, and immediately use it without tedious per-character service configuration.

That character can:

1. Converse through **modified Gufo on the Z13** with full-length character prompts and intact, visible dialogue and emotes.
2. Draw on **all relevant knowledge from the entire G14 second brain**, using the universal, read-only bridge.
3. Speak through **AllTalk V2 on the G14**, with optional narrator handling and without removing the original written message.
4. Understand speech through a **local STT service on the Z13**.
5. Request or accompany **ComfyUI artwork on the Z13**, using automatically selected, locally installed workflows for the subject and style.
6. Continue conversing when optional voice, knowledge, or image services are temporarily offline.
7. Enjoy upstream SillyTavern's existing polished frontend without constant intervention in the backend machinery.

**Final success measure:** A reliable, deeply customizable, roleplay-first local companion system whose complexity lives mostly in well-designed backend services, not in the user's daily interaction or in character setup.

---

## 21. Immediate first implementation sprint

**Sprint objective:** Demonstrate a complete but minimal chat-to-voice experience before building more abstractions.

- [ ] Baseline the repo and back up local SillyTavern data.
- [ ] Start the actual modified Gufo on Z13; probe /ready and /v1/models from Windows.
- [ ] Configure SillyTavern Chat Completion to Gufo and stream a detailed character response.
- [ ] Verify raw emotes and narrative text are unchanged.
- [ ] Start AllTalk V2 on G14 and connect via the existing SillyTavern provider.
- [ ] Generate one long character reply and hear its spoken dialogue while all written narration stays visible.
- [ ] Record concrete API gaps, failing fields, latency, and resource usage.
- [ ] **Only then** decide whether a small RuneForgeAI provider adapter or extension is required.
- [ ] Open implementation issues RFST-001 through RFST-007 with findings and acceptance criteria.

**Next sprint after acceptance:** Universal all-collections, read-only second-brain retrieval; then STT and ComfyUI workflow routing, followed by idle model unloading and cross-machine resilience testing.

---

*This document is a living implementation plan. Checkboxes are not claims of completed work. Adapt proposed interfaces to the real, versioned services before coding. The owner's decisions in Section 1 override speculative implementation conveniences.*
