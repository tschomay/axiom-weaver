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

This session's egress policy blocks essentially every paper host. Confirmed 403 at the proxy on
CONNECT: `arxiv.org` (including `/abs`, `/pdf`, `/html`), `aclanthology.org`, `openreview.net`,
`proceedings.iclr.cc`, `dl.acm.org`, `www.science.org`, `huggingface.co`,
`api.semanticscholar.org`, `core.ac.uk`, `researchgate.net`, `deepmind.google`, and the arXiv
mirror sites (`bytez.com`, `awesomepapers.io`, `paperswithcode.co`, `alphaxiv.org`), plus author
pages on `*.github.io`.

What that leaves, and what it means for every claim below:

1. **Fetched and read directly** — `github.com` and `raw.githubusercontent.com` (the authors' own
   released code and READMEs, which is a primary source the `research` skill explicitly favours),
   and one publisher page, Microsoft Research's own publication record. Claims resting on these
   are unmarked.
2. **Everything else is marked *(search-verified)*** — the claim came back from a web search run
   over the canonical source domain (arXiv, ACL Anthology, the publisher), but I could not open
   the document to check it. Treat the numbers as the search index's reading of the paper, not
   mine.

Two rules I applied, since the ticket asks for them explicitly:

- **No paper title, author list, venue or number appears here unless a search returned it against
  the canonical source.** Nothing is reconstructed from memory. Where I wanted a number and could
  not get one, the text says so rather than guessing.
- **Model vintage is flagged inline.** A 2022–2024 result about GPT-3, InstructGPT, OPT-175B or
  GPT-4 is evidence about those models. Where a finding is old enough that generalising it to
  `gemini-3.8-flash` is a stretch, it is called out.

Anything marked *(search-verified)* should be re-opened from an unblocked machine before it is
baked into a spec or an ADR.

---

## Headline: six findings that touch a decision already on the map

| # | Finding | Effect here |
| --- | --- | --- |
| 1 | The collapse toward generic shapes is **lexical and structural at once**, and traceable to post-training rather than pretraining: 11 words appear in 88.3% of 20,000 sampled stories across four current models *(search-verified)*. | Arc diversity is not a temperature knob. It needs structured sampling of the *seed* (§2), and it needs a cheap lexical canary in the eval loop (§8). |
| 2 | LLM arcs are measurably **flatter and earlier-peaking** than human ones: homogeneously positive, turning points earlier in the timeline, less suspense *(search-verified)*. | "Uniform beat shape" — consciously accepted as unaddressed at the Performance layer (`CONTEXT.md`) — arrives at the Fabula layer as a *measurable* defect, so it need not be accepted here. |
| 3 | LLMs reason about narrative causality by **positional shortcut** (earlier = cause), and that breaks when events are not narrated in causal order — but **extracting the causal graph and reasoning over the graph largely removes the bias and is robust to narrative length** *(search-verified)*. | This is the single strongest argument for making `pays_off` an explicit object the model emits, rather than a relation left implicit in prose ordering. It also maps exactly onto Fabula (causal order) vs. Syuzhet (told order). |
| 4 | **Plot-hole detection is the weakest measured capability in this space**: frontier models struggle regardless of reasoning effort and degrade with story length, while LLM story *generation* raises plot-hole rates 100%+ over human-written originals *(search-verified)*. | Rules out a post-hoc LLM "validation pass" as the mechanism that establishes `pays_off` validity (§6). |
| 5 | Every system that beats a prompting baseline on long-range structure does so by **moving the constraint earlier and making it symbolic** — a detailed outline, a typed premise, a causal event graph audited before realisation. | Confirms the shape of the repo's own plant-obligation walk (ADR 0004), and tells us where to spend the generation budget. |
| 6 | The only work I found aimed squarely at **Chekhov's-gun consistency** encodes foreshadow→trigger→payoff as explicit predicates supplied *ahead of* generation, and reports gains over standard prompting *(search-verified)*. | Direct prior art for `pays_off` as a generation-time constraint (§4.5, §6). |

---

## 1. LLM plot/outline generation systems, and what they actually measured

Ordered oldest to newest. The point of the column "what it measured" is that almost nobody
measures the *outline* — they measure the prose that came out of it, which is the wrong object
for us, since #113's deliverable stops at a `DraftStoryPackageSchema` JSON object.

