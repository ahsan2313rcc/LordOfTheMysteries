"use client";

export function RulesView({ onBack }: { onBack: () => void }) {
  return (
    <main className="relative min-h-screen px-4 py-10">
      <div className="fog-layer opacity-50" aria-hidden />
      <article className="relative z-10 mx-auto max-w-3xl space-y-8 text-stone-300">
        <button type="button" className="text-sm text-stone-400 hover:text-amber-300" onClick={onBack}>
          ← Back
        </button>
        <header>
          <h1 className="font-[family-name:var(--font-display)] text-4xl text-amber-100">Rules</h1>
          <p className="mt-2 text-sm leading-relaxed text-stone-400">
            A free-for-all of potions, Spirituality, and Sanity. Two players or four. Last mind
            standing wins, unless someone drinks their way to Sequence 0.
          </p>
        </header>

        <section className="space-y-2">
          <h2 className="font-[family-name:var(--font-display)] text-xl text-amber-200">How you win</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
            <li>
              <strong className="text-stone-100">Last Standing.</strong> Reduce every other player to 0 HP.
            </li>
            <li>
              <strong className="text-stone-100">Apotheosis.</strong> Drink the Sequence 0 potion. That player wins immediately.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-[family-name:var(--font-display)] text-xl text-amber-200">The board</h2>
          <p className="text-sm leading-relaxed">
            Each Beyonder starts at Sequence 9 with 20 HP, 20 Sanity, 0 Spirituality, and 3 cards.
            HP and Sanity both cap at 20. Spirituality caps at 20 and stays in your pool between turns.
            The deck is 78 cards, one of each: 56 common cards and 22 rare cards, two of them relics.
            Nothing is duplicated. When the last card is drawn, the discard is shuffled into a new deck.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-[family-name:var(--font-display)] text-xl text-amber-200">A turn</h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed">
            <li>
              <strong className="text-stone-100">Begin.</strong> Gain Spirituality from your Sequence
              (1 at Sequence 9–8, then 2, 2, 3, 3, 4, 4, 5, 5 as you climb). If you took no HP since
              your last Begin, heal 1. If you took no Sanity from an opponent, restore 1 Sanity.
            </li>
            <li>
              <strong className="text-stone-100">Draw</strong> 1 card.
            </li>
            <li>
              <strong className="text-stone-100">Act,</strong> then end the turn. You may take each
              of these once, in any order:
            </li>
          </ol>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
            <li>
              <strong className="text-stone-100">Standard — play a card.</strong> Commons cost 1
              Spirituality. Rares cost 4. Artifacts cost 6. Traps are free and use the Attack
              action instead. Higher Sequences generate more than 1, so Spirituality banks toward
              rares and artifacts if you keep playing commons.
            </li>
            <li>
              <strong className="text-stone-100">Sequence — cast your pathway ability.</strong> Pay
              Sanity, not Spirituality: 1 at Sequence 9–7, 2 at Sequence 6–4, 3 at Sequence 3–1.
              One cast at each of those nine steps costs 18 Sanity. From a full bar of 20, that
              leaves 2 if nothing refills you.
            </li>
            <li>
              <strong className="text-stone-100">Attack.</strong> Deal 1 HP with your bare hands, or
              your weapon’s damage. Attacking does not cost Spirituality. A few weapons add a swing
              cost of their own.
            </li>
            <li>
              <strong className="text-stone-100">Drink a potion</strong> when your Acting Condition
              is locked and the recipe is in hand. Potions cost no Sanity. Show those cards to
              every player; they stay in your hand, marked as revealed, and can be played or shown
              again. The next sequence asks for different ingredients, and a card you just showed
              cannot pay that next potion. Drinking
              does not spend the Sequence action, so you may cast and drink on the same turn. Acting
              progress sticks until you drink, then resets for the new Sequence.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-[family-name:var(--font-display)] text-xl text-amber-200">Sanity and Madness</h2>
          <p className="text-sm leading-relaxed">
            Paying for your ability lowers Sanity, and it does not count as being hit, so the Begin
            recovery can refill you when opponents leave your mind alone. At 0 Sanity you lose.
            You are no longer a contender: no draw, no cards, no potion. On each of your Begin
            phases the body deals 1 unblockable HP to every living player, including itself, until
            that HP reaches 0. A survivor still has to put the body down or keep taking the hit.
            Cogitation Technique stops the first break and leaves you at 1 Sanity.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-[family-name:var(--font-display)] text-xl text-amber-200">Sequence</h2>
          <p className="text-sm leading-relaxed">
            Being deeper than your opponent does not win the match. Each step down grants more
            Spirituality at the start of your turn — 1 at Sequence 9–8, then 2, 3, 4, and 5 as you
            descend — and replaces your ability with a stronger one. Sequence 0 is still Apotheosis.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-[family-name:var(--font-display)] text-xl text-amber-200">Why a duel is longer than 20 turns</h2>
          <p className="text-sm leading-relaxed">
            Each player attacks on their own turn. In a 2-player game you are struck once per round,
            and a round is two turns. An unarmed hit is 1 HP, so 20 HP is 20 rounds — about 40 turns
            — when every swing connects and nobody heals. A fully blocked hit deals 0, and a quiet
            cycle heals 1 HP, so the wound closes. Weapons, spells, and pathway abilities are what
            push a game under that line. Charging Spirituality for the basic attack would stretch it
            further, so the basic attack stays free.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-[family-name:var(--font-display)] text-xl text-amber-200">
            Variant — Arcana Concealment
          </h2>
          <p className="text-sm leading-relaxed">
            Off unless you check it when you deal. The deck gains one Major Arcana per player. Everyone starts
            concealed. Play an Arcana, choose a player, and their board opens: hand, trap, and
            equipment. They can be attacked. You stay concealed. You become exposed only when you
            attack an exposed player. A concealed player cannot be the target of an Attack. Spells,
            abilities, and items still do exactly what they say, and potions still need their recipes.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-[family-name:var(--font-display)] text-xl text-amber-200">Cards</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
            <li>Weapons, charms, and artifacts stay equipped. A new one of the same kind replaces the old.</li>
            <li>Traps sit face down and interrupt the printed moment: an attack, a spell, an equip, a potion.</li>
            <li>Hand limit is 7. Extra cards discard at the end of your turn. Slumber Charm raises the limit by 2.</li>
            <li>
              A common card carries two common ingredients. A rare card carries three, except the
              two relics, which carry two copies of one rare ingredient. Two sequences in a row never
              ask for the same ingredient. Potion Ingredients fills one common slot.
            </li>
            <li>
              Bribe steals a common equipped Weapon or Charm. Error&apos;s Theft steals the best
              equipped piece, rares before commons, into your hand.
            </li>
          </ul>
        </section>
      </article>
    </main>
  );
}
