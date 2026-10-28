# Lord of the Mysteries: Ascension

A browser card-game prototype inspired by *Lord of the Mysteries*: choose a Pathway, manage HP / Sanity / Spirituality, drink potions to climb Sequences, and win by **Last Man Standing** or **Apotheosis** (Sequence 0).

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
- Ascension with **sticky Acting Conditions** (early Seq completable via Pathway ability; progress banks until you drink)
- Passive recovery: +1 HP if no HP taken, +1 Sanity if no Sanity taken, SP every turn from Pathway/Seq
- Artifact powers + Contention (steal)
- Madness, Block / Evade, lasting Block, traps as interrupts, AI opponents (1–3)
- In-app **Design Notes** with balance verdict and improvement suggestions

```bash
npm run test:acting   # sticky Acting Condition regression tests
```

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · shadcn/ui

## Notes

This is a rules-faithful **prototype**, not a complete digital TCG. Higher-sequence abilities are partially generalized; multiplayer is local vs AI (not networked).
