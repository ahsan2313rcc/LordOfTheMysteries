# Lord of the Mysteries: Ascension

A browser card-game prototype inspired by *Lord of the Mysteries*: choose a Pathway, manage HP / Sanity / Spirituality, drink potions to climb Sequences, and win by **Last Man Standing**, **Apotheosis** (Sequence 0), or by driving an opponent to **0 Sanity**.

## Play on Render

The live service must run a production build. `next dev` opens a hot-reload socket at `/_next/hmr`; Render answers that socket with 502, the page never hydrates, and Begin stays on the title.

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
- Deck of 78 unique cards, one copy each (56 common, 22 rare). Drawing the last card reshuffles the discard. Major Arcana is not a card.
- Ascension with **sticky Acting Conditions**. Casting the Sequence ability locks the condition for that step. Potions cost no Sanity, and you may cast and drink on the same turn.
- Pathway abilities cost Sanity (1 / 2 / 3 across Sequences 9–7, 6–4, 3–1). Spirituality pays for cards: commons 1, rares 4, artifacts 6. A bare attack deals no damage; a weapon or an empowering ability does. The attack action stays free.
- Passive recovery: +1 HP if no HP taken, +1 Sanity if no Sanity taken, SP every turn from Pathway/Seq
- Artifact powers + Contention (steal)
- 0 Sanity removes you as a contender. The body deals 1 HP to everyone, including itself, until that HP is gone.
- A Sequence lead does not win. It pays more Spirituality each Begin, unlocks a stronger ability, and from Sequence 6 the body knits 1 HP each Begin. Drinking draws a card. Some pathways hit harder in the early Sequences and taper; others start quiet and draw and press Sanity once they are deep.
- Each pathway has its own potion recipes. Consecutive sequences never share an ingredient, and a card shown for one potion cannot pay the next. Common pairs are printed evenly, two cards each.
- Bribe steals a common equipped piece. Error's Theft steals the best equipped piece, rares first.
- Block / Evade, lasting Block, traps as interrupts, AI opponents (1–3)
- In-app **Design Notes** with balance verdict and improvement suggestions

```bash
npm run test:acting     # sticky Acting Condition regression tests
npm run test:passives   # SP / HP / Sanity passives + early Acting
npm run sim:four        # 24× auto 4-player games → length & economy metrics
npm run test:cards      # card text matches engine behavior
```

The in-game **AI Simulator** (title screen) runs 2- or 4-player AI tables, from 8 games up to 1024, then shows pathway win rates, which cards get played, and a step-through chronicle. **Rules** on the title screen is the current ruleset.

Potions do not discard their ingredients. You reveal those cards to the table and keep them.

**Arcana Concealment** is off unless you check it. The 22 rares are Major Arcana 0–21 and the 56 commons are the Minor Arcana. Playing a rare card exposes an opponent. You stay concealed until you attack an exposed player.

### Balance snapshot (4-player AI sims)

Games end by last standing HP, by Madness at 0 Sanity, or by Apotheosis at Sequence 0. A bare swing deals nothing, so weapons and abilities set the clock. Casting the Sequence ability locks Acting, so the climb is gated by the potion recipe. The AI simulator records how the turns were spent.

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · shadcn/ui

## Notes

This is a rules-faithful **prototype**, not a complete digital TCG. Higher-sequence abilities are partially generalized; multiplayer is local vs AI (not networked).