| System | Venue | Shape | What it measured |
| --- | --- | --- | --- |
| **Re3** (Yang, Tian, Peng, Klein) | EMNLP 2022 — [ACL Anthology](https://aclanthology.org/2022.emnlp-main.296/), [arXiv:2210.06774](https://arxiv.org/abs/2210.06774) | Plan → Draft → Rewrite → Edit. A structured plan (setting, character inventory, three-point outline), then passages generated by re-injecting plan + story state, reranked for plot coherence and premise relevance, then edited for factual consistency. | Human judgements of >2000-word stories: **+14% absolute** on "coherent overarching plot", **+20%** on premise relevance, vs. a rolling-window baseline *(search-verified)*. GPT-3-era. |
| **DOC** (Yang, Klein, Peng, Tian) | ACL 2023 — [arXiv:2212.10077](https://arxiv.org/abs/2212.10077), [code](https://github.com/yangkevin2/doc-story-generation) | Keeps Re3's plan/draft/revise skeleton; adds a **detailed outliner** (deep hierarchical outline, with an outline-order reranker) and a **detailed controller** (FUDGE-style token-level logit steering toward the current outline item). Explicitly "shifts creative burden from the main drafting procedure to the planning stage." | Human eval on ~3.5k-word stories: **+22.5% absolute plot coherence, +28.2% outline relevance, +20.7% interestingness** over Re3 *(search-verified; the README I read directly confirms the system description and the "substantially improved coherence, relevance and interest" claim)*. Backbone: GPT-3 + OPT-175B. |
| **CONCOCT** (Wang, Yang, Liu, Klein) | Findings of EMNLP 2023 — [ACL Anthology](https://aclanthology.org/2023.findings-emnlp.723/), [code](https://github.com/YichenZW/Pacing) | Pacing control for hierarchical outlines: a trained **concreteness evaluator** (which of two events is more low-level-detailed), driving a **vaguest-first expansion** that expands the least concrete outline item next, plus concreteness filtering of new items. | Humans judged its pacing more consistent **over 57% of the time** across outline lengths; gains "translate to downstream stories" (README, read directly). |
| **Dramatron** (Mirowski, Mathewson, et al.) | CHI 2023 — [arXiv:2209.14958](https://arxiv.org/abs/2209.14958), [DOI](https://dl.acm.org/doi/10.1145/3544548.3581225) | Hierarchical prompt chaining from a **log line**: title → characters → beats → location descriptions → dialogue. Can reach tens of thousands of words. | 15 theatre/film professionals co-wrote and were interviewed. Praise for hierarchical generation letting the writer work the arc; **criticism was logical gaps, lack of common sense/nuance/subtext, and specifically lack of character motivation** *(search-verified)*. Chinchilla-era; the qualitative failure list is the durable part. |
| **MoPS** (GAIR-NLP) | ACL 2024 — [ACL Anthology](https://aclanthology.org/2024.acl-long.117/), [code](https://github.com/GAIR-NLP/MoPS) | Premise synthesis by **sampling a typed module path first**, then asking the model to fuse it into a sentence. Modules: theme, background (time/place), persona (growth/conflict/collaboration), plot (event/ending/twist). | Diversity via **Semantic Breadth** and **Semantic Density**; quality via LLM judge on **Fascination / Completeness / Originality**. Claims premises beat both LLM-induced and dataset-captured premises on all four *(search-verified — the README I read confirms the module decomposition and metric names but carries no numbers)*. |
| **Agents' Room** (Google DeepMind) | ICLR 2025 — [arXiv:2410.02603](https://arxiv.org/abs/2410.02603), [dataset](https://github.com/google-deepmind/tell_me_a_story) | Narrative-theory-derived decomposition into **planning agents** and **writing agents** (a writing agent can specialise in one part of the arc, e.g. exposition or climax) with a central orchestrator consolidating into a shared scratchpad. | Introduced the *Tell Me A Story* dataset (prompts + human-written stories) and an evaluation framework for long narratives; expert evaluators preferred its stories over baselines *(search-verified)*. **The released repo does not publish the rubric** — I checked; the README has the dataset and nothing on criteria. |
| **WriteHERE** ("Beyond Outlining") | EMNLP 2025 — [ACL Anthology](https://aclanthology.org/2025.emnlp-main.1254/), [arXiv:2503.08275](https://arxiv.org/abs/2503.08275) | The counterpoint. Argues fixed outline-then-write workflows are "rigid thinking patterns" that constrain adaptability, and instead **interleaves recursive task decomposition with execution** over three task types (retrieval, reasoning, composition). | Reports beating SOTA on all automatic metrics for fiction and technical reports *(search-verified)*. No human eval verified. |
| **PLOTTER** (Gu, Guo, Wang, Xie, Lv) | Findings of ACL 2026 — [ACL Anthology](https://aclanthology.org/2026.findings-acl.1874/), [arXiv:2604.21253](https://arxiv.org/abs/2604.21253) | Plans on **graphs, not text**: an event graph and a character graph, run through an **Evaluate–Plan–Revise** cycle that diagnoses and repairs graph topology under logical constraints **before any full text is generated**. Repairs are atomic graph edits (add / delete / re-link node or edge); a multi-agent critique module "audits symbolic structures rather than raw text"; a Constrained Graph Editor applies the edits. | "Significantly outperforms representative baselines across diverse narrative scenarios" *(search-verified)*. I could not verify the metrics or the margin. |
| **Outline-stage benchmark** (arXiv:2608.26177) | Aug 2026 — [arXiv:2608.26177](https://arxiv.org/abs/2608.26177) | Not a system: a head-to-head of **7 long-form frameworks × 3 granularities** (single-chapter, multi-chapter, whole-book) that evaluates **the outline itself**, via an anchor-based LLM-as-judge protocol scoring outlines against source text on a 5-point anchored scale. | Headline: across 21 cells **no framework dominates** — performance depends on the match between a framework's intrinsic output form and the target granularity. Also reports **length collapse at 16k-token outputs even at 70B**, and "lost-in-the-middle" attribute drift in multi-chapter stories *(search-verified)*. |

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

**Arc shape specifically.** Tian et al., *Are Large Language Models Capable of Generating
Human-Level Narratives?* (EMNLP 2024 —
[ACL Anthology](https://aclanthology.org/2024.emnlp-main.978/),
[arXiv:2407.13248](https://arxiv.org/abs/2407.13248)) build a computational framework over three
discourse-level aspects — **story arcs, turning points, and affective dimensions (arousal and
valence)** — and report that human stories are suspenseful, arousing and structurally diverse
while LLM stories are **homogeneously positive and lack tension**: happier and less complex arcs,
**turning points introduced earlier in the timeline**, fewer setbacks. They also report that a
**discourse-aware generation process that reasons explicitly about story arc or turning points
improves suspense, emotion and diversity** *(search-verified)*. GPT-4-era models.

**Lexical evidence of the same collapse.** Hamilton & Mimno (Cornell), *Elias in the Lighthouse,
Again? Diagnosing Low Diversity in LLM Stories*
([arXiv:2605.26492](https://arxiv.org/abs/2605.26492)) sample **20,000 stories from four current
models across five prompts** and find **11 words occurring in 88.3% of them**, with little
difference between models — names (Elias, Mara, Elara), settings (lighthouses), professions
(clockmaker, librarian). Their diagnosis is the useful bit: these tokens are *not* especially
frequent in published literature or pretraining data, but do appear in **preference data**,
which they read as a small alignment dataset having outsized effect *(search-verified)*.

**Diversity loss as a population effect.** Doshi & Hauser, *Generative AI enhances individual
creativity but reduces the collective diversity of novel content* (Science Advances 10(28), 12
July 2024 — [DOI](https://www.science.org/doi/10.1126/sciadv.adn5290)): writers given LLM story
ideas produced stories rated more creative, better written and more enjoyable — especially the
less creative writers — but **more similar to each other**, and the boost did not extend to the
more creative writers *(search-verified)*. Padmakumar & He, *Does Writing with Language Models
Reduce Content Diversity?* (ICLR 2024 — [arXiv:2309.05196](https://arxiv.org/abs/2309.05196))
find the reduction is attributable to the **feedback-tuned** model (InstructGPT) and not the base
model (GPT-3) *(search-verified)* — note this study is on argumentative essays, not stories, so
it is corroborating rather than direct evidence.

**Why, mechanistically.** Two 2026 papers name mechanisms rather than just the symptom:

- Sui, *LLMs Exhibit Significantly Lower Uncertainty in Creative Writing Than Professional
  Writers* ([arXiv:2602.16162](https://arxiv.org/abs/2602.16162)): an information-theoretic
  analysis over **28 LLMs**, finding human writing consistently higher-uncertainty, with
  **instruction-tuned and reasoning models worse than their base counterparts**, and the gap
  larger in creative than functional domains *(search-verified)*.
- Deng, Brucks & Toubia, *Examining and Addressing Barriers to Diversity in LLM-Generated Ideas*
  ([arXiv:2602.20408](https://arxiv.org/abs/2602.20408)): two separable mechanisms —
  **individual-level fixation** (early outputs constrain later ideation, as in humans) and
  **collective-level knowledge aggregation** (one unified distribution rather than the knowledge
  partitioning a human population has). Their interventions are separable too: chain-of-thought
  reduces fixation; **ordinary personas** restore partitioning; the two combined beat humans on
  diversity *(search-verified)*. Domain is product ideas, not stories.

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
Causal Reasoning on Narratives* ([arXiv:2410.23884](https://arxiv.org/abs/2410.23884)) reports
that LLMs decide causality largely from **topological ordering — earlier narrated event treated
as cause** — so accuracy falls sharply when narratives are told out of causal order; that they
lean on **parametric knowledge** at the expense of the narrative in front of them, degrading when
the narrative contradicts that prior; and that they **struggle as narratives get long and
event-dense**. Crucially: *"asking the model to extract the entire causal graph from the
narrative, and then directly using that graph for reasoning largely overcomes both biases and is
robust to increased narrative length"* *(search-verified)*.

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
Reasoning in Language Models via Plot Hole Detection*
([arXiv:2504.11900](https://arxiv.org/abs/2504.11900)) synthesises plot holes into human-written
stories (FlawedFictionsMaker) to build a contamination-robust benchmark: **414 stories averaging
731 words**, plus a 200-example extension at 1,200–4,000 words. Reported: SOTA LLMs **struggle
regardless of the reasoning effort allowed**, with performance **degrading significantly as story
length increases**; and LLM summarization and generation **introduce** plot holes, at **50%+ and
100%+ increases** in detection rate relative to human-written originals *(search-verified)*. A
search summary also characterised frontier-model accuracy as near-random; I could not open the
paper to check that specific characterisation, so treat it as unverified — the directional claim
(poor, and worse with length) is what multiple summaries agree on.

**Length collapse at the generation end.** The outline-stage benchmark reports **length collapse
at 16k-token outputs even for 70B models**, and "lost-in-the-middle" attribute drift in
multi-chapter settings *(search-verified)*.

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
> - **Detection is the weak link, not generation.** A generated arc's defects are cheaper to
>   prevent than to find. This is the load-bearing fact for §6.

---

## 4. Constraint mechanisms in the wild — and what I would actually crib

### 4.1 Outline-then-expand / hierarchical generation

Re3 → DOC → CONCOCT is one lineage, and its trajectory is instructive: each step moved *more*
work into the plan. DOC's stated thesis is shifting creative burden from drafting to planning,
and it bought +22.5% absolute plot coherence over Re3 for doing so *(search-verified)*. CONCOCT
then showed the *expansion order* inside the outline matters independently: expanding the
**vaguest item next** produced more consistent pacing 57%+ of the time.

**Crib:** the vaguest-first idea, as a procedural rule for how an arc generator elaborates. If
we ever expand a generated arc from a premise through intermediate levels rather than in one
pass, expanding the least-specified region next is a cheap, validated heuristic that directly
targets the "everything happens in act three" pathology.

**Don't crib:** DOC's detailed controller. It is FUDGE-style token-level logit steering against a
local model; we call a hosted Gemini endpoint with a response schema
([`gemini-capabilities.md`](gemini-capabilities.md)) and have no logit access. Our equivalent of
"the outline is respected during generation" is the response schema itself plus the linter.

### 4.2 Explicit causal / event-graph scaffolding

**PLOTTER** is the closest thing in the literature to what ADR 0004 already does, arrived at from
the other direction. It plans on an event graph and a character graph; runs **Evaluate–Plan–Revise
over the graph topology under logical constraints, before textual realisation**; decomposes
repair into **atomic graph edits** (add / delete / re-link); and has critique agents that **audit
the symbolic structure rather than the raw text**, with a Constrained Graph Editor applying the
edits *(search-verified)*.

Adjacent, from the 2026 narrative-theory survey ([arXiv:2602.15851](https://arxiv.org/abs/2602.15851),
Liu, Joshi & Dawson) *(search-verified)*: Yoo & Cheong's **Story Plan Graph** (build a branching
graph of possible events, then have the LLM select and traverse a single coherent path before
prose), and Ghaffari & Hokamp's **Narrative Studio** (dynamic causal event graph explored with
Monte Carlo Tree Search). I could not open either original and am naming them only as pointers.

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

The caution is well-evidenced and it is the important half of this subsection. Huang et al.,
*Large Language Models Cannot Self-Correct Reasoning Yet* (ICLR 2024 —
[arXiv:2310.01798](https://arxiv.org/abs/2310.01798)) find that **without external feedback,
LLMs struggle to self-correct and performance sometimes degrades after self-correction**, and
that where valid external feedback exists it should be used *(search-verified)*. Put that next to
§3's plot-hole result — detection is bad and gets worse with length — and a "model re-reads its
own arc and fixes the problems" loop is the least reliable component you could build.

**Crib:** critique loops, but only ones whose feedback signal is **external and mechanical**. We
have exactly such a signal already: `lintPackage`'s five plant-walk error codes
(`plant_scene_unknown`, `plant_after_payoff`, `plant_not_declared`, `unfounded_seed_payoff`, plus
`unknown_entity`) and the `unpaid_fact` warning. A loop of *generate → lint → repair the named
error → re-lint* is external feedback in Huang et al.'s sense. A loop of *generate → "find the
problems with this arc" → revise* is not.

### 4.4 Plan-then-write agents

**Dramatron** and **Agents' Room** are the two to know. Dramatron's professional-user study is
worth more to us than its architecture: the complaints were **logical gaps, missing common sense,
missing nuance and subtext, and specifically absent character motivation** *(search-verified)*.
Note what that list is — every item is a Fabula/Syuzhet defect, not a prose defect. Agents' Room's
contribution is decomposition by **narrative function** (a writing agent specialising in the
exposition, another in the climax) with an orchestrator and a shared scratchpad
*(search-verified)*.

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
([arXiv:2601.07033](https://arxiv.org/abs/2601.07033), January 2026) *(search-verified — I could
not open it; every claim in this paragraph is the search index's reading)*. Its framing: authors
introduce commitments early and resolve them later, LLMs "frequently fail to bridge these
long-range narrative dependencies, often leaving *Chekhov's guns* unfired even when the necessary
context is present," and existing evaluation "largely overlooks this structural failure, focusing
on surface-level coherence rather than the logical fulfillment of narrative setups." Its method,
**CFPG**, mines **Foreshadow–Trigger–Payoff triples** from the BookSum corpus and encodes them as
**executable causal predicates** supplied as structured supervision, so that a commitment is "not
only mentioned but also temporally and logically fulfilled." It reports gains over standard
prompting on **payoff accuracy** and **narrative alignment**, across models including
GPT-4.1-mini and Claude-Haiku-4.5. I could not verify a single number and am not quoting one.

Three things I would take from it even at this confidence level:

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
| Judge the **outline**, not the prose, on an anchored scale | Outline-stage benchmark, [arXiv:2608.26177](https://arxiv.org/abs/2608.26177) | Already the shape of `story-authoring-eval.md` §4. Adopt anchored 5-point scales for its 1–5 criteria so scores are comparable across tickets. |
| Vaguest-first expansion | CONCOCT, [ACL](https://aclanthology.org/2023.findings-emnlp.723/) | If arc generation ever becomes multi-pass, elaborate the least-specified region next. |
| Plan on an explicit graph; audit the graph, not the text; repair by atomic edit | PLOTTER, [ACL](https://aclanthology.org/2026.findings-acl.1874/) | Confirms ADR 0004's walk-before-generation posture; gives the repair loop its shape (§6). |
| Extract/emit the causal graph because the model reasons better over it | [arXiv:2410.23884](https://arxiv.org/abs/2410.23884) | `pays_off` as a first-class emitted field, not a relation inferred from event order (§6). |
| Critique loops only with **external** feedback | Huang et al., [arXiv:2310.01798](https://arxiv.org/abs/2310.01798) | The repair loop's oracle is `lintPackage`, never the model's own re-reading. |
| Typed module sampling for premise diversity | MoPS, [ACL](https://aclanthology.org/2024.acl-long.117/) | Vary the World Model seed / premise structurally across runs, not by temperature. |
| Personas + CoT as separable diversity interventions | [arXiv:2602.20408](https://arxiv.org/abs/2602.20408) | Cheap A/B for the arc-generation prototype (#120) if diversity measures badly. |
| Arc / turning-point / valence-arousal analysis as a diversity metric | Tian et al., [ACL](https://aclanthology.org/2024.emnlp-main.978/) | A computable aggregate check over a generated event list (§8). |
| Consistency-error taxonomy (5 categories / 19 subtypes) | ConStory-Bench, [MSR](https://www.microsoft.com/en-us/research/publication/lost-in-stories-consistency-bugs-in-long-story-generation-by-llms/) | A ready-made vocabulary if #115's judged criteria ever need error *subtypes* rather than scores. |
| "Payoff accuracy" as a named metric; foreshadow→**trigger**→payoff as the unit | CFPG, [arXiv:2601.07033](https://arxiv.org/abs/2601.07033) | Names the gap between a *valid* `pays_off` graph and an *earned* one (§8). |

---

## 6. Recommendation: `pays_off` is a generation-time constraint, validated mechanically

**Recommendation: interleaved.** The arc generator should emit the event list and its `pays_off`
edges **in the same structured pass**, with each payoff naming its plant as it is written. A
validation pass still runs — it is `lintPackage` and ADR 0004's walk, unchanged — but its job is
to **reject and drive repair, never to author a link**.

Concretely, the three candidate shapes and why two lose:

**(a) Graph strictly first — reject.** A `pays_off` entry is `{fact_ref, plant: scene_id | null}`
(ADR 0004 decision 1). Both halves reference things that do not exist until the events do: a
`fact_ref` has to be a fact of *this* world, and `plant` is a Scene Card id. Generating the
dependency graph before the events means inventing an abstract skeleton of commitments and then
retrofitting a world onto it. Deng et al.'s **fixation** finding makes the cost concrete: early
output constrains later ideation, so whatever is generated first dominates. Letting an abstract
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
2. **It puts the weakest measured capability in the critical path.** Post-hoc detection of
   structural narrative defects is what *Finding Flawed Fictions* measures, and frontier models
   do it badly, worse as length grows, and are themselves a **100%+ source** of new plot holes
   when generating *(search-verified)*. Designing around "the model will notice the missing
   setup on a second read" is designing around the one thing the literature says it cannot do.
3. **It is intrinsic self-correction.** Huang et al.: without external feedback, self-correction
   does not reliably help and sometimes hurts. A linking pass over the model's own draft has no
   external signal — the draft is the only evidence, and the model wrote it.

**(c) Interleaved, graph-explicit, mechanically validated — adopt.** The positive case:

- It is what the **only setup/payoff-specific work** does: CFPG supplies foreshadow/payoff
  commitments as explicit predicates *ahead of* realisation and reports better payoff accuracy
  than prompting the model to just write well *(search-verified)*.
- It is what the **graph-planning** work does: PLOTTER optimises the causal skeleton *before*
  textual realisation, and audits the symbolic structure rather than the text.
- It is what the **causal-reasoning** result predicts: reasoning over an explicitly extracted
  causal graph "largely overcomes" the positional-shortcut bias **and is robust to length**.
  Our model is going to have to hold reveal order apart from causal order — that is what the
  World Model / Discourse Record split *is* — and the positional shortcut is precisely the
  failure that emitting the graph fixes.
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

- **No beat-count threshold exists in anything I could verify.** "Causal coherence survives N
  beats" is not a claim the literature supports in that form (§3).
- **CFPG is one paper, unopened, three months old at the time of writing, and carries the entire
  weight of "setup/payoff specifically."** If §6's recommendation has a single point of citation
  failure, it is this one. The recommendation does not actually depend on it — the causal-graph
  and self-correction results carry it alone — but the *positive* case for generation-time
  predicates is thinner than it looks in §4.5.
- **PLOTTER's margins are unverified.** I have its architecture (from search summaries that agree
  with each other) and none of its numbers.
- **Nothing here is measured on `gemini-3.8-flash` or any Gemini model.** Re3/DOC/CONCOCT are
  GPT-3/OPT-175B-era; Dramatron is Chinchilla-era; Tian et al. and TTCW are GPT-4-era. Only
  Hamilton & Mimno, the ConStory work, CFPG and the 2026 diversity papers are on models of the
  current generation, and none of them name a Gemini model in anything I could read.
- **The diversity mechanism papers (Deng et al., Padmakumar & He) are not about stories** —
  product ideas and argumentative essays respectively. They are corroborating, not direct.
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
  - **Arc-shape statistics** over the event list, per Tian et al.: number and *position* of
    turning points, and a valence trajectory. Their finding is that LLM arcs are homogeneously
    positive with turning points too early — which is a distribution check over several generated
    arcs, not a per-arc gate, and pairs naturally with §4.3's fixture-calibration idea.
  - **Cross-arc diversity**, not just per-arc quality. MoPS's Semantic Breadth / Semantic Density
    over embeddings of N generated premises or event lists gives a number where today there is
    none. Nothing in the rubric currently measures whether ten generated arcs are ten arcs.
  - **The lexical canary.** Flag `Elias` / `Mara` / `Elara` / lighthouse / clockmaker / librarian
    in any generated package. Hamilton & Mimno's 11-word/88.3% result makes this a near-free mode
    collapse detector, and it is the kind of thing that is embarrassing to ship and trivial to
    check.
  - **Mid-arc weighting.** ConStory-Bench's finding that consistency errors cluster at narrative
    midpoints argues for sampling the *middle* of a generated arc when spot-checking, rather than
    the opening and the ending.
- **Genuinely needs human or LLM-judge review — and the rubric's own list is right:** causal
  follow-through (`causes` vs `merely follows`), non-genericity, **payoff earned-ness**, thematic
  coherence, engagement. §6 raises the stakes on payoff earned-ness specifically: if `pays_off`
  becomes a generation-time constraint, that criterion is the *only* instrument that can tell a
  well-formed graph from a good one.
- **The judge-calibration warning in §4.3 is better-founded than it may have looked.** Chakrabarty
  et al., *Art or Artifice? Large Language Models and the False Promise of Creativity* (CHI 2024
  — [arXiv:2309.14556](https://arxiv.org/abs/2309.14556)) introduce the **Torrance Test of
  Creative Writing (TTCW)**: 14 binary tests over Fluency, Flexibility, Originality, Elaboration,
  validated with 10 expert creative writers on 48 stories. Two results matter here: LLM stories
  passed **3–10× fewer** TTCW tests than professional stories, and **none of the LLMs evaluated as
  assessors positively correlated with the expert assessments** *(search-verified)*. That is a
  2023-era result on 2023-era models and should not be read forward uncritically — but it is the
  strongest published reason to do §4.3's fixture calibration *before* believing any judged
  number, which the rubric already requires.

**Published rubrics and metrics worth citing by name, if that file is ever revised:**

| Rubric / metric | Source | Why it's worth citing |
| --- | --- | --- |
| **HANNA** — 6 orthogonal human criteria (Relevance, Coherence, Empathy, Surprise, Engagement, Complexity) over 1,056 stories, 3 raters each (19,008 annotations), correlated against 72 automatic metrics | Chhun et al., COLING 2022 — [ACL](https://aclanthology.org/2022.coling-1.509/), [code](https://github.com/dig-team/hanna-benchmark-asg) | The standard human-criteria set for story generation, with the correlation study attached. Our judged criteria are close cousins of four of the six; citing it gives them provenance. |
| **TTCW** — 14 binary expert tests | Chakrabarty et al., CHI 2024 — [arXiv:2309.14556](https://arxiv.org/abs/2309.14556) | The binary-test framing is a useful alternative to 1–5 scales; the negative LLM-judge correlation is the caution. |
| **ConStory-Bench taxonomy** — 5 categories, 19 subtypes, plus ConStory-Checker | [MSR record](https://www.microsoft.com/en-us/research/publication/lost-in-stories-consistency-bugs-in-long-story-generation-by-llms/) | Off-the-shelf error subtypes if judged scores ever need to become diagnosable categories. |
| **Anchor-based outline judging**, 5-point anchored scale, outline evaluated against source independently of the writing | [arXiv:2608.26177](https://arxiv.org/abs/2608.26177) | The only protocol I found that judges the *plan* rather than the prose — the same object #113 produces. Directly applicable to extraction fidelity, where a source text exists to anchor against. |
| **Payoff accuracy** | CFPG, [arXiv:2601.07033](https://arxiv.org/abs/2601.07033) | A published name for what §4.2 calls payoff earned-ness. |
| **Semantic Breadth / Semantic Density** | MoPS, [ACL](https://aclanthology.org/2024.acl-long.117/) | Cross-arc diversity measurement, currently absent from the rubric. |

---

## Sources

Read directly (fetched and checked):

- DOC source repo — <https://github.com/yangkevin2/doc-story-generation>
- CONCOCT / pacing source repo — <https://github.com/YichenZW/Pacing>
- MoPS source repo — <https://github.com/GAIR-NLP/MoPS>
- Agents' Room / *Tell Me A Story* dataset repo — <https://github.com/google-deepmind/tell_me_a_story>
- *Lost in Stories: Consistency Bugs in Long Story Generation by LLMs*, Microsoft Research
  publication record — <https://www.microsoft.com/en-us/research/publication/lost-in-stories-consistency-bugs-in-long-story-generation-by-llms/>

*(search-verified)* — canonical URL given; the document itself could not be opened from this
session (see the sources note at the top):

- Re3 — <https://aclanthology.org/2022.emnlp-main.296/> · <https://arxiv.org/abs/2210.06774>
- DOC — <https://arxiv.org/abs/2212.10077>
- CONCOCT, *Improving Pacing in Long-Form Story Planning* — <https://aclanthology.org/2023.findings-emnlp.723/> · <https://arxiv.org/abs/2311.04459>
- Dramatron, *Co-Writing Screenplays and Theatre Scripts with Language Models* — <https://arxiv.org/abs/2209.14958> · <https://dl.acm.org/doi/10.1145/3544548.3581225>
- MoPS — <https://aclanthology.org/2024.acl-long.117/> · <https://arxiv.org/abs/2406.05690>
- Agents' Room — <https://arxiv.org/abs/2410.02603>
- WriteHERE, *Beyond Outlining* — <https://aclanthology.org/2025.emnlp-main.1254/> · <https://arxiv.org/abs/2503.08275>
- PLOTTER, *Planning Beyond Text* — <https://aclanthology.org/2026.findings-acl.1874/> · <https://arxiv.org/abs/2604.21253>
- *A Multi-Framework Comparison of Outline Stages in Long-Form Generation with LLMs* — <https://arxiv.org/abs/2608.26177>
- Tian et al., *Are Large Language Models Capable of Generating Human-Level Narratives?* — <https://aclanthology.org/2024.emnlp-main.978/> · <https://arxiv.org/abs/2407.13248>
- Hamilton & Mimno, *Elias in the Lighthouse, Again?* — <https://arxiv.org/abs/2605.26492>
- Doshi & Hauser, *Generative AI enhances individual creativity but reduces the collective diversity of novel content*, Science Advances 10(28), 2024 — <https://www.science.org/doi/10.1126/sciadv.adn5290>
- Padmakumar & He, *Does Writing with Language Models Reduce Content Diversity?* — <https://arxiv.org/abs/2309.05196>
- Sui, *LLMs Exhibit Significantly Lower Uncertainty in Creative Writing Than Professional Writers* — <https://arxiv.org/abs/2602.16162>
- Deng, Brucks & Toubia, *Examining and Addressing Barriers to Diversity in LLM-Generated Ideas* — <https://arxiv.org/abs/2602.20408>
- *Failure Modes of LLMs for Causal Reasoning on Narratives* — <https://arxiv.org/abs/2410.23884>
- *Finding Flawed Fictions: Evaluating Complex Reasoning in Language Models via Plot Hole Detection* — <https://arxiv.org/abs/2504.11900>
- *Lost in Stories / ConStory-Bench* — <https://arxiv.org/abs/2603.05890>
- Huang et al., *Large Language Models Cannot Self-Correct Reasoning Yet*, ICLR 2024 — <https://arxiv.org/abs/2310.01798>
- *Codified Foreshadowing-Payoff Text Generation* — <https://arxiv.org/abs/2601.07033>
- Chhun et al., *Of Human Criteria and Automatic Metrics: A Benchmark of the Evaluation of Story Generation*, COLING 2022 — <https://aclanthology.org/2022.coling-1.509/> · <https://github.com/dig-team/hanna-benchmark-asg>
- Chakrabarty et al., *Art or Artifice? Large Language Models and the False Promise of Creativity*, CHI 2024 — <https://arxiv.org/abs/2309.14556>
- Liu, Joshi & Dawson, *Narrative Theory-Driven LLM Methods for Automatic Story Generation and Understanding: A Survey* — <https://arxiv.org/abs/2602.15851> (used only as a pointer to Story Plan Graph and Narrative Studio, neither of which I could open)

Repo documents this builds on: [`CONTEXT.md`](../../CONTEXT.md),
[ADR 0001](../adr/0001-world-model-identity-and-tiering.md),
[ADR 0004](../adr/0004-plant-obligation-walk.md),
[ADR 0005](../adr/0005-state-update-authority.md),
[ADR 0012](../adr/0012-writer-prompt-contract.md),
[ADR 0017](../adr/0017-the-manuscript-and-publishing.md),
[`docs/agents/story-authoring-eval.md`](../agents/story-authoring-eval.md),
[`docs/research/gemini-capabilities.md`](gemini-capabilities.md),
[`docs/research/fixture-stories.md`](fixture-stories.md).
