# LLM arc generation: prior art and known failure modes

Research for [issue #116](https://github.com/tschomay/axiom-weaver/issues/116) (part of
[#113](https://github.com/tschomay/axiom-weaver/issues/113)). Answered **2026-09-15**.

Vocabulary is [`CONTEXT.md`](../../CONTEXT.md)'s: Fabula / Syuzhet / Performance, World Model,
Scene Card, `required_beats`, plant/payoff, `pays_off`. This is entirely **Fabula/Syuzhet**-layer
work — nothing below is about Performance, and no row of the seam-failure rubric applies (#113,
and [`docs/agents/story-authoring-eval.md`](../agents/story-authoring-eval.md) §0).

The required recommendation is **§6**.

---

## Note on sources (read this before trusting a citation)

**Verification pass: 2026-09-15** ([#126](https://github.com/tschomay/axiom-weaver/issues/126)).
The doc was originally written in a session whose egress policy blocked essentially every paper
host, so most claims carried a *(search-verified)* tag meaning "a search index read this paper,
I did not." Those hosts are now reachable, and the citations have been re-opened and checked
against the papers themselves, in the priority order #126 sets out.

**What the pass changed.** Every paper cited here was found to exist, with the title, venue,
authors and date as given. **Two claims were wrong and are corrected in place:** the
"near-random" characterisation of frontier-model plot-hole detection (§3, §6), and a sentence
quoted from arXiv:2410.23884 that appears in no version of that paper (§3). Several claims gained
the numbers the original pass could not get — CFPG's results tables, PLOTTER's margins, Tian et
al.'s "over 40%", Dramatron's participant quotes. Nothing was found to be fabricated beyond the
one misattributed quotation. **One citation could not be opened and stays tagged:** Doshi &
Hauser, because `www.science.org` is still blocked. §6's recommendation survives, on partly
rebuilt support — see the status box at the top of §6. §7 has been revised: the caveats that were
artefacts of the blocked proxy are struck, and two new ones are added.

How to read a citation below, after that pass:

1. **Untagged, or explicitly "read directly"** — I opened the source and checked the claim
   against it. After this pass that is essentially the whole doc: CFPG, *Finding Flawed Fictions*,
   Huang et al., the causal-reasoning failure-modes paper, Tian et al., Hamilton & Mimno, PLOTTER,
   the outline-stage benchmark, TTCW, HANNA, MoPS, Re3, DOC, CONCOCT, Dramatron, Agents' Room,
   WriteHERE, Deng et al., Sui, Padmakumar & He and the narrative-theory survey — alongside the
   code repos and the Microsoft Research record that were readable from the start. Where a paper
   has a *verbatim* sentence worth holding the doc to, it is now quoted as such.
2. **Marked *(search-verified)*** — still unopened; the claim is a search index's reading of the
   source, not mine. **The pass got further than planned and exactly one citation is left under
   this tag: Doshi & Hauser (Science Advances).** `www.science.org` was the only paper host still
   blocked on 2026-09-15. Two originals cited *through* the narrative-theory survey (Story Plan
   Graph, Ghaffari & Hokamp) also remain unopened and are named as pointers, not evidence.
3. **Marked *(corrected 2026-09-15)*** — the original text was wrong and has been fixed in place.
   The correction is left visible deliberately; see §7.
4. **Marked *(unverified)* or *(could not confirm)*** — I looked and could not substantiate it.

Two rules from the original pass still hold: no paper title, author list, venue or number appears
here unless a canonical source returned it — nothing is reconstructed from memory; and **model
vintage is flagged inline**, because a 2022–2024 result about GPT-3, InstructGPT, OPT-175B or
GPT-4 is evidence about those models.

Anything still marked *(search-verified)* should be re-opened before it is baked into a spec or
an ADR.

---

## Headline: six findings that touch a decision already on the map

| # | Finding | Effect here |
| --- | --- | --- |
| 1 | The collapse toward generic shapes is **lexical and structural at once**, and traceable to post-training rather than pretraining: 11 words appear in 88.3% of 20,000 sampled stories across four current models (read directly). | Arc diversity is not a temperature knob. It needs structured sampling of the *seed* (§2), and it needs a cheap lexical canary in the eval loop (§8). |
| 2 | LLM arcs are measurably **flatter and earlier-peaking** than human ones: homogeneously positive, the *late* turning points (major setback and climax) occurring early, less suspense — and making the generator reason about arc explicitly buys "over 40% improvement… in diversity, suspense, and arousal" (read directly). | "Uniform beat shape" — consciously accepted as unaddressed at the Performance layer (`CONTEXT.md`) — arrives at the Fabula layer as a *measurable* defect, so it need not be accepted here. |
| 3 | LLMs reason about narrative causality by **positional shortcut** (earlier = cause), and that breaks when events are not narrated in causal order — but **explicitly extracting the causal graph and reasoning over the graph avoids the shortcut and holds accuracy "across narrative sizes"**, while naive chain-of-thought does not (read directly; wording corrected — see §3). | This is the single strongest argument for making `pays_off` an explicit object the model emits, rather than a relation left implicit in prose ordering. It also maps exactly onto Fabula (causal order) vs. Syuzhet (told order). |
| 4 | **Post-hoc detection of structural defects is the weakest link in the pipeline**: on short stories the best frontier model reaches only 76% binary accuracy (chance 50%, human undergrads also 76%) and 0.67 on localizing the flaw; extra reasoning effort *hurts*; accuracy falls to ~61% on 1.2k–4k-word stories; and LLM generation raises plot-hole rates ~100% over human originals (read directly; the earlier "near-random" characterisation was **wrong** — see §3). | Still rules out a post-hoc LLM "validation pass" as the *authority* that establishes `pays_off` validity, but on a narrower argument than before (§6). |
| 5 | Every system that beats a prompting baseline on long-range structure does so by **moving the constraint earlier and making it symbolic** — a detailed outline, a typed premise, a causal event graph audited before realisation. | Confirms the shape of the repo's own plant-obligation walk (ADR 0004), and tells us where to spend the generation budget. |
| 6 | The only work I found aimed squarely at **Chekhov's-gun consistency** encodes foreshadow→trigger→payoff as explicit predicates supplied *ahead of* generation, and reports large gains over standard prompting: narrative-alignment score 0.569 → 0.911 on GPT-4.1-mini, 0.657 → 0.940 on Claude-Haiku-4.5 (read directly). | Direct prior art for `pays_off` as a generation-time constraint (§4.5, §6). |

---

## 1. LLM plot/outline generation systems, and what they actually measured

Ordered oldest to newest. The point of the column "what it measured" is that almost nobody
measures the *outline* — they measure the prose that came out of it, which is the wrong object
for us, since #113's deliverable stops at a `DraftStoryPackageSchema` JSON object.

| System | Venue | Shape | What it measured |
| --- | --- | --- | --- |
| **Re3** (Yang, Tian, Peng, Klein) | EMNLP 2022 — [ACL Anthology](https://aclanthology.org/2022.emnlp-main.296/), [arXiv:2210.06774](https://arxiv.org/abs/2210.06774) | Plan → Draft → Rewrite → Edit. A structured plan (setting, character inventory, three-point outline), then passages generated by re-injecting plan + story state, reranked for plot coherence and premise relevance, then edited for factual consistency. | Human judgements of >2000-word stories: **+14% absolute** on "coherent overarching plot", **+20%** on premise relevance (read directly — verbatim: "human evaluators judged substantially more of Re3's stories as having a coherent overarching plot (by 14% absolute increase), and relevant to the given initial premise (by 20%)"). Note the baseline is "similar-length stories generated directly from the same base model", not a named rolling-window system. GPT-3-era. |
| **DOC** (Yang, Klein, Peng, Tian) | ACL 2023 — [arXiv:2212.10077](https://arxiv.org/abs/2212.10077), [code](https://github.com/yangkevin2/doc-story-generation) | Keeps Re3's plan/draft/revise skeleton; adds a **detailed outliner** (deep hierarchical outline, with an outline-order reranker) and a **detailed controller** (FUDGE-style token-level logit steering toward the current outline item). Explicitly "shifts creative burden from the main drafting procedure to the planning stage." | Human eval on ~3.5k-word stories: **+22.5% absolute plot coherence, +28.2% outline relevance, +20.7% interestingness** over Re3 — **all three verified against the paper, 2026-09-15**; it also reports DOC is "much more controllable in an interactive generation setting." Backbone: GPT-3 + OPT-175B. |
| **CONCOCT** (Wang, Yang, Liu, Klein) | Findings of EMNLP 2023 — [ACL Anthology](https://aclanthology.org/2023.findings-emnlp.723/), [code](https://github.com/YichenZW/Pacing) | Pacing control for hierarchical outlines: a trained **concreteness evaluator** (which of two events is more low-level-detailed), driving a **vaguest-first expansion** that expands the least concrete outline item next, plus concreteness filtering of new items. | Humans judge CONCOCT's pacing "to be more consistent **over 57% of the time** across multiple outline lengths"; gains translate to downstream stories (paper and README both read directly; CONCOCT = CONCrete Outline ConTrol, Wang, Yang, Liu & Klein, 8 Nov 2023). |
| **Dramatron** (Mirowski, Mathewson, et al.) | CHI 2023 — [arXiv:2209.14958](https://arxiv.org/abs/2209.14958), [DOI](https://dl.acm.org/doi/10.1145/3544548.3581225) | Hierarchical prompt chaining from a **log line**: title → characters → beats → location descriptions → dialogue. Can reach tens of thousands of words. | **15 theatre and film industry professionals** co-wrote and were interviewed (read directly; the criticisms are in §5.5, "Fundamental Limitations of the Language Model and of Dramatron"). The failure list is confirmed in participants' own words: "There is a bit of confusion in the logic, gaps in logic"; "computers do not understand nuance, the way we see language"; "A lot of information, a bit too verbalised, there should be more subtext"; "Show, not tell: here we are just telling". On motivation specifically: "If this was given to an actor they are going to struggle with the first thing to do, which is to find the needs and the wants of the character", and "The stories do not finish. The character journeys are not complete". Chinchilla-era; the qualitative failure list is the durable part. |
| **MoPS** (GAIR-NLP) | ACL 2024 — [ACL Anthology](https://aclanthology.org/2024.acl-long.117/), [code](https://github.com/GAIR-NLP/MoPS) | Premise synthesis by **sampling a typed module path first**, then asking the model to fuse it into a sentence. Modules: theme, background (time/place), persona (growth/conflict/collaboration), plot (event/ending/twist). | Diversity via **Semantic Breadth** (the area of the embedding polygon after t-SNE reduction) and **Semantic Density** (the standard deviation of the count sequence in its 2D histogram — lower is more uniform); quality via GPT-4-turbo judge on **Fascination / Completeness / Originality**. Premises "excel in diversity, fascination, completeness, and originality compared to those induced from large language models and captured from public story datasets" (read directly, 2026-09-15). |
| **Agents' Room** (Google DeepMind) | ICLR 2025 — [arXiv:2410.02603](https://arxiv.org/abs/2410.02603), [dataset](https://github.com/google-deepmind/tell_me_a_story) | **Read directly, 2026-09-15 — architecture confirmed exactly.** Planning agents "specialize in generating these intermediate steps and write exclusively to the scratchpad"; writing agents specialise "in writing specific parts of the final output" — for fiction, **five writing agents covering [exposition], [rising action], [climax], [falling action], [resolution]**. A central orchestrator is "responsible for calling the agents in order depending on the task at hand", and the scratchpad "maintains individual agents' outputs and is passed along to the next agent". | Introduced *Tell Me A Story*, "a high-quality dataset of complex writing prompts and human-written stories, and a novel evaluation framework designed specifically for assessing long narratives"; expert evaluators preferred its stories over baselines (abstract read directly). **The released repo still does not publish the rubric** — checked; the README has the dataset and nothing on criteria. |
| **WriteHERE** ("Beyond Outlining") | EMNLP 2025 — [ACL Anthology](https://aclanthology.org/2025.emnlp-main.1254/), [arXiv:2503.08275](https://arxiv.org/abs/2503.08275) | The counterpoint. Argues fixed outline-then-write workflows are "rigid thinking patterns" that constrain adaptability, and instead **interleaves recursive task decomposition with execution** over three task types (retrieval, reasoning, composition). | **Read directly, 2026-09-15.** Confirmed: the critique of "predefined workflows and rigid thinking patterns to generate outlines before writing" causing "constrained adaptability during writing", and the "planning mechanism that interleaves recursive task decomposition and execution" over retrieval, reasoning and composition. It "consistently outperforms state-of-the-art approaches across **all automatic evaluation metrics**" on fiction and technical reports — and the abstract claims **only** automatic metrics, which is the caveat this doc already flagged and which survives the check. (Xiong, Chen, Khizbullin, Zhuge & Schmidhuber; EMNLP 2025.) |
| **PLOTTER** (Gu, Guo, Wang, Xie, Lv) | Findings of ACL 2026 — [ACL Anthology](https://aclanthology.org/2026.findings-acl.1874/), [arXiv:2604.21253](https://arxiv.org/abs/2604.21253) | Plans on **graphs, not text**: an event graph and a character graph, run through an **Evaluate–Plan–Revise** cycle that diagnoses and repairs graph topology under logical constraints **before any full text is generated**. Repairs are atomic graph edits (add / delete / re-link node or edge); a multi-agent critique module "audits symbolic structures rather than raw text"; a Constrained Graph Editor applies the edits. | **Verified 2026-09-15 (read directly).** Pairwise LLM-judge comparisons on five dimensions (Narrative, Thematic Expression, Characterization, Dramatic Engagement, Premise Fidelity) across three backbones (GPT-4.1, DeepSeek R1, Qwen3). On GPT-4.1: **94% win rate on Narrative vs. LLM Plan-and-Write; 100% on Narrative and Characterization vs. Dramatron; 62% on storyline and 92% on full script vs. DOC.** Objective diversity: Distinct-2 0.793 vs. 0.778/0.680/0.752, Self-BLEU 0.017 vs. 0.022/0.090/0.031. Human–LLM-judge agreement 0.834 Cohen's κ. |
| **Outline-stage benchmark** (Yifan Song, arXiv:2608.26177) | 13 Aug 2026 — [arXiv:2608.26177](https://arxiv.org/abs/2608.26177) | Not a system: a head-to-head of **7 long-form frameworks × 3 granularities** (single-chapter, multi-chapter, whole-book) that evaluates **the outline itself**, via an anchor-based LLM-as-judge protocol scoring outlines against source text on a 5-point anchored scale. | **Read directly, 2026-09-15 — every element checks out verbatim.** "Across 21 framework-granularity cells, no single framework dominates; performance depends on the match between a framework's intrinsic output form and the target granularity." Also, from the opening: "Even 70B-parameter models exhibit **length collapse at 16k-token outputs**, and multi-chapter stories frequently trigger the attribute drift characteristic of the **'lost-in-the-middle'** effect." Its stated motivation is ours: existing work "evaluates the final writing rather than the outline itself, conflating two evaluation objects that should be decoupled." Caveat: a single-author August 2026 preprint. |

> **What this means for us.** Two things. First, the field's standard evaluation object is the
> finished prose, and ours is the package — so most reported numbers are not directly comparable
> to anything we will measure. The 2608.26177 protocol (judge the outline, anchored, against a
> reference) is the closest published analogue to what #115's §4 already does, and is the one
> worth cribbing. Second, **"no framework dominates; it depends on the match between output form
> and granularity"** is a licence to not shop for a framework. Our output form is fixed by
> `DraftStoryPackageSchema`; the design question is what the model emits in one call, not which
> paper's pipeline to clone.

---

## 2. The collapse toward generic shapes, and what has been quantified

This is the best-evidenced part of the whole survey, and the evidence got sharper in 2025–26.

**Arc shape specifically.** Tian, Huang, Liu, Jiang, Spangher, Chen, May & Peng, *Are Large
Language Models Capable of Generating Human-Level Narratives?* (EMNLP 2024 —
[ACL Anthology](https://aclanthology.org/2024.emnlp-main.978/),
[arXiv:2407.13248](https://arxiv.org/abs/2407.13248)) — **read directly, 2026-09-15.** Confirmed:
the framework covers exactly the three discourse-level aspects cited — **story arcs, turning
points, and affective dimensions (arousal and valence)** — and the headline holds verbatim:
"While human-written stories are suspenseful, arousing, and diverse in narrative structures, LLM
stories are homogeneously positive and lack tension."

Three details from the body sharpen this, and all three are more useful to us than the headline:

- **It is the *late* turning points that arrive early, not all of them.** The paper finds LLMs
  pace TP1–TP3 acceptably but shows "a substantial advancement (i.e., early occurrence) of TP4 and
  TP5" — the **major setback** and the **climax**. When these "are introduced briefly and then
  resolved rapidly, the resulting arc feels flatter less exciting, and is more lacking in
  intensity." The original text's "turning points introduced earlier in the timeline" was right
  but blunt; the defect is specifically a **compressed and prematurely resolved third act**.
- **Arc-type collapse is quantified.** GPT-4 produces "Man in Hole" more than half the time, and
  negative arcs are nearly absent — "Riches to Rags" appears in **1.3% of AI stories versus 14.6%
  of human** ones.
- **The intervention number exists and the doc did not have it.** Explicit integration of these
  discourse features yields "**over 40% improvement** in neural storytelling in terms of
  diversity, suspense, and arousal."

GPT-4-era models.

**Lexical evidence of the same collapse.** Hamilton & Mimno, *Elias in the Lighthouse, Again?
Diagnosing Low Diversity in LLM Stories* ([arXiv:2605.26492](https://arxiv.org/abs/2605.26492),
26 May 2026) — **read directly, 2026-09-15.** Every element of this claim checks out, which
matters because §8's lexical canary depends on the exact words: the authors sample "20,000 total
stories from four current models using five prompts" and report that "**11 words occur in 88.3% of
generated stories, with little difference between models**." The six named tokens are confirmed as
cited — **names: Elias, Mara, Elara; setting: lighthouses; professions: clockmaker, librarian**.
Their diagnosis is the useful bit and is also verbatim: these tokens "do not often occur in
published literature nor pre-training data, but they are found in **preference data** that is
likely to have been used by all current models" — a small alignment dataset with outsized effect.

**Diversity loss as a population effect.** Doshi & Hauser, *Generative AI enhances individual
creativity but reduces the collective diversity of novel content* (Science Advances 10(28), 12
July 2024 — [DOI](https://www.science.org/doi/10.1126/sciadv.adn5290)): writers given LLM story
ideas produced stories rated more creative, better written and more enjoyable — especially the
less creative writers — but **more similar to each other**, and the boost did not extend to the
more creative writers *(search-verified — **still unopened**; `www.science.org` remained blocked
by the egress proxy during the 2026-09-15 pass, and it is the one paper host in this doc that did
not come back)*.

Padmakumar & He, *Does Writing with Language Models Reduce Content Diversity?* (ICLR 2024 —
[arXiv:2309.05196](https://arxiv.org/abs/2309.05196)) — **read directly, 2026-09-15.** Confirmed
and sharper than the original summary: "writing with InstructGPT (but not the GPT3) results in a
statistically significant reduction in diversity", and the effect "is mainly attributable to
InstructGPT contributing less diverse text to co-written essays. In contrast, the user-contributed
text remains unaffected by model collaboration." The study is on **argumentative essays**, not
stories, so it is corroborating rather than direct evidence — but note that the mechanism it
isolates (the *model's* contribution homogenises; the human's does not) is the same
post-training-locus story Hamilton & Mimno and Sui tell.

**Why, mechanistically.** Two 2026 papers name mechanisms rather than just the symptom:

- Sui, *LLMs Exhibit Significantly Lower Uncertainty in Creative Writing Than Professional
  Writers* ([arXiv:2602.16162](https://arxiv.org/abs/2602.16162), 18 Feb 2026) — **read directly,
  2026-09-15.** An information-theoretic analysis over **28 LLMs**, finding human writing
  consistently higher-uncertainty; "instruction-tuned and reasoning models **exacerbate this
  trend** compared to their base counterparts"; and "the gap is **more pronounced in creative
  writing than in functional domains**". Its framing is the useful part: alignment reduces
  hallucination and in the same move removes the "constructive ambiguity required for literary
  richness" — the same post-training-not-pretraining story Hamilton & Mimno tell lexically.
- Deng, Brucks & Toubia, *Examining and Addressing Barriers to Diversity in LLM-Generated Ideas*
  ([arXiv:2602.20408](https://arxiv.org/abs/2602.20408), 23 Feb 2026) — **read directly,
  2026-09-15, and it is verbatim as cited.** Two separable mechanisms: "at the individual level,
  LLMs exhibit **fixation** just as humans do, where early outputs constrain subsequent ideation",
  and "at the collective level, LLMs **aggregate knowledge into a unified distribution** rather
  than exhibiting the knowledge partitioning inherent to human populations". The interventions are
  separable too: chain-of-thought reduces fixation (an effect "specific to LLMs rather than
  humans"); **ordinary personas** — explicitly as against famous innovators like Steve Jobs —
  restore partitioning by anchoring generation in distinct semantic regions; and "combining both
  approaches produces the highest idea diversity, outperforming humans". **Domain confirmed as
  not stories:** participants "generated ten ideas for fitness products". Corroborating, not
  direct.

> **What this means for us.**
>
> 1. **Fixation is the finding that bears directly on §6.** Whatever the arc generator emits
>    first dominates everything it emits afterwards. That is an argument against any ordering
>    that lets one half of the arc (the abstract dependency graph, or the free-drafted event
>    list) be fully fixed before the other half exists.
> 2. **Diversity is won upstream of the arc, at the seed.** MoPS's result — sample a *typed
>    module path* first, then let the model fuse it — and Deng et al.'s persona result both say
>    the same thing: vary the structured input, not the decoding. For us the seed is the World
>    Model seed plus premise, which is exactly where #113 puts it.
> 3. **The lexical canary is free.** Checking a generated package for `Elias` / `Mara` /
>    `Elara` / lighthouse / clockmaker / librarian costs nothing and catches mode collapse at
>    the point it is cheapest to fix. See §8.
> 4. `CONTEXT.md` accepts **uniform beat shape** as unaddressed for v1 because it is only
>    visible in aggregate at the Performance layer. At the Fabula layer it is *not* invisible —
>    Tian et al.'s arc/turning-point/valence framework is computable over an event list. That
>    changes what is tractable, though it does not change the v1 Performance-layer decision.

---

## 3. How far causal coherence survives, and what breaks first

**Blunt answer to the ticket's framing first: no source I could verify reports a beat-count
threshold.** Nothing says "coherence survives N beats." Claims of the form "LLM plots fall apart
after about five beats" are not something I can substantiate, and I am not going to assert one.
What *is* quantified is (a) the failure's shape, (b) its position within a narrative, and (c) its
monotone relationship with length.

**What breaks first: causal *direction*, via a positional shortcut.** *Failure Modes of LLMs for
Causal Reasoning on Narratives* (Yamin, Gupta, Ghosal, Lipton & Wilder; October 2024, rev. June
2025 — [arXiv:2410.23884](https://arxiv.org/abs/2410.23884)) — **read directly, 2026-09-15.**
Confirmed: across controlled synthetic, semi-synthetic and real-world experiments, SOTA LLMs
"often rely on superficial heuristics — for example, inferring causality from event order or
recalling memorized world knowledge without attending to context." So both halves of the original
claim hold: a **positional shortcut** (earlier narrated event treated as cause), and reliance on
**parametric knowledge** over the narrative in front of the model. Length-sensitivity is confirmed
too, and in a sharper form than "gets worse": *"the longer the narrative is, the more the LLM
relies on shortcuts instead of performing reasoning."*

**The graph result, with its wording corrected.** *(corrected 2026-09-15.)* This doc previously
carried, inside quotation marks, the sentence *"asking the model to extract the entire causal
graph from the narrative, and then directly using that graph for reasoning largely overcomes both
biases and is robust to increased narrative length."* **That sentence does not appear in the
paper, in any version** — it was a search-index paraphrase that the original pass reproduced as a
quotation. The finding it paraphrases is real and the direction is right, but the paper's own
wording is weaker and more precise. What the paper actually says: a results heading reads
**"Explicit Causal Graph Extraction Avoids Shortcuts"**; answering from the extracted graph *G′*
alone produces large gains in the reverse-topological-order condition; and *"the extracted graph
G′ can often maintain a consistently high level of accuracy across narrative sizes."* The v1
abstract's summary is the most measured formulation of all, and worth keeping as the citable one:
*"explicitly generating a causal graph generally improves performance while naive chain-of-thought
is ineffective."* Note the second clause — it is a free bonus for us: **the mitigation is emitting
the structure, not thinking harder.**

That is a Fabula/Syuzhet result in disguise. The positional shortcut is precisely the failure of
distinguishing told order from causal order — the distinction `CONTEXT.md` is built on. And the
fix is to materialise the causal structure as an object.

**Where it breaks: the middle.** *Lost in Stories: Consistency Bugs in Long Story Generation by
LLMs* (Li, Guo, Wu, Lee, Li, Xie; March 2026 — publication record read directly at
[Microsoft Research](https://www.microsoft.com/en-us/research/publication/lost-in-stories-consistency-bugs-in-long-story-generation-by-llms/),
[arXiv:2603.05890](https://arxiv.org/abs/2603.05890)) introduces **ConStory-Bench** — 2,000
prompts across four task scenarios, with a taxonomy of **5 error categories and 19 fine-grained
subtypes** — plus **ConStory-Checker**, an automated detection pipeline. Findings: errors are
predominantly **factual and temporal**, they **cluster around narrative midpoints**, they
correlate with **higher token-level entropy** segments, and specific error types **co-occur**.

**How hard it is to catch after the fact.** *Finding Flawed Fictions: Evaluating Complex
Reasoning in Language Models via Plot Hole Detection* (Ahuja, Sclar & Tsvetkov; April 2025, rev.
December 2025 — [arXiv:2504.11900](https://arxiv.org/abs/2504.11900)) — **read directly,
2026-09-15.** It synthesises plot holes into human-written Project Gutenberg stories
(FlawedFictionsMaker) to build a contamination-robust benchmark. The structural figures check out:
**414 examples (207 positive / 207 negative), average story length 731 words**, plus
**FlawedFictionsLong**, a 200-example extension (97/103) in the **1,200–4,000-word** range,
averaging 2,703 words. The abstract's headline claims check out verbatim: SOTA LLMs "struggle in
accurately solving FlawedFictions **regardless of the reasoning effort allowed**, with performance
**significantly degrading as story length increases**," and LLM summarization and generation are
"prone to introducing plot holes, with more than **50%** and **100%** increases in plot hole
detection rates with respect to human-written originals" (summarization 0.31 → 0.45; contemporary
adaptation 0.14 → 0.27, worst case 0.14 → 0.53, a 278% increase).

**One characterisation was wrong, and it is the one this doc leaned on hardest.**
*(corrected 2026-09-15.)* The original pass reported a search summary calling frontier-model
accuracy **near-random**, and flagged it as unverified. Having opened the paper: **it is wrong for
the main benchmark.** On FlawedFictions classification the random baseline is 50%, the best model
(Claude 3.5 Sonnet) reaches **76%** — and that is exactly the **human undergraduate baseline,
also 76%**. "Near-random" is true only of the *long* subset: on FlawedFictionsLong the best model
(o1) manages **61%**, barely above chance. The right summary is therefore: **detection is at
human parity on short stories and collapses toward chance on long ones.**

Two further details from the body that survive the correction and matter more than the headline:

- **Reasoning effort actively hurts.** Raising o3-mini's effort from low to high — "an increase
  from less than 1000 reasoning tokens on average to over 5000 tokens (roughly 5 times the number
  of tokens in the stories)" — *drops* its CEEval-Full score, as it does for o1. Claude 3.5
  Sonnet, "which utilizes no additional test time compute," beats Claude 3.7 Sonnet with extended
  thinking.
- **Localization is worse than classification, and localization is our task.** Telling *whether*
  a story has a hole is the 76% number. Saying *where* it is — the two-way localization task,
  CEEval-Full — tops out at **0.67** for Claude 3.5 Sonnet (0.68 with a verifier, matching human).
  "Which earlier scene was supposed to plant this?" is a localization question, not a
  classification one.

**Length collapse at the generation end.** The outline-stage benchmark reports **length collapse
at 16k-token outputs even for 70B models**, and "lost-in-the-middle" attribute drift in
multi-chapter settings (read directly, 2026-09-15).

> **What this means for us.** Our arcs are small by this literature's standards — the fixture
> packages are 14 and ~20–26 scenes ([`fixture-stories.md`](fixture-stories.md)) — and a Fabula
> event list is far shorter than a 16k-token draft. So the *length* failure mode is not our
> first worry. The three that are:
>
> - **Causal direction under non-chronological telling.** The moment an arc uses a reveal held
>   back (which is the entire point of the World Model / Discourse Record split), the model's
>   positional shortcut is working against us. Emitting the causal structure explicitly is the
>   documented mitigation.
> - **The middle of the arc.** ConStory's mid-narrative clustering says the scenes to scrutinise
>   are not the opening or the ending — which are the ones a human skim-reader checks.
> - **Detection is the weak link, not generation** — but the honest version of that is narrower
>   than the original draft of this doc claimed. At *our* story lengths, plot-hole detection is at
>   human-undergraduate parity (76% vs. 50% chance), not near-random. What is genuinely weak at
>   our scale is **localization** (0.67), which is the shape of the question a post-hoc linking
>   pass would have to answer. A generated arc's defects are still cheaper to prevent than to
>   find, but §6 argues it on that narrower basis now.

---

## 4. Constraint mechanisms in the wild — and what I would actually crib

### 4.1 Outline-then-expand / hierarchical generation

Re3 → DOC → CONCOCT is one lineage, and its trajectory is instructive: each step moved *more*
work into the plan. DOC's stated thesis is shifting creative burden from drafting to planning,
and it bought +22.5% absolute plot coherence over Re3 for doing so (verified against the paper). CONCOCT
then showed the *expansion order* inside the outline matters independently: expanding the
**vaguest item next** produced more consistent pacing over 57% of the time (verified against the
paper, 2026-09-15).

**Crib:** the vaguest-first idea, as a procedural rule for how an arc generator elaborates. If
we ever expand a generated arc from a premise through intermediate levels rather than in one
pass, expanding the least-specified region next is a cheap, validated heuristic that directly
targets the "everything happens in act three" pathology.

**Don't crib:** DOC's detailed controller. It is FUDGE-style token-level logit steering against a
local model; we call a hosted Gemini endpoint with a response schema
([`gemini-capabilities.md`](gemini-capabilities.md)) and have no logit access. Our equivalent of
"the outline is respected during generation" is the response schema itself plus the linter.

### 4.2 Explicit causal / event-graph scaffolding

**PLOTTER** (Gu, Guo, Wang, Xie & Lv, *Planning Beyond Text: Graph-based Reasoning for Complex
Narrative Generation*, Findings of ACL 2026, April 2026) is the closest thing in the literature to
what ADR 0004 already does, arrived at from the other direction. **Read directly, 2026-09-15 — the
architecture the original pass assembled from agreeing search summaries is correct in every
particular.** It plans on an event graph and a character graph; runs **Evaluate–Plan–Revise over
the graph topology under logical constraints**, and in the paper's own words "optimizes the
causality and narrative skeleton before complete context generation"; decomposes repair into
**atomic edit operations ω ∈ Ω** (named examples: *Add-Plot-Bridge*, *Revise-Event*, plus
operations that add suspense or foreshadowing); and deploys a **multi-agent critique module** of
Theme, Character and Plot critics over the symbolic structure. The **Constrained Graph Editor**
applies the edits under two named constraints — *Causal Rationality* (maintain a DAG) and
*Narrative Completeness* (reachability). Its thesis sentence is close to this doc's §6: "planning
narratives on structural graph representations — rather than directly on text — is crucial to
enhance the long context reasoning of LLMs in complex narrative generation."

**Its margins, which the original pass could not get** (§1's table has the detail): pairwise
LLM-judge win rates of 62–100% over LLM Plan-and-Write, Dramatron and DOC across five dimensions
and three backbones, plus better lexical diversity (Distinct-2 0.793, Self-BLEU 0.017) than all
three. Two caveats worth carrying: the headline comparisons are **pairwise LLM-as-judge**, and the
two strongest baselines it beats (Dramatron, DOC) are from the GPT-3/Chinchilla era while PLOTTER
runs on GPT-4.1 — the 100% win rates should be read with that in mind. Human raters agreed with
the LLM judge at 0.834 Cohen's κ, which is the mitigation the authors offer.

Adjacent, from the 2026 narrative-theory survey ([arXiv:2602.15851](https://arxiv.org/abs/2602.15851),
Liu, Joshi & Dawson; Jan 2026, rev. June 2026) — **survey read directly, 2026-09-15; both
pointers confirmed to be in it.** Yoo & Cheong (2024) use **Story Plan Graphs** to "select a
single sequence narrative events from different possible branches", and the survey explicitly
frames this with the fabula/discourse distinction — the same split `CONTEXT.md` is built on.
Ghaffari & Hokamp (2025) apply narrative equilibrium theory "to introduce a framework for
navigating stories as **dynamic causal event graphs**"; the name *Narrative Studio* does not
appear in the survey text I read, so treat the title as unconfirmed. **I still have not opened
either original**, and they remain pointers only, not evidence.

**Crib, in order of value:**

1. **Audit the structure, never the prose.** This is already the repo's instinct — the continuity
   pass is constitutionally digest-only (`CONTEXT.md`), the plant walk runs before generation
   (ADR 0004 decision 4). PLOTTER is independent confirmation that it is the right axis for a
   *Fabula*-layer generator too.
2. **Repair as atomic edits to the structure.** When a generated arc fails validation, the fix is
   an edit — add the `fact_ref` to an earlier scene's `reader_must_learn`, re-point a `pays_off`
   entry, drop a payoff — not regenerate the whole arc. Cheaper, auditable, and it preserves
   whatever the arc got right.
3. **Emit the causal graph as an object because the model reasons better over it.** §3's
   extraction result is the justification.

### 4.3 Iterative critique-and-revise loops

Re3's revise step is really two: **rerank** candidate continuations for coherence and premise
relevance, then **edit** the best one for factual consistency. PLOTTER's is a multi-agent critique
over symbolic structure. Both put the critique against something *other than* the raw draft — a
ranked set, or a graph.

The caution is well-evidenced and it is the important half of this subsection. Huang, Chen,
Mishra, Zheng, Yu, Song & Zhou, *Large Language Models Cannot Self-Correct Reasoning Yet* (ICLR
2024 — [arXiv:2310.01798](https://arxiv.org/abs/2310.01798)) — **read directly, 2026-09-15.**
Confirmed verbatim: the paper's subject is **intrinsic self-correction**, "whereby an LLM attempts
to correct its initial responses based solely on its inherent capabilities, without the crutch of
external feedback," and its finding is that "in the context of reasoning… **LLMs struggle to
self-correct their responses without external feedback, and at times, their performance even
degrades after self-correction**." One scope note the original pass did not make: the evaluation
is on **reasoning benchmarks, not narrative**, so this transfers to us by analogy — a payoff-link
inference *is* a reasoning step over the draft, but the paper did not measure that. Put it next to
§3's localization result and a "model re-reads its own arc and fixes the problems" loop is still
the least reliable component you could build.

**Crib:** critique loops, but only ones whose feedback signal is **external and mechanical**. We
have exactly such a signal already: `lintPackage`'s five plant-walk error codes
(`plant_scene_unknown`, `plant_after_payoff`, `plant_not_declared`, `unfounded_seed_payoff`, plus
`unknown_entity`) and the `unpaid_fact` warning. A loop of *generate → lint → repair the named
error → re-lint* is external feedback in Huang et al.'s sense. A loop of *generate → "find the
problems with this arc" → revise* is not.

### 4.4 Plan-then-write agents

**Dramatron** and **Agents' Room** are the two to know, and both were **read directly on
2026-09-15**. Dramatron's professional-user study is worth more to us than its architecture, and
the complaint list holds up in the participants' own words (§1's table quotes them): **gaps in
logic, missing nuance and subtext, "show, not tell" violations, and absent character motivation**
— one participant's framing is the sharpest version of the last: an actor "are going to struggle
with the first thing to do, which is to find the needs and the wants of the character." Note what
that list is — every item is a Fabula/Syuzhet defect, not a prose defect. Agents' Room's
contribution is decomposition by **narrative function**, confirmed as literally arc-shaped: five
writing agents for exposition, rising action, climax, falling action and resolution, coordinated
by an orchestrator over a shared scratchpad.

**Crib:** the observation that character *motivation* is the first thing readers notice missing
from a machine-planned arc. In our schema, motivation is a **volitional** property — the tier the
engine may only ever propose, never commit (ADR 0005). An arc generator is authoring at a layer
above that boundary and *can* set volitional ground truth in the seed; Dramatron's finding says
it had better do so deliberately rather than leaving goals implicit in the event list.

**Don't crib** the multi-agent orchestration itself, yet. Agents' Room's decomposition is by
narrative function over prose; #113's deliverable is one JSON object, and a multi-agent
architecture is a large bet to place before a single-call baseline has been measured.

### 4.5 Setup/payoff (Chekhov's gun) specifically — the thinnest and most relevant literature

One paper, and it is on the nose. **Codified Foreshadowing-Payoff Text Generation**
(Yun, Zhou, Hou, Peng & Shang; [arXiv:2601.07033](https://arxiv.org/abs/2601.07033), submitted
**11 January 2026**) — **read directly, full text, 2026-09-15**. The paper exists, and the
framing the original pass reported from search summaries is accurate: authors introduce
commitments early and resolve them later, LLMs "frequently fail to bridge these long-range
narrative dependencies, often leaving *Chekhov's guns* unfired even when the necessary context is
present," and existing evaluation "largely overlooks this structural failure, focusing on
surface-level coherence rather than the logical fulfillment of narrative setups."

**Method, confirmed.** CFPG mines **Foreshadow–Trigger–Payoff triples** and transforms narrative
continuity into "a set of executable causal predicates." The triples live in an explicit
**Foreshadow Pool**; during a "Guided Continuation" phase the eligible triples' payoffs are
**injected into the model's context as narrative requirements before the text is generated**. The
stated goal is that a commitment is "not only mentioned but also temporally and logically
fulfilled." So the *ahead-of-generation, predicate-shaped* reading this doc leaned on in §6 is
correct.

**Corpus — the discrepancy between the two research docs resolves as "both right."**
[`narrative-extraction-prior-art.md`](narrative-extraction-prior-art.md) §4.6 describes the corpus
as "148 books, 629 validated pairs via an identify/verify/filter pipeline"; this doc said "mines
from the BookSum corpus." The paper says both: *"The resulting dataset comprises 629 validated
foreshadow-payoff pairs extracted from 148 books"* — and the books are BookSum's long-form
literary summaries. The three-stage pipeline is (1) candidate identification, GPT-4.1 scanning
summaries for sentence-anchored foreshadow–payoff pairs; (2) payoff-alignment verification, a
symbolic gate filtering for genuine causal resolution; (3) rubric-based filtering, two independent
verifiers scoring Setup Validity, Payoff Validity, Temporal Separation and Foreshadow
Justification. **Average payoff distance is 20.9 sentences (median 13.0); 25% of payoffs exceed 29
sentences and 10% exceed 45** — i.e. the dependencies really are long-range, which is the property
that makes the work relevant to us at all.

**Results, now quoted.** Two experiments:

- **Table 1, oracle timing** (the model is told *when* the payoff is due). Metric is
  "Behavioral Alignment via Narrative Entailment" — an LLM judge scoring whether the continuation
  entails (1.0), is neutral to (0.5) or contradicts (0.0) the intended trajectory. Prompt → CFPG:
  GPT-4.1-mini **0.569 → 0.911**, Claude-Haiku-4.5 **0.657 → 0.940**, Qwen2.5-14B **0.583 →
  0.898**, Llama-3.1-8B 0.530 → 0.802, Qwen2.5-7B 0.517 → 0.797, Qwen2.5-3B 0.481 → 0.781.
  Should-Payoff Rate under CFPG is ~1.000 across backbones.
- **Table 2, grounded payoff tracking** (incremental context, no oracle — the model must decide
  when to fire). Far harder: GPT-4.1-mini detection rate **58.0% → 69.8%**, early triggers
  **235 → 166**, continuation/fidelity score **0.453 → 0.647**. Small open models are much worse
  (Qwen2.5-7B detection 19.6% under CFPG).

**The caveat the abstract hides, and it matters for §6.** The near-perfect numbers are under
**oracle timing**. When the model has to choose the moment itself, the best backbone still fires
the right payoff only ~70% of the time, and the dominant residual error is firing **too early**
(166 early triggers vs. 11 late). That is direct evidence for the point §4.5 already made
structurally — the *trigger* is the hard term — and it is a reason to read CFPG as support for
supplying commitments ahead of generation, **not** as evidence that doing so solves timing.

Three things I would take from it:

1. **The three-part structure beats our two-part one.** Our `pays_off` edge is
   `{fact_ref, plant}` — setup and payoff. CFPG's unit is **foreshadow → trigger → payoff**: the
   middle term is what makes the gun fire *at the right moment* rather than merely eventually.
   We have no field for it, and I am explicitly **not** proposing one — #113's non-goals say a
   missing field is an ADR discussion, not something to bend into a ticket. But it names the most
   likely defect in a generated arc that passes ADR 0004's walk: the plant exists, the payoff
   exists, and nothing in between causes the payoff to happen *there*.
2. **"Not merely mentioned" is the right bar, and it is the bar `plants_opened` already
   struggles with** — ADR 0004's 2026-09-11 amendment exists because the writer reported the
   instruction sentence instead of the slug. Same failure family, one layer down.
3. **Payoff accuracy is a nameable metric** and belongs in the #115 rubric's vocabulary (§8).

---

## 5. What I would crib, in one table

| Mechanism | Source | How it lands in this repo |
| --- | --- | --- |
| Judge the **outline**, not the prose, on an anchored scale | Outline-stage benchmark, [arXiv:2608.26177](https://arxiv.org/abs/2608.26177) (read directly) | Already the shape of `story-authoring-eval.md` §4. Adopt anchored 5-point scales for its 1–5 criteria so scores are comparable across tickets. |
| Vaguest-first expansion | CONCOCT, [ACL](https://aclanthology.org/2023.findings-emnlp.723/) | If arc generation ever becomes multi-pass, elaborate the least-specified region next. |
| Plan on an explicit graph; audit the graph, not the text; repair by atomic edit under DAG + reachability constraints | PLOTTER, [ACL](https://aclanthology.org/2026.findings-acl.1874/) (read directly) | Confirms ADR 0004's walk-before-generation posture; gives the repair loop its shape (§6). |
| Extract/emit the causal graph because the model reasons better over it (and because naive CoT does not help) | [arXiv:2410.23884](https://arxiv.org/abs/2410.23884) (read directly) | `pays_off` as a first-class emitted field, not a relation inferred from event order (§6). |
| Critique loops only with **external** feedback | Huang et al., [arXiv:2310.01798](https://arxiv.org/abs/2310.01798) (read directly) | The repair loop's oracle is `lintPackage`, never the model's own re-reading. |
| Typed module sampling for premise diversity | MoPS, [ACL](https://aclanthology.org/2024.acl-long.117/) (read directly) | Vary the World Model seed / premise structurally across runs, not by temperature. |
| Personas + CoT as separable diversity interventions | [arXiv:2602.20408](https://arxiv.org/abs/2602.20408) | Cheap A/B for the arc-generation prototype (#119) if diversity measures badly. |
| Arc / turning-point / valence-arousal analysis as a diversity metric | Tian et al., [ACL](https://aclanthology.org/2024.emnlp-main.978/) (read directly) | A computable aggregate check over a generated event list (§8). |
| Consistency-error taxonomy (5 categories / 19 subtypes) | ConStory-Bench, [MSR](https://www.microsoft.com/en-us/research/publication/lost-in-stories-consistency-bugs-in-long-story-generation-by-llms/) | A ready-made vocabulary if #115's judged criteria ever need error *subtypes* rather than scores. |
| "Payoff accuracy" as a named metric; foreshadow→**trigger**→payoff as the unit | CFPG, [arXiv:2601.07033](https://arxiv.org/abs/2601.07033) (read directly) | Names the gap between a *valid* `pays_off` graph and an *earned* one (§8). Its detection-rate / early-vs-late-trigger split is also a usable shape for measuring payoff *timing*. |

---

## 6. Recommendation: `pays_off` is a generation-time constraint, validated mechanically

**Recommendation: interleaved.** The arc generator should emit the event list and its `pays_off`
edges **in the same structured pass**, with each payoff naming its plant as it is written. A
validation pass still runs — it is `lintPackage` and ADR 0004's walk, unchanged — but its job is
to **reject and drive repair, never to author a link**.

> **Post-verification status (2026-09-15, [#126](https://github.com/tschomay/axiom-weaver/issues/126)).**
> Every citation this recommendation rests on has now been opened and checked, and **the
> recommendation stands** — but two of its supports were overstated and have been rewritten in
> place rather than quietly trimmed:
>
> - The claim that frontier models detect plot holes at **near-random** accuracy was **wrong**
>   (76% vs. 50% chance at our story lengths — human-undergraduate parity). Argument (b)2 below
>   has been rebuilt on what the paper actually shows: a ~24% error rate, a 0.67 localization
>   score, reasoning effort *hurting*, and near-chance performance once stories get long.
> - The causal-graph result was quoted with words the paper does not use ("largely overcomes…
>   robust to increased narrative length"). The real finding — explicit graph extraction "avoids
>   shortcuts" and holds accuracy "across narrative sizes", while naive chain-of-thought does not
>   — still supports (c), and the chain-of-thought clause makes it a *stronger* argument for
>   emitting structure specifically.
>
> Arguments (a) (fixation), (b)1 (ADR 0004 decision 2) and (b)3 (intrinsic self-correction) are
> untouched: Deng et al. and Huang et al. both verified verbatim. The positive case in (c) is
> **stronger** than it was — CFPG's numbers exist and are large, and PLOTTER's margins are no
> longer a blank. The one thing the evidence now says that it did not before: **supplying
> commitments ahead of generation does not fix payoff *timing*** (CFPG's no-oracle detection rate
> is 69.8%, erring early), which is an argument for taking the plant-span histogram seriously,
> not for changing the decision.

Concretely, the three candidate shapes and why two lose:

**(a) Graph strictly first — reject.** A `pays_off` entry is `{fact_ref, plant: scene_id | null}`
(ADR 0004 decision 1). Both halves reference things that do not exist until the events do: a
`fact_ref` has to be a fact of *this* world, and `plant` is a Scene Card id. Generating the
dependency graph before the events means inventing an abstract skeleton of commitments and then
retrofitting a world onto it. Deng et al.'s **fixation** finding makes the cost concrete, and it is verified verbatim
(2026-09-15): "early outputs constrain subsequent ideation", so whatever is generated first
dominates. Letting an abstract
dependency lattice dominate is the most direct route to the tidy, mechanical, generic arc that
§2 says is already the default failure.

**(b) Validation pass over a free-drafted skeleton — reject, and this is the one worth arguing
against explicitly.** It fails on three independent grounds:

1. **It re-introduces exactly what ADR 0004 decision 2 forbids.** "The compiler never invents
   where a plant lands — an undeclared plant is a hard authoring error, not a guess." A pass that
   reads a drafted event list and *infers* which earlier scene plants each payoff is that guess,
   relocated one layer upstream. It would produce packages that lint clean because a model
   asserted the links, which is a strictly worse guarantee than a human author asserting them —
   and the linter cannot tell the difference.
2. **It puts a weak measured capability in the critical path — and this argument is now
   narrower than it was, because the evidence turned out narrower.** *(Revised 2026-09-15 after
   reading the source; see §3.)* The original text said frontier models detect structural
   narrative defects "badly," on the strength of a search summary calling their accuracy
   near-random. **That summary was wrong.** On *Finding Flawed Fictions*' main benchmark — 731-word
   stories, i.e. the scale closest to ours — the best model hits **76%**, which is chance + 26
   points and exactly the human-undergraduate baseline. At our arc lengths, "the model cannot see
   plot holes at all" is not a claim the literature supports, and this doc should not make it.

   What the evidence does support, and what this argument now rests on:

   - **76% is human parity and still nowhere near a gate.** A ~1-in-4 error rate on the check
     that establishes whether `pays_off` is valid is not a foundation; ADR 0004's walk is exact.
   - **Localization, not classification, is the task.** Inferring *which earlier scene plants
     this payoff* is the localization question, and the best measured score there is **0.67**.
   - **More reasoning effort makes it worse**, so the obvious mitigation (let it think longer) is
     ruled out by the same paper.
   - **Length still kills it** (~61%, near chance, on 1.2k–4k-word stories) — a ceiling on any
     future version of this that runs over a longer package.
   - **The generator is itself a ~100% source of new plot holes** (0.14 → 0.27 detection rate for
     LLM adaptation vs. human originals; 278% worst case), so the artefact being validated is
     unusually defect-dense to begin with.
3. **It is intrinsic self-correction.** Huang et al.: without external feedback, self-correction
   does not reliably help and sometimes hurts. A linking pass over the model's own draft has no
   external signal — the draft is the only evidence, and the model wrote it.

**(c) Interleaved, graph-explicit, mechanically validated — adopt.** The positive case:

- It is what the **only setup/payoff-specific work** does: CFPG supplies foreshadow/payoff
  commitments as explicit predicates *ahead of* realisation, and beats prompting the model to
  just write well by a wide margin — narrative-alignment 0.569 → 0.911 (GPT-4.1-mini) and
  0.657 → 0.940 (Claude-Haiku-4.5) under oracle timing (read directly, §4.5). **Read the caveat
  with it:** without oracle timing, CFPG's best backbone still lands the payoff in the right
  place only 69.8% of the time, erring overwhelmingly *early*. Supplying the commitment ahead of
  generation is well-supported; expecting it to fix *timing* is not.
- It is what the **graph-planning** work does: PLOTTER optimises the causal skeleton *before*
  textual realisation, and audits the symbolic structure rather than the text.
- It is what the **causal-reasoning** result predicts: explicit causal-graph extraction "avoids
  shortcuts," and the extracted graph "can often maintain a consistently high level of accuracy
  across narrative sizes" (read directly — the stronger "largely overcomes … robust to increased
  narrative length" phrasing this doc used to quote is not the paper's; §3). The same paper adds
  that **naive chain-of-thought is ineffective**, which is the part that makes this an argument
  for *emitting structure* specifically rather than for prompting harder. Our model is going to
  have to hold reveal order apart from causal order — that is what the World Model / Discourse
  Record split *is* — and the positional shortcut is precisely the failure that emitting the
  graph fixes.
- It matches the one thing this repo already knows works: ADR 0004 validates **before
  generation**, rejects three error classes "without generating a single token", and the whole
  plant-obligation design turns declared links into forward-looking obligations. Making the
  generator declare links live keeps that machinery in its existing role instead of adding a
  second, weaker authority next to it.

**The repair loop, when validation fails.** Bounded, external-feedback-driven, and structural —
the linter names an error code and a field path; the repair is an **atomic edit** to the package
(PLOTTER's graph-editing framing, in our schema): add the `fact_ref` to an earlier scene's
`reader_must_learn`, re-point the `plant`, or drop the payoff. One bounded retry then surface to
the author, mirroring the shape the repo already uses everywhere (ADR 0012, ADR 0005). Never a
whole-arc regeneration; never a "look again and fix it" prompt with no error code in it.

### The tradeoff I am accepting

**Constraining `pays_off` at generation time buys structural validity and pays for it in arc
surprise.** A model that must name a plant for every payoff as it writes will plant only what it
has already decided to pay off — so late emergent reversals, the payoff that recontextualises an
earlier scene the author did not originally intend as a setup, become much less likely. The
predictable failure of this design is the **mechanically valid, dramatically inert** arc: every
payoff correctly linked, every plant one or two scenes ahead of its payoff, nothing that reaches
across the arc. That defect is invisible to `lintPackage` by construction — it is a well-formed
graph.

Two things make the tradeoff acceptable rather than merely stated:

- The existing rubric already has the two instruments that see it: the **plant-span distribution
  histogram** (`story-authoring-eval.md` §4.1, explicitly not pass/fail, explicitly there because
  "an arc whose every plant lands one scene before its payoff is structurally valid and
  narratively inert") and the judged criterion **payoff earned-ness** ("earned" vs "linked only",
  bar ≥ 0.70). Those are now the two numbers that matter most for this decision, not G0.
- A second cost is mundane and known: emitting events and `pays_off` in one structured call means
  a larger response schema, and per [`gemini-capabilities.md`](gemini-capabilities.md) §1 the
  response schema is **billed as input on every call and is not cacheable**. Budget for it; keep
  the arc schema lean; measure it with `countTokens` before assuming.

### What would change my mind

If a prototype's plant-span histogram collapses to ~1 (every plant immediately before its
payoff), the fix is **not** to retreat to (b). It is a second *generation* pass that is permitted
to **edit earlier scenes' `reader_must_learn` to install a plant** — an atomic structural edit,
authored by the generator, validated by the walk. The distinction matters and is the whole point
of this section: **editing the skeleton to install a plant is authoring, and is legitimate;
inferring which existing scene "must have been" the plant is guessing, and ADR 0004 already
forbids it.**

---

## 7. Where the evidence is thin — stated plainly

*Revised 2026-09-15 after the #126 verification pass. Caveats that were really about a blocked
proxy have been resolved and struck; what is left is thin for substantive reasons, plus two new
entries for things the pass turned up.*

- **No beat-count threshold exists in anything I could verify.** "Causal coherence survives N
  beats" is not a claim the literature supports in that form (§3). **Unchanged after reading the
  sources** — having now opened the causal-reasoning and plot-hole papers in full, neither offers
  a threshold, and I would not expect one to exist.
- **NEW — one number in this doc was simply wrong, and it was load-bearing.** The "frontier models
  are near-random at plot-hole detection" characterisation came from a search summary, was flagged
  as unverified, and is **false** for the story lengths we care about: the best model scores 76%
  against a 50% chance baseline and a 76% human baseline. §3 and §6(b)2 are corrected. The lesson
  for the *(search-verified)* convention is worth recording: the tag correctly quarantined the
  claim, but the doc still leaned on it in a recommendation, which is one step further than the
  tag licenses.
- **NEW — one "quotation" in this doc was not a quotation.** §3 carried a sentence in quote marks
  attributed to arXiv:2410.23884 that appears in no version of that paper. The underlying finding
  is real; the wording was a search-index paraphrase. Nothing else in the doc was found to be
  fabricated, but quoted material from the original pass should be assumed paraphrased unless it
  now says "read directly".
- ~~**CFPG is one paper, unopened...**~~ **Resolved 2026-09-15.** CFPG has been read in full.
  The paper exists, the title, date and authors are as cited, the method is as described, and the
  numbers are now quoted in §4.5. The two research docs' apparently conflicting corpus
  descriptions ("BookSum" vs. "148 books, 629 pairs") turned out to describe the same dataset.
  What remains thin is narrower and real: **it is still one paper, eight months old, and its
  headline gains are measured under oracle timing.** Its no-oracle numbers (69.8% detection,
  errors skewed early) say the *trigger* term is unsolved, which is exactly the term our schema
  has no field for.
- ~~**PLOTTER's margins are unverified.**~~ **Resolved 2026-09-15.** Read directly; the
  architecture was right and the numbers are now in §1 and §4.2. The residual caveat is different
  and smaller: its headline margins are **pairwise LLM-as-judge** win rates, and two of the three
  baselines it beats are several model generations older than its own backbone.
- **Nothing here is measured on `gemini-3.8-flash` or any Gemini model.** Re3/DOC/CONCOCT are
  GPT-3/OPT-175B-era; Dramatron is Chinchilla-era; Tian et al. and TTCW are GPT-4-era;
  *Finding Flawed Fictions* tops out at Claude 3.5/3.7 Sonnet, o1 and o3-mini, and the
  causal-reasoning paper is 2024–25. Only Hamilton & Mimno, the ConStory work, CFPG (GPT-4.1-mini
  / Claude-Haiku-4.5), PLOTTER (GPT-4.1 / DeepSeek R1 / Qwen3) and the 2026 diversity papers are
  on current-generation models, and **none of them names a Gemini model** — confirmed on the ones
  I opened, which is now most of them.
- **The diversity mechanism papers (Deng et al., Padmakumar & He) are not about stories** —
  **fitness product ideas** and **argumentative essays** respectively, both now confirmed from the
  papers. They are corroborating, not direct. This caveat **hardens** rather than resolves: the
  domain gap is real and the pass confirmed it.
- **Doshi & Hauser is the one citation that is still unopened.** `www.science.org` remained
  blocked on 2026-09-15 while every other paper host came back. Its claim stays
  *(search-verified)* and should not be quoted in a spec.
- **Neither Story Plan Graph nor Narrative Studio has been read** — only the survey that cites
  them. They remain pointers. The title "Narrative Studio" is not in the survey text and is
  unconfirmed (§4.2).
- **The outline-stage benchmark (arXiv:2608.26177) is a single-author August 2026 preprint.** Its
  abstract verifies verbatim and its protocol is the one §5 and §8 propose cribbing, which makes
  its thin provenance worth stating rather than burying.
- **PLOTTER's and Agents' Room's headline preferences are LLM-judge or expert-preference numbers,
  not mechanical ones**, and TTCW's finding that "none of the LLMs positively correlate with the
  expert assessments" is the reason to discount them somewhat. PLOTTER reports 0.834 Cohen's κ
  between its human raters and its LLM judge, which is the only such calibration figure in this
  survey.
- **Agents' Room's evaluation rubric is not public** in its released repo (checked directly), so
  "expert evaluators preferred it" is not a rubric we can reuse.

---

## 8. Notes for the evaluation rubric (#115, [`story-authoring-eval.md`](../agents/story-authoring-eval.md))

#115 is already closed and the rubric is written. Nothing below contradicts it; these are
additions the literature supports, offered as input to a future PR against that file rather than
applied here.

**The mechanical/judged split in §4 holds up well against the evidence.** Specifically:

- **Mechanically checkable, and the rubric already has them:** lint-clean (G0), payoff
  reachability, entry/exit state chaining, causal reachability (correctly described there as a
  "weak structural proxy"), plant-span distribution, non-empty `required_beats`. The literature
  adds no reason to doubt any of these, and PLOTTER independently endorses auditing exactly this
  kind of structural property rather than text.
- **Worth adding as mechanical, all cheap:**
  - **Arc-shape statistics** over the event list, per Tian et al. (read directly): number and
    *position* of turning points, and a valence trajectory. Their finding, in its verified sharper
    form, is that **TP4 (major setback) and TP5 (climax) occur too early** and resolve too fast,
    and that arc types collapse toward "Man in Hole" (>50% of GPT-4 stories) with negative arcs
    nearly absent (Riches to Rags: 1.3% AI vs. 14.6% human). That makes the check concrete: **a
    distribution over the positions of the last two turning points, and a histogram of arc types
    across N generated arcs** — not a per-arc gate. Pairs naturally with §4.3's fixture
    calibration. Their "over 40% improvement" from explicit discourse integration is also the
    closest published analogue to what §6 recommends doing.
  - **Cross-arc diversity**, not just per-arc quality. MoPS's Semantic Breadth / Semantic Density
    over embeddings of N generated premises or event lists gives a number where today there is
    none. Nothing in the rubric currently measures whether ten generated arcs are ten arcs.
    **Definitions verified 2026-09-15:** Breadth is "the area of embedding polygon" after t-SNE
    reduction to 2D; Density is "the standard deviation of the count sequence in the 2D histogram
    of embedding polygon," lower meaning more uniform coverage. Both are cheap over embeddings we
    would already have — but note both depend on a t-SNE projection, which is stochastic and
    parameter-sensitive, so fix the seed and perplexity before comparing runs.
  - **The lexical canary.** Flag `Elias` / `Mara` / `Elara` / lighthouse / clockmaker / librarian
    in any generated package. **The six words are verified against the paper directly
    (2026-09-15), as is the 11-word/88.3%-of-20,000-stories result** — this proposal was the one
    most exposed to a bad citation and it survives intact. A near-free mode-collapse detector, and
    the kind of thing that is embarrassing to ship and trivial to check.
  - **Mid-arc weighting.** ConStory-Bench's finding that consistency errors cluster at narrative
    midpoints argues for sampling the *middle* of a generated arc when spot-checking, rather than
    the opening and the ending.
- **Genuinely needs human or LLM-judge review — and the rubric's own list is right:** causal
  follow-through (`causes` vs `merely follows`), non-genericity, **payoff earned-ness**, thematic
  coherence, engagement. §6 raises the stakes on payoff earned-ness specifically: if `pays_off`
  becomes a generation-time constraint, that criterion is the *only* instrument that can tell a
  well-formed graph from a good one.
- **The judge-calibration warning in §4.3 is better-founded than it may have looked.** Chakrabarty,
  Laban, Agarwal, Muresan & Wu, *Art or Artifice? Large Language Models and the False Promise of
  Creativity* (CHI 2024 — [arXiv:2309.14556](https://arxiv.org/abs/2309.14556)) — **read directly,
  2026-09-15, and both load-bearing numbers are verbatim.** TTCW is "14 binary tests organized into
  the original dimensions of Fluency, Flexibility, Originality, and Elaboration," validated by
  recruiting "10 creative writers" for "a human assessment of 48 stories written either by
  professional authors or LLMs." The two results: "LLM-generated stories pass **3-10X less** TTCW
  tests than stories written by professionals," and — the important one for us — "**none of the
  LLMs positively correlate with the expert assessments**." Note the exact form of that second
  claim: not "correlate weakly," but *none positively correlate*. That is a 2023-era result on
  2023-era models and should not be read forward uncritically — but it is the strongest published
  reason to do §4.3's fixture calibration *before* believing any judged number, which the rubric
  already requires.

**Published rubrics and metrics worth citing by name, if that file is ever revised:**

| Rubric / metric | Source | Why it's worth citing |
| --- | --- | --- |
| **HANNA** — 6 orthogonal human criteria (Relevance, Coherence, Empathy, Surprise, Engagement, Complexity) over 1,056 stories from 10 ASG systems, 3 raters × 6 criteria (19,008 annotations), correlated against 72 automatic metrics — **all verified 2026-09-15** | Chhun, Colombo, Suchanek & Clavel, COLING 2022 — [ACL](https://aclanthology.org/2022.coling-1.509/), [code](https://github.com/dig-team/hanna-benchmark-asg) | The standard human-criteria set for story generation, with the correlation study attached. Our judged criteria are close cousins of four of the six; citing it gives them provenance. |
| **TTCW** — 14 binary expert tests, 10 writers, 48 stories (read directly) | Chakrabarty et al., CHI 2024 — [arXiv:2309.14556](https://arxiv.org/abs/2309.14556) | The binary-test framing is a useful alternative to 1–5 scales; the negative LLM-judge correlation is the caution. |
| **ConStory-Bench taxonomy** — 5 categories, 19 subtypes, plus ConStory-Checker | [MSR record](https://www.microsoft.com/en-us/research/publication/lost-in-stories-consistency-bugs-in-long-story-generation-by-llms/) | Off-the-shelf error subtypes if judged scores ever need to become diagnosable categories. |
| **Anchor-based outline judging**, 5-point anchored scale, outline evaluated against source independently of the writing (read directly) | [arXiv:2608.26177](https://arxiv.org/abs/2608.26177) | The only protocol I found that judges the *plan* rather than the prose — the same object #113 produces. Directly applicable to extraction fidelity, where a source text exists to anchor against. Weigh it as a single-author 2026 preprint, not a settled standard. |
| **Payoff accuracy** (and its companions: detection rate, early/late trigger counts, localization error) | CFPG, [arXiv:2601.07033](https://arxiv.org/abs/2601.07033) (read directly) | A published name for what §4.2 calls payoff earned-ness. The early/late trigger split is the more useful import: it measures whether a payoff lands *at the right moment*, which the plant-span histogram does not. |
| **Semantic Breadth / Semantic Density** (definitions verified) | MoPS, [ACL](https://aclanthology.org/2024.acl-long.117/) | Cross-arc diversity measurement, currently absent from the rubric. |

---

## Sources

Read directly (fetched and checked). Everything in this list has been opened; entries marked
**[#126]** were opened during the 2026-09-15 verification pass, the rest in the original pass:

*Papers*

- **[#126]** *Codified Foreshadowing-Payoff Text Generation* (CFPG), Yun, Zhou, Hou, Peng & Shang,
  11 Jan 2026 — <https://arxiv.org/abs/2601.07033> (full text, incl. Tables 1–2)
- **[#126]** *Finding Flawed Fictions*, Ahuja, Sclar & Tsvetkov — <https://arxiv.org/abs/2504.11900> (full text)
- **[#126]** Huang, Chen, Mishra, Zheng, Yu, Song & Zhou, *Large Language Models Cannot Self-Correct Reasoning Yet*, ICLR 2024 — <https://arxiv.org/abs/2310.01798>
- **[#126]** Yamin, Gupta, Ghosal, Lipton & Wilder, *Failure Modes of LLMs for Causal Reasoning on Narratives* — <https://arxiv.org/abs/2410.23884> (abstract v1 + v3, and results body)
- **[#126]** Tian, Huang, Liu, Jiang, Spangher, Chen, May & Peng, *Are Large Language Models Capable of Generating Human-Level Narratives?*, EMNLP 2024 — <https://aclanthology.org/2024.emnlp-main.978/> · <https://arxiv.org/abs/2407.13248> (full text)
- **[#126]** Hamilton & Mimno, *Elias in the Lighthouse, Again?* — <https://arxiv.org/abs/2605.26492>
- **[#126]** Gu, Guo, Wang, Xie & Lv, *Planning Beyond Text* (PLOTTER), Findings of ACL 2026 — <https://aclanthology.org/2026.findings-acl.1874/> · <https://arxiv.org/abs/2604.21253> (full text, incl. results tables)
- **[#126]** Song, *A Multi-Framework Comparison of Outline Stages in Long-Form Generation with LLMs* — <https://arxiv.org/abs/2608.26177>
- **[#126]** Chakrabarty, Laban, Agarwal, Muresan & Wu, *Art or Artifice?* (TTCW), CHI 2024 — <https://arxiv.org/abs/2309.14556>
- **[#126]** Chhun, Colombo, Suchanek & Clavel, *Of Human Criteria and Automatic Metrics* (HANNA), COLING 2022 — <https://aclanthology.org/2022.coling-1.509/> · <https://arxiv.org/abs/2208.11646> (criteria names and annotation counts from the repo README)
- **[#126]** Ma, Qiao & Liu, *MoPS: Modular Story Premise Synthesis*, ACL 2024 — <https://aclanthology.org/2024.acl-long.117/> · <https://arxiv.org/abs/2406.05690> (full text, for the Breadth/Density definitions)
- **[#126]** Yang, Tian, Peng & Klein, *Re3*, EMNLP 2022 — <https://arxiv.org/abs/2210.06774>
- **[#126]** Yang, Klein, Peng & Tian, *DOC*, ACL 2023 — <https://arxiv.org/abs/2212.10077>
- **[#126]** Wang, Yang, Liu & Klein, *Improving Pacing in Long-Form Story Planning* (CONCOCT), Findings of EMNLP 2023 — <https://aclanthology.org/2023.findings-emnlp.723/> · <https://arxiv.org/abs/2311.04459>
- **[#126]** Mirowski, Mathewson, Pittman & Evans, *Co-Writing Screenplays and Theatre Scripts with Language Models* (Dramatron), CHI 2023 — <https://arxiv.org/abs/2209.14958> (incl. §5.5, participant criticisms)
- **[#126]** Huot, Amplayo, Palomaki, Jakobovits, Clark & Lapata, *Agents' Room*, ICLR 2025 — <https://arxiv.org/abs/2410.02603> (full text, for the agent decomposition)
- **[#126]** Xiong, Chen, Khizbullin, Zhuge & Schmidhuber, *Beyond Outlining* (WriteHERE), EMNLP 2025 — <https://aclanthology.org/2025.emnlp-main.1254/> · <https://arxiv.org/abs/2503.08275>
- **[#126]** Deng, Brucks & Toubia, *Examining and Addressing Barriers to Diversity in LLM-Generated Ideas* — <https://arxiv.org/abs/2602.20408> (full text, for the task domain)
- **[#126]** Sui, *LLMs Exhibit Significantly Lower Uncertainty in Creative Writing Than Professional Writers* — <https://arxiv.org/abs/2602.16162>
- **[#126]** Padmakumar & He, *Does Writing with Language Models Reduce Content Diversity?*, ICLR 2024 — <https://arxiv.org/abs/2309.05196>
- **[#126]** Liu, Joshi & Dawson, *Narrative Theory-Driven LLM Methods for Automatic Story Generation and Understanding: A Survey* — <https://arxiv.org/abs/2602.15851> (used only as a pointer to Story Plan Graph and Ghaffari & Hokamp's causal-event-graph framework; **neither original has been opened**)
- *Lost in Stories: Consistency Bugs in Long Story Generation by LLMs*, Microsoft Research
  publication record — <https://www.microsoft.com/en-us/research/publication/lost-in-stories-consistency-bugs-in-long-story-generation-by-llms/> · <https://arxiv.org/abs/2603.05890>

*Author-released code and READMEs*

- DOC source repo — <https://github.com/yangkevin2/doc-story-generation>
- CONCOCT / pacing source repo — <https://github.com/YichenZW/Pacing>
- MoPS source repo — <https://github.com/GAIR-NLP/MoPS>
- Agents' Room / *Tell Me A Story* dataset repo — <https://github.com/google-deepmind/tell_me_a_story>
- HANNA benchmark repo — <https://github.com/dig-team/hanna-benchmark-asg>

Still *(search-verified)* — canonical URL given; the document itself has **not** been opened, in
either pass:

- Doshi & Hauser, *Generative AI enhances individual creativity but reduces the collective diversity of novel content*, Science Advances 10(28), 2024 — <https://www.science.org/doi/10.1126/sciadv.adn5290> (`www.science.org` was blocked by the egress proxy in both sessions)

Repo documents this builds on: [`CONTEXT.md`](../../CONTEXT.md),
[ADR 0001](../adr/0001-world-model-identity-and-tiering.md),
[ADR 0004](../adr/0004-plant-obligation-walk.md),
[ADR 0005](../adr/0005-state-update-authority.md),
[ADR 0012](../adr/0012-writer-prompt-contract.md),
[ADR 0017](../adr/0017-the-manuscript-and-publishing.md),
[`docs/agents/story-authoring-eval.md`](../agents/story-authoring-eval.md),
[`docs/research/gemini-capabilities.md`](gemini-capabilities.md),
[`docs/research/fixture-stories.md`](fixture-stories.md).
