# Lord of the Mysteries: Ascension

A browser card-game prototype inspired by *Lord of the Mysteries*: choose a Pathway, manage HP / Sanity / Spirituality, drink potions to climb Sequences, and win by **Last Man Standing** or **Apotheosis** (Sequence 0).

## Play on Render

The live service must run a production build. `next dev` opens a hot-reload socket at `/_next/hmr`; Render answers that socket with 502, the page never hydrates, and Begin Ritual stays on the title.

Build command: `npm install --include=dev && npm run build`  
Start command: `npm start`

`npm run dev` does the same when Render sets `RENDER=true`, so a service still pointed at the dev script serves the built app.

## Play locally

```bash
npm install
npm run dev -- -p 43123
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123).

## What’s in this build

- **All 22 Arcana Pathways** (Fool through Justiciar), each with Sequences 9→0
- Reveal modal for hand peeks, deck peeks, Trap reveals, and card steals
- Full turn loop: Begin → Draw → Action (Standard / Sequence / Attack) → End
- Card pool: Weapons, Spells, Utilities, Charms, Traps, Artifacts (revised 16C/4R spell & utility split)
- Ascension with **sticky Acting Conditions** (progress banks until you drink). Potions cost no Sanity, and you may cast and drink on the same turn.
- Pathway abilities cost Sanity (1 / 2 / 3 across Sequences 9–7, 6–4, 3–1). Spirituality pays for cards: commons 1, rares 4, artifacts 6. The basic attack is free.
- Passive recovery: +1 HP if no HP taken, +1 Sanity if no Sanity taken, SP every turn from Pathway/Seq
- Artifact powers + Contention (steal)
- Madness, Block / Evade, lasting Block, traps as interrupts, AI opponents (1–3)
- In-app **Design Notes** with balance verdict and improvement suggestions

```bash
npm run test:acting     # sticky Acting Condition regression tests
npm run test:passives   # SP / HP / Sanity passives + early Acting
npm run sim:four        # 24× auto 4-player games → length & economy metrics
npm run test:cards      # card text matches engine behavior
```

The in-game **AI Simulator** (title screen) runs 2- or 4-player AI tables, from 8 games up to 1024, then shows pathway win rates, which cards get played, and a step-through chronicle. **Rules** on the title screen is the current ruleset.

**Arcana Concealment** is an optional variant (on by default). The deck gains one Major Arcana per player. Playing it exposes a chosen player and their board. You stay concealed until you attack an exposed player. Abilities, items, and potion recipes are unchanged.

### Balance snapshot (4-player AI sims)

Typical finished game: **~100–110 turns** (~25–28 full rounds), always ends by **Last Standing**. Critical economy bottleneck is **potion recipe assembly** (Acting locks easily; ingredients do not). Sanity tolls rarely block. Apotheosis (Seq 0) is rare in free-for-alls — combat resolves first.

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · shadcn/ui

## Notes

This is a rules-faithful **prototype**, not a complete digital TCG. Higher-sequence abilities are partially generalized; multiplayer is local vs AI (not networked).
