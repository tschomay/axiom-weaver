# Fixture stories for the POC

Research for [issue #4 — Pick the two fixture stories](https://github.com/tschomay/axiom-weaver/issues/4),
under [issue #1 — Map: The Narrative Machine](https://github.com/tschomay/axiom-weaver/issues/1).
Vocabulary per [`CONTEXT.md`](../../CONTEXT.md).

## Recommendation

| Slot | Pick | Runner-up |
| --- | --- | --- |
| **No canonical prose** | **Cinderella**, in Andrew Lang's *Blue Fairy Book* (1889) text | **Theseus and the Minotaur**, Hawthorne's *Tanglewood Tales* (1853) "The Minotaur", with Bulfinch's *Age of Fable* (1855) as the plot skeleton |
| **Famous prose** | **A Christmas Carol** (Dickens, 1843) | **The Gift of the Magi** (O. Henry, 1905) |

Both picks are unambiguously US public domain, both have verified clean full texts, and the
pair together covers every mechanic the ticket asks for (secret / dramatic-irony gap,
plant-and-payoff, range of locations and characters).

The one real risk is scale, not rights: *A Christmas Carol* is ~28,400 words and decomposes to
roughly **26 scenes at finest grain**, above the 12–20 band. It fits the band only with
deliberate merging (see below). If that merging turns out to distort the story, the fallback
inside the same pick is to ship **Staves I–III only** (~17 scenes) rather than to switch story.

---

## Method and a sourcing caveat

This session's egress policy blocks `gutenberg.org`, `copyright.gov`, `copyright.cornell.edu`,
`en.wikipedia.org` and `standardebooks.org` (HTTPS CONNECT returns 403 at the proxy). Every
Project Gutenberg text cited below was therefore verified by reading **the same PG ebook from
its GITenberg GitHub mirror** — a repo per PG ebook, whose name encodes the PG ebook number and
which contains the PG plain text (with its PG header intact) plus the `pg<NNNN>.rdf` catalog
record. Line numbers quoted below are into the PG plain-text file as mirrored.

Where a claim rests only on a web search summary rather than a document read end to end, it is
marked *(search-verified)*.

Verified this way: PG #46, #503, #976, #2776, #3090, #3327. Repo-existence (and therefore PG
ebook number) additionally confirmed for #2148 via the GitHub repo search API.

### The copyright rule being applied

US works published in **1930 or earlier are in the public domain**: copyright on published
works runs 95 years from publication, so the 1930 cohort entered the public domain on
1 January 2026.
Sources: [Duke Center for the Study of the Public Domain](https://web.law.duke.edu/cspd/) *(search-verified)*;
[Internet Archive, Public Domain Day 2026](https://blog.archive.org/public-domain-day-2026/) *(search-verified)*;
[Harvard Open Access Tracker item, "January 1, 2026 is Public Domain Day: Works from 1930 are open to all"](https://tagteam.harvard.edu/hub_feeds/2087/feed_items/17131009/about) *(search-verified)*.
Every candidate recommended here was published **before 1900**, so it clears that line with 30+
years of margin and does not depend on renewal research.

Project Gutenberg additionally asserts the status per ebook in its own catalog metadata: each
`pg<NNNN>.rdf` read below carries `<dcterms:rights>Public domain in the USA.</dcterms:rights>`.

### The folk-tale trap

The ticket is right that this is the subtle part. The *tale* is ancient and unownable; each
**published retelling or translation is a separate work with its own copyright term**. So the
Story Package must be derived from a named pre-1931 text, not from "Cinderella" in the abstract:

- **Safe**: Lang's *Blue Fairy Book* (1889), Perrault's *Histoires ou contes du temps passé*
  (1697) and its pre-1931 English translations, Grimm (1812/1857) in the Edgar Taylor / Marian
  Edwardes English text used by PG #2591, Bulfinch (1855), Hawthorne (1853).
- **Not safe**: Jack Zipes's Grimm translations (1987 and later) *(search-verified:
  [Bantam, 1987](https://www.goodreads.com/book/show/7292417-the-complete-fairy-tales-of-the-brothers-grimm))*;
  Angela Carter's Perrault (1977); Maria Tatar's annotated editions; Marjorie Laurie's 1934
  translation of Maupassant *(search-verified: [Macmillan Learning reading PDF, "TRANSLATED BY MARJORIE LAURIE, 1934"](https://www.macmillanlearning.com/studentresources/college/english/meyerlit9e/readings/maupassant%2520necklace.pdf))*.
- **Especially not safe — and the likeliest accidental leak**: Disney's *Cinderella* (1950) is
  under copyright until 2046 under the same 95-year rule, and its *additions* are protectable
  expression: the named mice (Gus, Jaq), the named stepmother (Lady Tremaine) and cat
  (Lucifer), "Bibbidi-Bobbidi-Boo", the torn-dress scene. The authored Fabula must contain none
  of them. This is a live risk precisely because the engine performs from a Story Package: if
  the Scene Cards say "the mice help her sew a dress", the Performance layer will happily
  reach for Disney.

---

## Category 1 — no canonical prose

### Cinderella — RECOMMENDED

**Edition to use**: "Cinderella, or the Little Glass Slipper", in Andrew Lang (ed.),
*The Blue Fairy Book*, Longmans, Green & Co., 1889.

**Copyright basis**: published 1889 → pre-1931 → PD in the US. Lang lived 1844–1912
(`<pgterms:birthdate>1844`, `<pgterms:deathdate>1912` in `pg503.rdf`), so even a
life+70 analysis expired in 1982. PG's own record states "Public domain in the USA."
The tale's source is credited in the PG text itself as "(1) Charles Perrault." (line 2791),
i.e. Perrault 1697 — itself PD several times over.

**Text**: <https://www.gutenberg.org/ebooks/503> (plain text `503.txt`);
mirror read for this research: <https://github.com/GITenberg/The-Blue-Fairy-Book_503>.
Story occupies lines 2516–2790; **2,461 words**.

**Scene shape — 14 Scene Cards** (line refs into `503.txt`):

1. The remarriage; the stepmother shows her true colours; Cinderella demoted to the
   chimney-corner (2519)
2. The ball is proclaimed; the sisters choose gowns and talk of nothing else (2545)
3. Cinderella dresses their heads and is jeered — "it would make the people laugh to see a
   Cinderwench at a ball" (2567)
4. The sisters depart; Cinderella weeps (2585)
5. The godmother: pumpkin, six mice, rat, lizards, gown, **glass slippers**, and the
   **midnight condition** (2596–2650)
6. First ball — arrival, the hall falls silent, the Prince takes her to dance (2655)
7. First ball — she sits with her sisters and gives them oranges and citrons, "for they did not
   know her"; leaves at a quarter to twelve (2680)
8. Home; thanks the godmother; asks to go again (2686)
9. The sisters return and recount the ball to her; she asks the princess's name; they do not
   know it; she asks to borrow Miss Charlotte's yellow suit (2694–2715)
10. Second ball — she forgets the hour, the clock strikes twelve, she flees, **loses a slipper**
    (2720)
11. Home in her old clothes, the **fellow slipper kept in her pocket** (2730)
12. The proclamation by trumpet; the slipper tried on princesses, duchesses, then the sisters,
    in vain (2745)
13. Cinderella asks to try; the gentleman looks earnestly at her; the slipper fits; she produces
    the second slipper; the godmother restores the finery (2756–2775)
14. The sisters beg forgiveness; the marriage; the sisters married to two lords of the court
    (2780–2790)

**Mechanics coverage**:

- **World Model vs Discourse Record** — the sisters' recount (scene 9) is the cleanest available
  demonstration in short fiction. Ground truth: the princess *is* Cinderella. Reader knowledge:
  told. Sister knowledge: not told. Cinderella actively performs ignorance ("indeed, she asked
  them the name of that princess; but they told her they did not know it"). A single-store engine
  cannot represent this scene without either spoiling it or forgetting it.
- **Plant obligations** — two clean chains the backwards walk must compute: the midnight
  condition (5 → 10) and the retained second slipper (11 → 13). Both are *authored* plants whose
  setup scene must write differently because it owes a payoff.
- **Range** — 6+ locations (house, chimney-corner, garden, godmother's chamber, the court/ball,
  the road home) and 7 named/roled characters (Cinderella, stepmother, two sisters incl. named
  Miss Charlotte, father, godmother, the King's son, the gentleman-in-waiting). Not two people
  in one room.
- **Variance contract** — because there is no canonical English text and the source is 2.4k
  words, almost everything outside the required beats is free to vary. That is exactly the
  fixture that proves the engine can *perform* rather than recall.
- **State-update tiers** — mostly physical and epistemic (location, possessions, who knows
  what), which is the auto-committed tier; low volitional churn. Good first fixture.

**Weaknesses**: little interiority in the source; the moral register is thin (Perrault's
Cinderella is passive by design). Nothing that blocks a POC.

### Theseus and the Minotaur — RUNNER-UP

**Editions to use**: Nathaniel Hawthorne, "The Minotaur", in *Tanglewood Tales* (1853) — a
full-scene retelling, lines 251–1233, ~9,900 words
(<https://www.gutenberg.org/ebooks/976>; mirror <https://github.com/GITenberg/Tanglewood-Tales_976>).
For the compressed plot skeleton, Thomas Bulfinch, *The Age of Fable* (1855), Theseus chapter,
lines 6636–6740, ~1,000 words
(<https://www.gutenberg.org/ebooks/3327>; mirror <https://github.com/GITenberg/Bulfinch-s-Mythology--The-Age-of-Fable_3327>).

**Copyright basis**: Hawthorne 1804–1864, *Tanglewood Tales* 1853; Bulfinch 1796–1867,
*Age of Fable* 1855 (life dates from `pg976.rdf` and `pg3327.rdf`). Both pre-1931 → PD; both PG
records state "Public domain in the USA."

**Scene shape**: 12–16 scenes (Troezen and the stone, the road to Athens, Medea's poisoned cup,
recognition by the sword, the tribute drawn by lot, the black sails and the promise, the voyage,
the court of Minos, Ariadne and the thread, the labyrinth, the Minotaur, the escape, Naxos, the
homecoming and Aegeus's death).

**Mechanics**: the **black-sails promise is one of the cleanest plant-and-payoffs in literature**
— verified in Bulfinch at lines 6702–6726: "The ship departed under black sails, as usual, which
Theseus promised his father to change for white, in case of his returning victorious… Theseus…
forgot the signal appointed by his father, and neglected to raise the white sails, and the old
king, thinking his son had perished, put an end to his own life." Also a genuine dramatic-irony
gap running the other way from Cinderella's: the *reader* knows the sails are still black while
Aegeus watches. Wide location range (Troezen, the road, Athens, the ship, Crete, the labyrinth,
Naxos).

**Why runner-up, not pick**: the plot is less uniformly known than Cinderella's in its details;
Ariadne's abandonment at Naxos is a moral complication a POC does not need to litigate; and
Hawthorne's Victorian children's-book narrator is distinctive enough that the fixture starts to
smell of the "famous prose" slot rather than the "no canonical prose" one.

### Orpheus and Eurydice — rejected

PD via Bulfinch, *Age of Fable* (1855), lines 8041–8140, ~1,025 words (same source and rights as
above). Excellent single plant-and-payoff (the condition not to look back). Rejected on
coverage: ~8 scenes, two principals plus Hades/Persephone, and the middle is a journey rather
than a set of situations. It exercises almost nothing of the World Model.

### Little Red Riding Hood — rejected

PD via Lang, *Blue Fairy Book* (1889), which credits Perrault (line 5287); also
<https://www.colorado.edu/projects/fairy-tales/blue-fairy-book/little-red-riding-hood> *(search-verified,
citing "The Blue Fairy Book, edited by Andrew Lang, London and New York: Longmans, Green, and Co., 1889, pp. 51-53")*.
Rejected: 668 words (lines 2035–2140 of `503.txt`), ~6 scenes, 3 characters, 2 locations. It
*does* have a textbook dramatic-irony gap
(the reader knows what is in the bed), but there is not enough story around it to exercise
digests, zoom levels or plant obligations. Also, in Perrault's text the girl is eaten and the
story ends there — verified at line 2138: "this wicked wolf fell upon Little Red Riding-Hood,
and ate her all up," immediately followed by the next tale — the version "everyone knows" is the Grimm rescue ending, so the *known* plot and
the *safe* text diverge, which is exactly the trap this slot is meant to avoid.

---

## Category 2 — famous prose

### A Christmas Carol — RECOMMENDED

**Edition to use**: Charles Dickens, *A Christmas Carol, in Prose: Being a Ghost Story of
Christmas*, 1843.

**Copyright basis**: published December 1843; Dickens 1812–1870 (`pg46.rdf`). Pre-1931 → PD in
the US; PG record states "Public domain in the USA." (Illustrator John Leech, 1817–1864, is also
long PD, so the illustrated edition is clean too.)

**Text**: <https://www.gutenberg.org/ebooks/46> (plain text `46.txt`); mirror read for this
research: <https://github.com/GITenberg/A-Christmas-Carol_46>. Story body lines 64–3878,
**28,448 words**, in five staves at lines 64 / 1010 / 1810 / 2811 / 3551.

**Scene shape — ~26 at finest grain, ~20 as Scene Cards.** Finest grain:

- *Stave I* (64): counting-house and Fred; the two portly gentlemen (333); the caroler and Bob
  dismissed; the knocker becomes Marley's face (518–547); Marley's ghost (803); the phantoms in
  the air (825) — 6
- *Stave II* (1010): the bell and the first Spirit; the school, boy alone; Fan fetches him home;
  Fezziwig's ball (1431); Belle's release (1606); Belle's family years later (1759) — 6
- *Stave III* (1810): the Spirit amid the feast, and the Christmas streets; the Cratchit dinner
  and Tiny Tim (2129–2157); miners, lighthouse (2452) and ship; Fred's party and the game of Yes
  and No (2671); Ignorance and Want (2789) — 5
- *Stave IV* (2811): the businessmen on the Exchange; Old Joe's rag shop (3027); the unwatched
  corpse (3187); the relieved debtors; the Cratchits after Tim; the churchyard and the name on
  the stone (3511) — 6
- *Stave V* (3551): waking; the prize turkey and the boy (3642); the street and the portly
  gentleman; Fred's dinner; the office next morning — 5

Merging the three Stave III world-vignettes into one, the two school scenes into one, and the
two waking/turkey beats into one gives **20 Scene Cards**, at the top of the target band.
Contingency if 20 is still too many: Staves I–III alone is a coherent 17-scene arc, though it
loses the Stave IV payoff (below), which would be a real loss.

**Mechanics coverage**:

- **The regurgitation probe, at maximum strength.** Original-English, saturation-memorised:
  "MARLEY was dead: to begin with." (line 66), "Bah! Humbug!", "God bless us, every one!". If
  the Performance layer is reciting rather than performing, this fixture makes it obvious. This
  is precisely why an *English-original* work beats a translated one for this slot.
- **Told-ledger / withheld fact.** Stave IV is a sustained authored withholding: the World Model
  knows the covered body is Scrooge from the start; the Discourse Record must not say so through
  six scenes — "plundered and bereft, unwatched, unwept" (3187) — until "his own name, EBENEZER
  SCROOGE" (3511). That is an author-declared "what must stay hidden" spanning multiple Scene
  Cards, not a one-scene trick.
- **Plant obligations, verifiably.** "…better do it, and decrease the surplus population."
  (line 394) is quoted back to Scrooge by the Ghost of Christmas Present at line 2302 — a
  1,900-line plant/payoff span. Others: Marley's "I wear the chain I forged in life" (803) →
  Scrooge's own chain; the knocker (518) → the bells and the ghost; Tiny Tim's crutch → the
  empty seat in Stave IV; Fezziwig's ball → Fred's party.
- **Range**: counting-house, Scrooge's chambers, a boarding school, Fezziwig's warehouse, the
  Cratchits' four rooms, Fred's drawing-room, a mine, a lighthouse, a ship, the Exchange, Old
  Joe's shop, a churchyard, London streets. Twenty-plus named characters.
- **Zoom levels.** The five staves give a natural two-level rollup (Scene Digest → Stave Digest
  → whole) *at POC scale*, so the concentric assembler can be exercised for real rather than
  simulated. No other candidate offers this.
- **State-update tiers, as a deliberate stress case.** Scrooge's redemption is a
  *volitional/relational* change — the tier the engine may only **propose**, never commit. The
  fixture forces the author to encode the turn explicitly in Scene Card exit states, which is a
  good early test of whether that boundary is workable rather than annoying.

**Weaknesses**: the largest candidate by an order of magnitude (28.4k words vs 2–3k for the
rest), so a full read-time compile is the most expensive; and the Stave III/IV vignette chains
tempt over-fine scene splitting. Both are scale risks, not correctness risks — and the ticket's
own constraint is that the architecture must not preclude novel scale, so a fixture that pushes
the top of the band is arguably a feature.

### The Gift of the Magi — RUNNER-UP

**Edition to use**: O. Henry, "The Gift of the Magi", in *The Four Million*, McClure, Phillips &
Co., 1906. First published as "Gifts of the Magi" in the *New York Sunday World*, 10 December
1905 *(search-verified: [History.com](https://www.history.com/this-day-in-history/december-10/the-gift-of-the-magi-is-published),
[Smithsonian](https://www.smithsonianmag.com/history/history-o-henrys-gift-magi-180973840/))*.

**Copyright basis**: published 1905/1906, pre-1931 → PD; O. Henry (W. S. Porter) 1862–1910
(`pg2776.rdf`). PG record: "Public domain in the USA."

**Text**: <https://www.gutenberg.org/ebooks/2776>; mirror
<https://github.com/GITenberg/The-Four-Million_2776>. Story at lines 398–~618 of `2776.txt`,
**2,066 words**.

**Why it is the right fallback**: it fails in the *opposite* direction from *A Christmas Carol*,
so it de-risks the one thing that could sink the pick. If the parse ticket chokes on 28k words
and 26 candidate scenes, this is 2k words and 6–8 scenes that a single agent session can
certainly card up. It keeps the slot's purpose intact — original English, heavily memorised
("One dollar and eighty-seven cents. That was all.", line 400) — and it still carries a genuine
double secret: Della sells her hair to buy a fob chain, Jim sells the watch to buy the combs,
neither knowing, the reader knowing both. That is a two-sided Discourse Record gap in miniature.

**Why not the pick**: 6–8 scenes is below the band; two principals, two or three locations
(the flat, Madame Sofronie's, the shops). Thin on locations and characters, and it gives the
zoom-level assembler nothing to do.

### The Necklace — considered, third choice

Guy de Maupassant, "La Parure", *Le Gaulois*, 17 February 1884 *(search-verified:
[Encyclopedia.com](https://www.encyclopedia.com/arts/encyclopedias-almanacs-transcripts-and-maps/necklace-la-parure-guy-de-maupassant-1885))*.
Maupassant 1850–1893. Safe English text: "The Diamond Necklace" in *Original Short Stories*,
translated by Albert M. C. McMaster, A. E. Henderson, Mme. Quesada and others (the M. Walter
Dunne edition), PG #3090 — <https://www.gutenberg.org/ebooks/3090>, mirror
<https://github.com/GITenberg/Complete-Original-Short-Stories-of-Guy-De-Maupassant_3090>;
story at lines 17913–18320, **2,839 words**; PG record: "Public domain in the USA."

On mechanics it is arguably the best story in this category: the final line — "my necklace was
paste! It was worth at most only five hundred francs!" (line 18318) — is a fact that is true in
the World Model from scene one and withheld from the Discourse Record for the entire story, plus
~10 scenes across half a dozen locations (the flat, Mme Forestier's, the ministerial ball, the
streets, the jewellers, the garret) and a ten-year time jump.

**It loses the slot on purpose**: it is a *translation*, and several competing English
translations exist (Boyd; Laurie 1934). "The model has memorised these exact sentences" is
therefore much weaker, and the regurgitation probe is the entire reason this slot exists.
Ironically, a translated classic is half a category-1 fixture. Worth keeping in the back pocket
if the pair later needs a compact story with a hard secret.

### The Tell-Tale Heart — rejected

Poe 1809–1849; first published January 1843. Safe text: *The Works of Edgar Allan Poe — Volume
2*, PG #2148 (<https://www.gutenberg.org/ebooks/2148>, mirror
<https://github.com/GITenberg/The-Works-of-Edgar-Allan-Poe---Volume-2_2148>; repo existence and
ebook number confirmed via GitHub repo search — text not read end to end in this session).
Superb regurgitation probe, but ~2,200 words, one house, two characters, ~7 scenes — the "two
people in one room" case the ticket rules out. Decisive objection: its whole effect rides on an
**unreliable first-person narrator**, and issue #1 explicitly lists multi-POV and unreliable
narration as *not yet specified* fog. Choosing it as a POC fixture would force an out-of-scope
design decision.

### Hills Like White Elephants — rejected

First published in *transition*, August 1927, then in *Men Without Women* (1927); US copyright
expired 1 January 2023 with the rest of the 1927 cohort *(search-verified:
[Duke Public Domain Day 2023](https://web.law.duke.edu/cspd/publicdomainday/2023/))*. So it is
usable. Rejected anyway: two people at one table in one station bar, one continuous scene, ~2–5
beats. It is the antithesis of "range of locations and characters", and no Project Gutenberg US
edition was confirmed in this session (gutenberg.org is unreachable from here), so sourcing is
the least certain of any candidate.

---

## Per-candidate comparison

| Candidate | Slot | PD basis | Safe text (PG #) | Words | Scenes | Secret / irony gap | Plant→payoff | Locations / characters |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Cinderella** (Lang 1889) | no canonical prose | pub. 1889; Lang d. 1912 | #503 | 2,461 | **14** | **Strong** — sisters recount the ball to the princess herself | **Two** — midnight rule; retained slipper | 6 / 7 |
| Theseus & the Minotaur (Hawthorne 1853 / Bulfinch 1855) | no canonical prose | pub. 1853 / 1855; d. 1864 / 1867 | #976, #3327 | 9,908 / 1,035 | 12–16 | Moderate — reader knows the sails are black | **Strongest single** — black sails | 7 / 8 |
| Orpheus & Eurydice (Bulfinch 1855) | no canonical prose | pub. 1855; d. 1867 | #3327 | 1,025 | ~8 | Weak | Strong — the look-back condition | 3 / 4 |
| Little Red Riding Hood (Lang 1889) | no canonical prose | pub. 1889; Lang d. 1912 | #503 | 668 | ~6 | Strong but tiny | Weak | 2 / 3 |
| **A Christmas Carol** (1843) | famous prose | pub. 1843; Dickens d. 1870 | #46 | 28,448 | **~26 raw / ~20 carded** | **Strong** — Stave IV withholds the corpse's identity | **Many** — "surplus population" (394→2302), chains, crutch | 13+ / 20+ |
| The Gift of the Magi (1905) | famous prose | pub. 1905/06; O. Henry d. 1910 | #2776 | 2,066 | 6–8 | Strong — two-sided, both spouses ignorant | One (the watch / the hair) | 3 / 2 |
| The Necklace (1884; 1903-era trans.) | famous prose | pub. 1884; Maupassant d. 1893; trans. pre-1931 | #3090 | 2,839 | ~10 | **Strongest** — the paste necklace | Strong (the substitution) | 6 / 4 |
| The Tell-Tale Heart (1843) | famous prose | pub. 1843; Poe d. 1849 | #2148 | ~2,200 | ~7 | Strong but needs unreliable narration | Moderate | 1 / 2 |
| Hills Like White Elephants (1927) | famous prose | pub. 1927; PD 1 Jan 2023 | none confirmed | ~1,500 (unverified) | 1 | Subtext, not a knowledge gap | None | 1 / 2 |

## Pair-level coverage check

| Ticket requirement | Met by |
| --- | --- |
| A genuine secret / dramatic-irony gap so the World Model / Discourse Record split earns its keep | **Both.** Cinderella: characters ignorant, reader informed (the recount scene). *A Christmas Carol*: reader deliberately kept behind the World Model for six scenes in Stave IV. The two gaps run in **opposite directions**, which is the better test of a two-store design than two instances of the same shape. |
| Clear plant-and-payoff structure, to exercise the backwards plant-obligation walk | **Both.** Cinderella has two short-range chains; *A Christmas Carol* has a 1,900-line one ("surplus population") plus several mid-range ones. Short-range and long-range both covered. |
| Range of locations and characters | **Both.** 6 locations / 7 characters and 13+ locations / 20+ characters respectively. Neither is two people in one room. |
| Contrast between the two slots | Maximal: 2.4k words of anonymous 1889 fairy-tale English with no canonical text, against 28.4k words of the most-quoted Christmas prose in the language. |
| Extra, unasked-for: zoom levels and Chapter Digests | *A Christmas Carol*'s five staves give a real two-level rollup at POC scale. |

## Open items for the parse ticket

1. **Decide the merge policy for *A Christmas Carol* before carding**, not during: the three
   Stave III world-vignettes (miners / lighthouse / ship) are one Scene Card or three, and that
   single decision moves the count between 20 and 22.
2. **Author the Cinderella Fabula from the Lang text only**, and diff the resulting Scene Cards
   against the Disney element list above before shipping. Any mouse with a name is a bug.
3. **Record the regurgitation baseline** at the same time the *Carol* fixture lands: capture
   n-gram overlap between a compiled run and lines 64–3878 of `46.txt`, so "sounds like Dickens"
   becomes a number rather than an impression.
4. If Cinderella's 14 scenes prove too few to stress the digest rollup, the fix is not a
   different tale but a finer carding of scenes 5–9 (the godmother and the two balls split
   naturally into 18).

## Sources

Texts read (canonical URL, then the GITenberg mirror actually read):

- *The Blue Fairy Book*, ed. Andrew Lang, 1889 — <https://www.gutenberg.org/ebooks/503> · <https://github.com/GITenberg/The-Blue-Fairy-Book_503>
- *A Christmas Carol*, Dickens, 1843 — <https://www.gutenberg.org/ebooks/46> · <https://github.com/GITenberg/A-Christmas-Carol_46>
- *Tanglewood Tales*, Hawthorne, 1853 — <https://www.gutenberg.org/ebooks/976> · <https://github.com/GITenberg/Tanglewood-Tales_976>
- *Bulfinch's Mythology: The Age of Fable*, 1855 — <https://www.gutenberg.org/ebooks/3327> · <https://github.com/GITenberg/Bulfinch-s-Mythology--The-Age-of-Fable_3327>
- *The Four Million*, O. Henry, 1906 — <https://www.gutenberg.org/ebooks/2776> · <https://github.com/GITenberg/The-Four-Million_2776>
- *Original Short Stories*, Maupassant, trans. McMaster / Henderson / Quesada — <https://www.gutenberg.org/ebooks/3090> · <https://github.com/GITenberg/Complete-Original-Short-Stories-of-Guy-De-Maupassant_3090>
- *The Works of Edgar Allan Poe — Volume 2* (existence confirmed, not read) — <https://www.gutenberg.org/ebooks/2148> · <https://github.com/GITenberg/The-Works-of-Edgar-Allan-Poe---Volume-2_2148>
- *Grimms' Fairy Tales*, trans. Edgar Taylor & Marian Edwardes (named as the safe Grimm text; not read) — <https://www.gutenberg.org/ebooks/2591>

Copyright and publication facts *(search-verified)*:

- Duke Center for the Study of the Public Domain — <https://web.law.duke.edu/cspd/>
- Public Domain Day 2023 (the 1927 cohort, incl. *Men Without Women*) — <https://web.law.duke.edu/cspd/publicdomainday/2023/>
- Internet Archive, Public Domain Day 2026 (the 1930 cohort) — <https://blog.archive.org/public-domain-day-2026/>
- Harvard OATP item on Public Domain Day 2026 — <https://tagteam.harvard.edu/hub_feeds/2087/feed_items/17131009/about>
- *Blue Fairy Book* 1889 imprint, cited by the CU Boulder Fairy Tales project — <https://www.colorado.edu/projects/fairy-tales/blue-fairy-book/little-red-riding-hood>
- 1889 first edition, Internet Archive scan — <https://archive.org/details/bluefairybook00langiala>
- "The Gift of the Magi", 10 December 1905 — <https://www.history.com/this-day-in-history/december-10/the-gift-of-the-magi-is-published> and <https://www.smithsonianmag.com/history/history-o-henrys-gift-magi-180973840/>
- "La Parure", *Le Gaulois*, 17 February 1884 — <https://www.encyclopedia.com/arts/encyclopedias-almanacs-transcripts-and-maps/necklace-la-parure-guy-de-maupassant-1885>
- Zipes Grimm translation, 1987 (an example of a translation to avoid) — <https://www.goodreads.com/book/show/7292417-the-complete-fairy-tales-of-the-brothers-grimm>
- Laurie translation of "The Necklace", 1934 (likewise) — <https://www.macmillanlearning.com/studentresources/college/english/meyerlit9e/readings/maupassant%2520necklace.pdf>

*Nothing here is legal advice; the picks are chosen so that no edge case has to be argued —
every recommended text predates 1900.*
