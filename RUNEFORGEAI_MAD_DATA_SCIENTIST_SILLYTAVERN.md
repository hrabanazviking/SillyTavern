# RuneForgeAI Mad Data Scientist Personal SillyTavern Hacks

This is **Volmarr's personal RuneForgeAI hack line of SillyTavern**.
It is not official SillyTavern, it is not a community edition, and
it is not built to please anyone upstream. It is built the way a
mad data scientist builds the machine on his own desk: to his own
standards, for his own needs, on his own hardware — and it answers
to RuneForgeAI alone.

Official SillyTavern lives at SillyTavern/SillyTavern. This fork,
hrabanazviking/SillyTavern, is where SillyTavern gets taken apart,
improved, and rebuilt into the chat front-end we actually want to
live with. What survives real use here may, one day and only when
it is mature, be offered back upstream as a gift. Until then, this
line is sovereign.

## No support. No warranty. Read this first.

Plain words, so nobody can miss them:

- **RuneForgeAI offers NO support, NO help, and NO warranty of any
  kind for this personal version of SillyTavern.** Not a little
  support. Not "best effort." None. There is no help desk, no issue
  queue with our name on it, no promise that anything here works on
  your machine.
- **You are better off using the official upstream SillyTavern.**
  Seriously. It lives at SillyTavern/SillyTavern, it is the real
  project, and it is the version a sensible person runs. This fork
  is one man's personal workbench, kept in the open because open
  is how we work — not because it is a product offered to the
  world.
- **It is open source, so you may use the code as open source
  allows** — entirely at your own risk. If it sings on your
  hardware, good. If it breaks, the pieces are yours to keep.
- **By using it, you automatically agree** that you alone are
  responsible for the outcome, and that you have — or provide —
  your own tech support. Running this hack means signing that
  agreement with your actions; there is no other signature and no
  exception.
- **Do not expect the official SillyTavern project to support you
  either.** If you run this personal hack line and something goes
  wrong, it is unlikely the official SillyTavern project will
  support you — and it would be unfair to ask them to clean up
  after a version they did not make. Take your questions about
  official SillyTavern to official SillyTavern, running official
  code.

Friendly, and firm: this is a personal mad data scientist's bench.
Visitors may look, and may take the code as the license allows —
but they bring their own tools, their own skills, and their own
risk.

## Our standards

- **Needs first.** Every change exists because our work needs it.
  If a feature does not serve the machines and the projects in
  this house, it does not get built, however fashionable it is
  elsewhere.
- **Our line, our rules.** The running line is never shaped to
  please upstream reviewers. It is the proving ground:
  improvements earn their place by working, under real load, on
  real hardware.
- **Plain and honest.** Behavior is documented as it truly is.
  Gaps are recorded as gaps, never dressed up as features.
- **Forgiving machinery.** Software here must not crash on bad
  input, must not silently lose a user's words, and must yield to
  the human using the machine. The machine serves the man, never
  the reverse.
- **No silent cuts.** Nothing in this line quietly throws away
  context, memory, or data. When something must be trimmed, it is
  logged, with counts, where the owner can see it.
- **The clean-room wall.** This fork is upstream SillyTavern code
  under its own license, and that license is respected here. Code
  from this line NEVER flows into Rúnmál, Volmarr's sovereign
  clean-room chat app: Rúnmál is built from study and
  understanding, in our own words and our own code. Ideas and
  lessons may travel; code may not.

## What this line is for

1. **A personal SillyTavern, lived with daily.** Changes land
   because Volmarr wants them in the chat front-end he actually
   uses — his personas, his lorebooks, his machines, his rules.
2. **A proving ground.** Ideas are tried here under real use.
   What proves itself is recorded honestly in the campaign state,
   whether it thrives or dies.
3. **Room to grow.** The list of what we are adding is written as
   the work is commissioned, in `campaign/STATE.md` — never
   padded in advance with promises nobody has made yet.

## Two-track governance

- **Track one — our line (sovereign).** The branch
  `yrsa/our-sillytavern` is the running line: the SillyTavern we
  build, install, and live with. It is also the proving ground
  where improvements mature under real use.
- **Upstream tracking.** The fork's `release` branch mirrors
  upstream SillyTavern/SillyTavern. Over time: fetch upstream,
  merge it into our line, and on our line **our features win
  conflicts**. Upstream goodness flows in; our sovereignty does
  not flow out.
- **Track two — donations (separate, later, no hurry).** When a
  mature improvement is chosen for donation, it gets its **own**
  clean branch named `donate/<feature>`, based on upstream's
  **current** release, with the improvement cherry-picked and
  reshaped to comply fully with upstream's standards, protocols,
  and style — none of our house-specific extras. Donations are
  gifts, prepared carefully, one at a time, when they are ready
  and not before.

## The rule about this file

**This charter is a house document. It is never donated.** It must
never appear on any `donate/*` branch, in any upstream pull
request, or in any patch offered to official SillyTavern. The same
holds for every house-only file on our line (the campaign state
document, and anything else that exists only because this is
RuneForgeAI's personal line).

Therefore the donation procedure includes a hard step, every
time: **before any `donate/*` branch is pushed or any upstream PR
is opened, verify that this charter and all house-only files are
absent from it.** A donation that carries house files is not a
donation; it is a leak, and it does not ship.

---

*RuneForgeAI Mad Data Scientist Personal SillyTavern Hacks —
built by Volmarr's forge, for Volmarr's machines, to Volmarr's
standards.*
