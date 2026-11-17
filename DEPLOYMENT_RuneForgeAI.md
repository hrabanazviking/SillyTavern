# RuneForgeAI Distributed Companion — Deployment Instructions

Reproducible deployment instructions for Volmarr's SillyTavern
fork (RFST-025). Following this document from a clean machine
reproduces the distributed companion deployment: the
SillyTavern UI on one host, text/media inference on a second,
and speech/knowledge services on a third. Hosts are named by
ROLE only throughout: **ui-host** (runs the SillyTavern UI),
**inference-host** (Gufo text inference, STT, ComfyUI media),
and **services-host** (AllTalk speech, second-brain gateway).
All example endpoints below are loopback addresses with
placeholder ports; substitute your own private addresses when
configuring, and never commit real addresses or credentials
to this public repository.

Companion documents: the roadmap
(`ROADMAP_RuneForgeAI_Distributed_Companion.md`, especially
section 17 for startup order and section 16 for release
gates) and the campaign charter
(`RUNEFORGEAI_MAD_DATA_SCIENTIST_SILLYTAVERN.md`).

## 1. Prerequisites

- Node.js 18 or newer on the ui-host (Node.js 22 LTS
  recommended), with npm.
- Git on the ui-host.
- The companion services installed on their hosts per their
  own projects: Gufo and ComfyUI on the inference-host,
  AllTalk and the second-brain gateway on the services-host.
  Every service is OPTIONAL: SillyTavern chat works with any
  or all of them stopped or unconfigured.
- All three hosts on one trusted private network (a LAN or a
  private mesh/tailnet). No service endpoint in this
  deployment is exposed to the public internet (RFST-019).

## 2. Clone the fork branch

On the ui-host:

```sh
git clone --branch yrsa/our-sillytavern https://github.com/hrabanazviking/SillyTavern.git
cd SillyTavern
```

Never deploy from the upstream SillyTavern repository for
this companion: the RuneForgeAI integrations live only on
this fork's `yrsa/our-sillytavern` branch.

## 3. Install

On the ui-host, from the clone root:

```sh
npm install
```

in the repo root, and again in `tests/` if you intend to run
the unit suites:

```sh
cd tests && npm install && cd ..
```

No container runtime is required or used anywhere in this
deployment; every component installs and runs natively.

## 4. Configure service endpoints

Open the global integration settings in the SillyTavern UI
(RFST-018) and set ONE machine-wide endpoint per service.
There are no per-character endpoint settings. Example values
(loopback, placeholder ports — replace the host part with
your inference-host / services-host private addresses):

| Service | Host role | Example endpoint |
| --- | --- | --- |
| Gufo | inference-host | `http://127.0.0.1:9101` |
| STT | inference-host | `http://127.0.0.1:9103` |
| ComfyUI | inference-host | `http://127.0.0.1:9104` |
| AllTalk | services-host | `http://127.0.0.1:9102` |
| Second Brain | services-host | `http://127.0.0.1:9105` |

Rules (enforced by the settings panel core):

- Endpoints are `http`/`https` URLs with NO embedded
  credentials — a URL containing `user:password@` is
  rejected. Keep credentials in each service's own local
  configuration, never in an endpoint URL.
- An empty endpoint means "unconfigured": that feature is
  off, and chat is unaffected.
- Knowledge (second brain) is ONE global toggle with a
  relevance threshold and a token budget; there are no
  per-character collection settings (RFST-012).

## 5. Startup order

Startup order (roadmap section 17) is a convenience, not a
hard dependency — SillyTavern survives any backend being
unavailable at launch and recovers when it appears:

1. Connect all three hosts to the trusted private network.
2. On the services-host: start the second brain and its
   read-only gateway.
3. On the services-host: start AllTalk; confirm readiness
   and a sample voice render.
4. On the inference-host: start Gufo; wait for its ready
   state.
5. On the inference-host: start the STT service; transcribe
   a local test sample.
6. On the inference-host: start ComfyUI with no unnecessary
   model weights preloaded (it unloads on idle, RFST-016).
7. On the ui-host: launch SillyTavern (`npm start` from the
   clone root, or the platform start script) and open the
   global integrations view.
8. Verify every service readiness indicator in the panel,
   then enter ordinary text chat.

## 6. Run the one-click diagnostics

After startup, run the one-click local diagnostics
(RFST-025, core: `src/integration/diagnostics-core.js`). It
runs a named set of local checks — runtime/Node.js version,
required configuration presence, free disk space, and the
reachability of every configured service endpoint — and
produces a single copyable plain-text report:

- Every check is reported as PASS, WARN, or FAIL with its
  reason. An unreachable OPTIONAL service is a warning in
  the report, never hidden; an unreachable required service
  or a missing required config value is a failure.
- The summary counts pass/warn/fail honestly, and the
  overall result is FAIL if any check failed, else WARN if
  any check warned, else PASS.
- Secrets never appear in the report: URL credentials are
  stripped and secret-looking values are redacted
  (RFST-018 redaction rules), so the report is safe to paste
  into an issue or a chat.
- The diagnostics runner never throws: a failed probe or a
  broken collaborator is recorded as a failed/warned check,
  and the rest of the report still completes.

Verify the diagnostics core itself against its mock suite
(no live service is contacted):

```sh
cd tests
node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.config.json diagnostics.test.js
```

## 7. Updating

Pull the fork branch and re-run the diagnostics:

```sh
git pull --ff-only origin yrsa/our-sillytavern
npm install
```

After updating, also re-run the update/merge compatibility
harness suite (RFST-021) before an upstream merge, and the
full unit suite from `tests/`:

```sh
cd tests
node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.config.json
```

## 8. Hygiene before any push

This is a PUBLIC repository. Before pushing anything, check
the diff for private data, credentials, real service
addresses, user media, chat logs, and model files (roadmap
section 17). If any are present, stop and remove them before
the push — never after.
