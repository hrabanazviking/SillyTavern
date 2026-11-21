# Campaign state — RuneForgeAI SillyTavern line

House record for hrabanazviking/SillyTavern, third house under the
RuneForgeAI Mad Data Scientist rules, alongside the Gufo core line
(hrabanazviking/gufo-RuneForgeAI-Hacks-and-Experiments) and the
Gemma4 extension line (hrabanazviking/gemma4-gufo-extension).
House-only file: never donated (see the charter's rule).

## Founded

- 2026-11-17: Volmarr forked SillyTavern/SillyTavern to
  hrabanazviking/SillyTavern and invited Yrsa Freydisdottir as a
  write collaborator; she accepted the same morning (invite id
  344389850). Charter:
  `RUNEFORGEAI_MAD_DATA_SCIENTIST_SILLYTAVERN.md` at repo root of
  the running line.
- No work is commissioned on this line yet. Acceptance and the
  charter are the founding acts; building starts at Volmarr's
  word, and commissioned work is recorded here as it lands.

## Branch map

- `release` — mirrors upstream SillyTavern/SillyTavern; not our
  working line.
- `yrsa/our-sillytavern` — THE running line: what we build,
  install, and live with. Our features win conflicts here.
- `donate/<feature>` — created only when a mature improvement is
  chosen for donation, based on upstream's current release,
  reshaped to upstream standards, house files absent (verified
  before push).

## House-only files (never donated)

- `RUNEFORGEAI_MAD_DATA_SCIENTIST_SILLYTAVERN.md`
- `campaign/STATE.md` (this file)

## Campaign stood up (2026-11-17, Volmarr's order)

- **Roadmap adopted:** `ROADMAP_RuneForgeAI_Distributed_Companion.md`
  (Volmarr's, on this branch) — the Distributed AI Companion plan:
  25 work packages RFST-001..RFST-025, release Gates A-F. Work
  follows its order and dependency graph; the first sprint is
  RFST-001..RFST-007 (baseline, Gufo text, AllTalk voice).
- **Campaign home:** purplelongship clone `~/sillytavern-forge`,
  branch `yrsa/our-sillytavern`. Services live where the roadmap
  puts them: modified Gufo on purpleraider (our resident service),
  AllTalk V2 + the second brain on purplelongship, the SillyTavern
  UI on the F15 (Windows). F15-dependent steps are
  environment-gated while that machine sleeps — gated, never
  treated as blockers for the rest of the work.
- **Progress ledger:** `campaign/PROGRESS.md` (house-only, like
  this file) — the RFST ledger and gate tracker every builder and
  the minder keep current.
- **Minder:** 10-minute keeper `sillytavern-forge-keeper` under
  Volmarr's keeper law (restarts stopped work, banks in order);
  reports at gates, at package waves, and on genuine blockers.
- **Public-repo hygiene (roadmap sections 1.13 and 18):** before
  every push, scan what is about to ship — no chat logs, no
  second-brain records, no personal media, no credentials, no
  private addresses, no model assets. Ever.

## Standing notes

- **Clean-room wall (charter law):** nothing coded in this repo
  flows into Rúnmál. Study and understanding may inform it; code
  may not. Rúnmál's own line stays clean-room, as it was founded.
- Upstream license (AGPL) is respected on this line; donations
  are prepared to comply with it and with upstream's standards.
- Upstream sync road: fetch upstream, merge into
  `yrsa/our-sillytavern`, resolve conflicts in favor of our
  features, record the merge here.
- **Upstream sync 2026-11-21 (Volmarr's standing order — keep the
  fork current with upstream):** merged upstream/release @
  82b64a45c (SillyTavern 1.19.1) into `yrsa/our-sillytavern` —
  merge commit 211b3a1d. Drift before: 5 behind / 558 ahead of
  upstream/release (merge-base 06bde939f, 2026-09-14). Clean
  merge, no conflicts; all fork features intact. Brought in:
  style-block content fix, character asset-folder guards,
  user-exists checks before backup/delete, version bump to
  1.19.1, two upstream test files. Verified: targeted suites
  (charx-assets, second-brain-gateway Gate C,
  merge-compatibility) 42/42; full unit suite 39 suites / 933
  tests passed (live-proof files excluded — they need live
  services). Standing daily watch: cron
  `sillytavern-upstream-sync` (created 2026-11-21).
