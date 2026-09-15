# Prior art on narrative extraction (prose → structured Fabula/Syuzhet)

Research for [#114](https://github.com/tschomay/axiom-weaver/issues/114) (part of
[#113](https://github.com/tschomay/axiom-weaver/issues/113)). Answered **2026-09-15**.

Terms are from [`CONTEXT.md`](../../CONTEXT.md): Fabula, Syuzhet, Performance, World Model,
Scene Card, Scene Digest, told-ledger, plant/payoff, `required_beats`,
`reader_must_learn`/`must_stay_hidden`, state-update tiers (P/E/V).

---

## Note on sources (read this before trusting a number)

**This document has been through a verification pass. Status as of 2026-09-15.**

When this survey was first written, the session's egress policy blocked nearly every academic
host — `arxiv.org`, `aclanthology.org`, `ceur-ws.org`, `openreview.net`, `link.springer.com`,
`dl.acm.org`, `direct.mit.edu`, `huggingface.co`, `semanticscholar.org`, `ojs.aaai.org`, every
university host tried, and the commercial vendor docs. Only `github.com`,
`raw.githubusercontent.com` and `www.microsoft.com/research` were reachable, so most claims
carried a `[search-verified]` tag meaning *nobody opened the cited source*.

**Those hosts are now reachable**, and [#126](https://github.com/tschomay/axiom-weaver/issues/126)
commissioned a re-verification pass over this document. That pass ran on **2026-09-15** and worked
through the ticket's priority order. What the two tags mean is unchanged and still strictly
enforced:

- **[fetched]** — the cited source was opened and read directly. Do not apply this tag to anything
  you have not opened.
- **[search-verified]** — the claim still rests on a search-engine extract of the cited source.
  Still needs a confirming read before it goes into a spec.

### What the 2026-09-15 pass changed

**Three claims were wrong and are corrected in place, each marked where it sits:**

1. **§2.2 — BookCoref's "20+ CoNLL-F1".** This document said long-document systems *lose* 20+
   CoNLL-F1 on full books, citing the ACL abstract. The abstract says the reverse: the resource
   "enables current long-document coreference systems to **gain** up to +20 CoNLL-F1 points". The
   sign was read backwards. A comparable full-book penalty is real but lives in the paper's
   Table 3, not the abstract — see §2.2 for the corrected numbers.
2. **§1.1 — DramaBank's annotation cost.** "Roughly 45 minutes of annotator time per story" is
   wrong; the paper reports a **median of 1.25 hours** per encoding. The corrected figure
   strengthens the argument it supports.
3. **§4.6 — the foreshadow type taxonomy.** Reported here as a three-way object/event/rule split;
   it is **five-way** (object 48.2 / event 35.3 / speech-act 9.7 / rule 5.1 / symbol 1.7).

**Both previously-flagged unverifiable claims are now resolved:**

- The **"BERT baseline F1 ≈ 24%"** scene-segmentation figure (§3.1), previously marked do-not-quote,
  is confirmed — it is in **Zehe et al. (EACL 2021)'s own abstract**, and this document had simply
  been looking for it in the wrong paper. It is now quotable, attributed to Zehe et al. 2021.
- **R²'s "headline accuracy numbers"** (§2.5), dropped because they came only from a third-party
  summary, are resolved by elimination: the paper reports pairwise **win-rate** margins, not
  accuracy. There is no accuracy number to promote, and the third-party summary mislabelled what
  it saw. See §2.5.

**One material qualification was added** (§2.2, with a knock-on in §8): BookCoref's own Appendix G
finds that traditional coreference metrics are "biased towards lower performances when evaluating
full-book predictions", so the MUC-vs-B³ divergence is weaker evidence of entity over-merging than
this document originally asserted. §8's divergence check is downgraded from a diagnostic to a
screening signal accordingly. A second qualification sits in §2.3: GraphRAG's paper does lack
entity disambiguation as claimed, but it offers a defence — duplicates get clustered together
downstream — that is specific to retrieval indices and does not transfer to a slug-id World Model.

**§10's multi-pass recommendation was re-checked against its named dependencies and stands.** Its
long-context evidence (NoCha, *Same Task More Tokens*, *Lost in the Middle*) verified cleanly, and
*Same Task, More Tokens* turned out to be sharper than reported here: degradation begins at
**3,000 tokens**. See the verification note at the head of §10.

### What remains unverified

- **Piper et al., "Modeling Narrative Revelation"** (§4.1) — the host is reachable but the PDF has
  no extractable text layer. Still `[search-verified]`.
- **ISNotes as "50 WSJ documents"** (§4.3) — not found in the paper cited for it.
- **§4.6's dependency-length figures are summary-sentence distances**, not prose-sentence
  distances, because the corpus is BookSum summaries. The numbers are right; the unit was implied
  wrongly. See §4.6.
- Everything still carrying a `[search-verified]` tag below, which the pass did not reach:
  Finlayson (§1.1), the two field surveys (§1.2), Story Ribbons' VIS-paper description (§1.3),
  ProPara (§2.4), the Novelcrafter vendor claims (§2.4), the "hallucinated relations"
  general-literature claim (§2.5), the STSS shared-task overview (§3.1), Indexter (§4.2), spoiler
  detection (§4.4), OpenToM (§4.5), and **all four commercial vendor rows** in §6. The vendor docs
  are reachable now and [#114](https://github.com/tschomay/axiom-weaver/issues/114)'s request for a
  "story bible" survey is still unmet; **that is the largest remaining gap in this document** and
  the obvious next piece of work.

For the record, the pass *did* reach and confirm, beyond the priority items: Chambers & Jurafsky
(§1.2), NEAT (§1.2), Re3 / Dramatron / NexusSum / Recursively Summarizing Books (§1.3), LitBank's
entity-layer paper (§2.1), Luo 2005 (§2.2), GraphRAG's *From Local to Global* (§2.3), R² (§2.5),
Zehe et al. 2021 and 2025 (§3.1), Guhr et al. (§3.1), Chapter Captor (§3.2), Papalampidi et al.
(§3.3), Hou 2020 (§4.3) and FANToM (§4.5). `dl.acm.org` is still 403 and was routed around via
arXiv.

Where a claim rested only on a secondary summary of a paper, it is either dropped or explicitly
flagged as **unverified** below — no paper title, author list or result in this document is
reconstructed from memory.

---

## Headline: seven findings that touch decisions already on the map

| # | Finding | Effect on #113's extraction path |
| --- | --- | --- |
| 1 | **Nobody produces our output object.** Three research traditions exist (hand-annotation, ML narratology, LLM pipelines) and none of them emits anything shaped like a Story Package: World Model rows + ordered Scene Cards + a plant/payoff graph. The closest systems each solve one of our three passes. | Assume assembly is ours. Crib per-pass, not end-to-end. |
| 2 | **Book-scale coreference is the hard wall, and it fails in a specific, diagnosable direction.** On `BookCoref` a system can score MUC F1 **94.30** while B³ is **55.30** and CEAFe **33.45** — high link recall, collapsed entity clusters. All four figures verified against the paper's Table 3 (2026-09-15). | Character identity in the World Model seed cannot be trusted from a single global pass. The MUC-vs-B³ gap is a *mechanically checkable* signal (see §8) — though §2.2 records a 2026-09-15 qualification: the paper shows these metrics are partly biased low on full-book scoring, so the gap screens rather than proves. |
| 3 | **A single extraction pass is known to under-extract, and production systems already budget for re-passes.** GraphRAG ships a literal continuation prompt — `"MANY entities and relationships were missed in the last extraction…"` — plus a yes/no loop prompt, run up to `max_gleanings` times. | Multi-pass is the industry default for exactly our pass 1, not an exotic choice. |
| 4 | **Scene segmentation from continuous prose is an open research task, not a solved preprocessing step.** Human annotators agree at γ 0.57–0.83; chapter-break prediction (a far easier, more mechanical target) tops out at F1 **0.453**; a 2025 survey of the state of the art finds LLMs *more robust but slightly worse* than the BERT-era baseline. | Scene Card boundaries are the least reliable part of extraction. Design for author correction, not for autonomy. |
| 5 | **"What does the reader know when" has no extraction literature at all.** Four adjacent lines exist (narrative revelation, event-indexing salience, information status, spoiler detection) and none reconstructs a per-fact ledger from prose. | The told-ledger is the one pass with no prior art to crib. It must be *derived* from the extracted Scene Cards, not read off the source text. |
| 6 | **Long-context degradation is measured and starts early.** Reasoning accuracy drops 0.92 → 0.68 well before the context limit; on book-length fiction no open-weight model beat random chance on a true/false claim benchmark, and GPT-4o managed 55.8%. Consistency errors in long generated narrative cluster *in the middle*. | Whole-novel-in-one-prompt extraction is the failure mode, not the shortcut. |
| 7 | **"As of scene N" is a known, separately-measured failure.** TimeChara reports GPT-4o at **64.5%** average spatiotemporal consistency when asked to hold a character at a point in the narrative — and **46.0%** on future-context questions. | Our World Model is explicitly "at the current moment" (ADR 0001/0016). Extraction must produce a *seed plus a change list*, never a flattened end-state snapshot. |

---

## 1. The shape of the field: three traditions, none of which ends where we need it to

### 1.1 Symbolic annotation (1990s–2010s): correct, tiny, and hand-made

The work closest to our Fabula layer in *ambition* is the annotation tradition, and its defining
property is cost.

- **Story Intention Graph / DramaBank / Scheherazade** (Elson, Columbia). The SIG is an explicit
  encoding of a story's *fabula* — entities, events and statives on a timeline, plus an
  interpretative layer of goals, plans and beliefs. DramaBank collected **110 story encodings**
  with the Scheherazade annotation tool — confirmed: "The DramaBank corpus consists of 110
  encodings divided into three collections" — and the paper reports that inter-annotator agreement
  is "complicated by the addition of the interpretative layer, which by its nature reflects a
  subjective take on the stated or unstated motivations driving the story's agents" (verbatim).
  **[fetched — [DramaBank: Annotating Agency in Narrative Discourse, LREC 2012](http://www.cs.columbia.edu/~delson/pubs/LREC2012-Elson.pdf)]**

  **Corrected 2026-09-15 — this number was wrong.** This document previously reported "roughly 45
  minutes of annotator time per story". The paper says: "The median time spent on an encoding was
  **1.25 hours** (1 hour for Aesop fables, 2 hours for the longer texts)." The annotators were six
  graduate students from a Department of English and Comparative Literature plus three
  undergraduate English majors, after a 2–3 hour training session; one outlier reported over six
  hours for a single encoding, and the *Beowulf* encoding (476 nodes, ~50% of the text) took 15
  hours. The corrected figures make §1.1's cost argument **stronger**, not weaker: the annotation
  tradition is roughly twice as expensive per story as this document claimed, on texts far shorter
  than a novel, using trained literature graduates.
- **Story Workbench + Analogical Story Merging** (Finlayson, MIT/FIU). The most deeply annotated
  narrative corpus of its era: **15 Russian folktales**, annotated for **18 aspects of meaning**
  by **12 annotators**, used to induce Propp's morphology via Bayesian model merging.
  [search-verified — [Inferring Propp's Functions from Semantically Annotated Text, *Journal of American Folklore* 129(511), 2016](https://scholarlypublishingcollective.org/uip/jaf/article/129/511/55/228586/Inferring-Propp-s-Functions-from-Semantically)]

**What this means for us.** Both projects prove the *representation* is expressible — a fabula
with entities, timed events, goals and plans is a thing you can write down and check. Neither
offers an extraction method: they are human annotation protocols. The interesting transfer is
negative and specific: Elson's finding that agreement degrades precisely on the *interpretative*
layer maps onto our tier legend. Physical and epistemic facts (who is where, who knows what) are
the annotatable part; volitional/relational facts (goals, allegiances, feelings) are where two
careful humans stop agreeing. ADR 0005 already refuses to let the engine auto-commit V-tier
columns. **Extraction should inherit that refusal**: a V-tier value pulled out of someone else's
prose is a proposal, not a row.

### 1.2 Statistical narratology (2008–2021): real corpora, narrow tasks

- **Narrative event chains / script induction** (Chambers & Jurafsky, ACL 2008) — unsupervised
  induction of partially-ordered event sets sharing a protagonist, evaluated with the *narrative
  cloze*. This is the ancestor of every "extract the event list" idea in #113. Confirmed verbatim:
  "A narrative event chain is a partially ordered set of events related by a common protagonist",
  learned in three steps, with "the narrative cloze to evaluate event relatedness, and an order
  coherence task to evaluate narrative order". **[fetched —
  [ACL 2008, pp. 789–797](https://aclanthology.org/P08-1090/)]**
- **LitBank + BookNLP** (Bamman et al.) — the working infrastructure for literary entity work;
  see §2.
- **Scene segmentation** (Würzburg/Köln) — see §3.
- **NEAT / narrative elements in informational text** — a multi-label scheme adapting Labov &
  Waletzky (Complication, Resolution, plus Success), 2,209 sentences over 46 news articles,
  supervised models reaching average F1 up to 0.77. All four figures confirmed against the
  abstract of *Detecting Narrative Elements in Informational Text* (Levi, Mor, Sheafer & Shenhav).
  **[fetched — [Findings of NAACL 2022](https://aclanthology.org/2022.findings-naacl.133/)]**

Two surveys anchor the field if a wider read is ever wanted: *A survey on narrative extraction
from textual data* (Santana et al., *Artificial Intelligence Review*, 2023,
[doi:10.1007/s10462-022-10338-7](https://link.springer.com/article/10.1007/s10462-022-10338-7))
and *Survey on Narrative Structure: from Linguistic Theories to Automatic Extraction*
([TAL 63, 2022](https://aclanthology.org/2022.tal-1.3.pdf)). Both are `[search-verified]`; I
could not open either.

### 1.3 LLM pipelines (2022–2026): the direct ancestors, and they are all multi-stage

Every recent system that goes prose → structure is staged. Not one of them is a single call.

| System | Stages |
| --- | --- |
| **Re3** (EMNLP 2022) | Plan → Draft → Rewrite → Edit **[fetched]** — the abstract's own wording for the four stages is "(a) … construct a structured overarching plan", "(b) generating story passages by repeatedly injecting contextual information", "(c) reranking different continuations for plot coherence and premise relevance", "(d) editing the best continuation for factual consistency". The four-stage decomposition is confirmed; the module *names* Plan/Draft/Rewrite/Edit are not in the abstract. |
| **DOC** (successor to Re3) | detailed outliner → FUDGE-based detailed controller; GPT-3 for the outline, OPT-175B for drafting, rerankers for relevance/coherence/outline adherence **[fetched]** |
| **Dramatron** (CHI 2023) | log line → characters → plot → location descriptions → dialogue, by prompt chaining **[fetched]** — abstract: "applying language models hierarchically … By building structural context via prompt chaining, Dramatron can generate coherent scripts and screenplays complete with title, characters, story beats, location descriptions, and dialogue." (The abstract says *title* and *story beats* where this row says *log line* and *plot*; the hierarchy and the chaining are confirmed.) Read via [arXiv:2209.14958](https://arxiv.org/abs/2209.14958) — `dl.acm.org` still returns 403. |
| **R²** (novel → screenplay) | Reader (sliding window + causal plot-graph construction) → Rewriter (scene outlines → screenplay), with an iterative hallucination-aware refinement step **[fetched]** (see §2.5) |
| **Story Ribbons** (VIS 2025) | four steps in a decomposition phase and an aggregation phase [search-verified] |
| **NexusSum** | preprocess → summarize → iteratively compress **[fetched]** — "a multi-agent LLM framework for narrative summarization that processes long-form text through a structured, sequential pipeline", combining "Dialogue-to-Description Transformation" preprocessing with "Hierarchical Multi-LLM Summarization" |
| **Recursively Summarizing Books** (OpenAI, 2021) | recursive task decomposition: summarize sections, then summarize the summaries **[fetched]** — "At inference time, the model first summarizes small sections of the book and then recursively summarizes these summaries to produce a summary of the entire book." |

Links: [Re3](https://aclanthology.org/2022.emnlp-main.296/) ·
[DOC](https://github.com/yangkevin2/doc-story-generation) ·
[Dramatron](https://dl.acm.org/doi/10.1145/3544548.3581225) ·
[R²](https://arxiv.org/abs/2503.15655) ·
[Story Ribbons](https://arxiv.org/abs/2508.06772) ·
[NexusSum](https://arxiv.org/abs/2505.24575) ·
[Recursively Summarizing Books](https://arxiv.org/abs/2109.10862)

**What this means for us.** The convergence is the finding. Seven independent systems, three
research groups and one product team, all decompose. The only place I found a *defence* of the
single-call shape is our own ADR 0003 decision 3 — and that decision is about emitting a digest
alongside prose the same model just wrote, which is the opposite situation: the model authored
the content, so the digest is recall, not extraction.

---

## 2. Character / location / relationship extraction, and where it breaks

### 2.1 BookNLP is the baseline, and it is a real one

[BookNLP](https://github.com/booknlp/booknlp) is the standing pipeline for exactly the World
Model seed tables: entity recognition, character name clustering, coreference, quotation speaker
attribution, event tagging, referential gender. Its README reports **[fetched]**:

| Task | Small model | Big model |
| --- | --- | --- |
| Entity tagging (F1) | 88.2 | 90.0 |
| Supersense tagging (F1) | 73.2 | 76.2 |
| Event tagging (F1) | 70.6 | 74.1 |
| Coreference resolution (avg F1) | 76.4 | 79.0 |
| Speaker attribution (B³) | 86.4 | 89.9 |

On a 99K-token book (*The Secret Garden*) the small model runs in 2–4 CPU-minutes.

Its training data, [LitBank](https://github.com/dbamman/litbank), is **100 English fiction works,
~2,000 words sampled from each, 210,532 tokens total**, with entity (six ACE 2005 categories),
event, coreference and quotation layers **[fetched]**. Cross-checked 2026-09-15 against the
entity-layer paper's abstract, which matches exactly: "a new dataset comprised of 210,532 tokens
evenly drawn from 100 different English-language literary texts annotated for ACE entity
categories (person, location, geo-political entity, facility, organization, and vehicle)"
**[fetched — [Bamman, Popat & Shen, NAACL 2019](https://aclanthology.org/N19-1220/)]**.

That `~2,000 words` is the whole problem. LitBank is the long-document standard and it is
excerpt-based; nothing in it observes an entity across a novel.

### 2.2 Long-document coreference: the specific failure, with a specific signature

[BookCoref](https://github.com/SapienzaNLP/bookcoref) (Martinelli, Bonomo, Huguet Cabot &
Navigli, ACL 2025, pp. 24526–24544) is the first book-scale coreference benchmark — average
document length over 200,000 tokens. Its repo ships the comparison systems' outputs and an
`evaluate.py` with three modes: `full` (whole books), `split` (documents cut every 1,500
tokens), and `gold_window` (predict on the full book, score against the split version)
**[fetched]**.

The README's own worked example, a Maverick-XL model fine-tuned on BookCoref, evaluated on full
books **[fetched]**:

```
muc:       precision 92.95  recall 95.70  f1 94.30
b_cubed:   precision 43.08  recall 77.19  f1 55.30
ceafe:     precision 37.10  recall 30.46  f1 33.45
conll2012: precision 57.71  recall 67.78  f1 61.02
```

**Verified 2026-09-15 against the paper itself.** These four numbers, previously known only from
the repo README, appear in the paper's Table 3 (Maverick-xl fine-tuned on BookCoref-silver,
evaluated on BookCoref-gold): MUC **94.3**, B³ **55.3**, CEAFφ4 **33.4**, CoNLL **61.0**. The
README and the paper agree **[fetched — [ACL 2025, pp. 24526–24544](https://aclanthology.org/2025.acl-long.1197/)]**.

Read those four lines together and they describe one concrete failure. MUC is a **link-based**
metric and is documented as *preferring over-merged results*; B³ and CEAFe are **cluster-based**
and punish them. Luo's paper makes the case on a worked example: its system response (c) "puts
all the mentions into a single entity" and MUC nonetheless scores it well, which is why Luo
concludes "the widely-known MUC F-measure has serious flaws in evaluating a coreference system"
(he also notes B³ has problems of its own) **[fetched — [On Coreference Resolution Performance
Metrics, HLT/EMNLP 2005](https://aclanthology.org/H05-1004.pdf)]**. MUC at 94.30 with B³
precision at 43.08 and CEAFe at 33.45 is the arithmetic signature of **mention chains being
welded into too few, too large clusters**.

**Qualification added 2026-09-15, from the paper's own analysis.** BookCoref reports this
divergence as a general pattern — "MUC often measures over 80 F1 points both in the window and
book-scale setting, while B³ and, in particular, CEAFφ4, often show lower scores on full books,
which substantially increase when evaluating model performance on smaller texts" — but it does
*not* attribute all of the gap to over-merging. Its Appendix G adds a third evaluation setting,
`BookCoref_gold+window` (predict on the full book, score in windows), and finds those scores
"consistently higher" than full-book scoring, "indicating that traditional coreference metrics
are biased towards lower performances when evaluating full-book predictions" **[fetched]**. So
part of the collapsed B³/CEAFe is a scoring artifact of book-scale evaluation, not purely real
entity welding. The over-merge reading above is still the right *first* hypothesis — it is what
the metrics' construction implies — but it is this document's interpretation layered on the
paper's numbers, not the paper's own conclusion. This matters for §8; see the note there.

**Corrected 2026-09-15 — this claim was wrong.** The previous version of this section said, on
the strength of the ACL abstract, that existing long-document coreference systems *lose* up to
**20+ CoNLL-F1** on full books relative to the split version. The abstract says the opposite
thing about a different comparison: BookCoref "enables current long-document coreference systems
to **gain** up to +20 CoNLL-F1 points when evaluated on full books" — that is a *gain* from
having book-scale training data (BookCoref-silver), not a loss from book-scale evaluation. The
sign was read backwards.

The underlying point nevertheless survives, because the paper's Table 3 does show a large
full-book penalty — it just is not the abstract's number. Comparing each fine-tuned system on
BookCoref-gold (full books) against SPLIT-BookCoref-gold (1,500-token windows), CoNLL-F1 falls
**82.2 → 61.0 for Maverick-xl (−21.2)**, **77.3 → 52.5 for Dual-cache (−24.8)** and
**77.1 → 67.0 for Longdoc (−10.1)** **[fetched]**. So "a 20-point-plus CoNLL-F1 penalty for
full-book evaluation" is true of two of the three fine-tuned systems, and the abstract's own
framing of the challenge is that "current models fail to deliver the same performance they
achieve on smaller documents." Cite Table 3 for this, never the abstract's +20.

**What this means for us.** This is the failure our World Model is least able to absorb.
ADR 0001's identity rule — a stable slug id, never a name — assumes the *set of ids* is right.
Two characters welded into one `character` row poisons every downstream object: `characters_present`
on every Scene Card, the `met:<entity_id>` told-ledger facts, the re-anchoring policy, and every
relationship edge that points at the merged id. Splitting an over-merged character later is not a
one-column update; it is a re-authoring.

Two practical consequences:

1. **Do coreference/entity resolution over bounded windows and reconcile explicitly**, which is
   what BookCoref's `split` mode and GraphRAG's chunked extraction both do in practice.
2. **Run the MUC-vs-B³ gap as a check, not just a score** (see §8). It is cheap, it needs no gold
   data if you use a second independent pass as the comparison, and it points at the one error
   the schema cannot survive.

### 2.3 Entity disambiguation is not solved by the tools that look like they solve it

[GraphRAG](https://github.com/microsoft/graphrag) is the obvious candidate for "pull an entity +
relationship graph out of a corpus". Its README warns that "GraphRAG indexing can be an expensive
operation, please read all of the documentation to understand the process and costs involved, and
start small", and notes the project is "largely in maintenance mode" since its July 2024 release
**[fetched]**. Microsoft Research's own post frames suitability as a cost question: whether the
benefits "outweigh the upfront costs of graph index construction" **[fetched]**.

More important for us: GraphRAG does not do entity disambiguation — two surface forms of the same
person remain separate nodes unless dedup happens to catch them. **Confirmed 2026-09-15** from
*From Local to Global*, which is explicit about the mechanism and about its own defence:

> "In this manuscript, our analysis uses exact string matching for entity matching — the task of
> reconciling different extracted names for the same entity. However, softer matching approaches
> can be used with minor adjustments to prompts or code. Furthermore, GraphRAG is generally
> resilient to duplicate entities since duplicates are typically clustered together for
> summarization in subsequent steps."

**[fetched — [arXiv:2404.16130](https://arxiv.org/abs/2404.16130)]**

The claim holds — exact string matching is not disambiguation — but note the second half, which
this document previously did not have. GraphRAG has an answer to duplicate entities, and it is
the *one answer that does not transfer to us*: it tolerates duplicates because everything
downstream is community-level summarization, where two nodes for the same person land in the same
community and get summarized together. We do not summarize; we key on a slug id. A duplicate
survives GraphRAG's architecture and is fatal to ours, so "generally resilient" is a claim about
retrieval indices, not about typed rows.

That is the *opposite* error from BookCoref's over-merge, and both are fatal to
a slug-id World Model. An extraction pass can fail by fusing Fred and Scrooge or by splitting
Scrooge into three, and you need a check for each direction.

### 2.4 Attribute drift: the source text has a timeline, the World Model has a "now"

Our World Model holds "cold, queryable ground truth *at the current moment*" and reconstructs
"as of scene N" by replaying the state-update commit log (ADR 0016). A novel does not hand you
that. It hands you a sequence of assertions, many of which are true only for a stretch of the
book.

Three pieces of evidence that this is a real, separately-measured problem:

- **TimeChara** (Findings of ACL 2024) measures exactly "hold this character at this point in the
  narrative". The repo's leaderboard reports GPT-4o (2024-05-13) zero-shot at **64.5% average
  spatiotemporal consistency**, broken down as **future-context 46.0%**, past-absence 74.0%,
  past-presence 90.0%, past-only 65.5%; o1 (2024-12-17) reaches 81.8%; Mistral-7B 46.8%. The
  benchmark is 10,895 instances over Harry Potter, Lord of the Rings, Twilight and The Hunger
  Games **[fetched — [ahnjaewoo/timechara](https://github.com/ahnjaewoo/timechara)]**.
  **Cross-checked against the paper 2026-09-15** ([Findings of ACL
  2024](https://aclanthology.org/2024.findings-acl.197/)): its results table gives GPT-4o
  (`gpt-4o-2024-05-13`) zero-shot as future **46.0 ± 3.5**, past-absence **74.0 ± 4.4**,
  past-presence **90.0 ± 3.0**, past-only **65.5 ± 3.5**, average **64.5 ± 2.0** — every figure
  matches the repo leaderboard. The 10,895 instances and the four series are confirmed in the
  abstract and Table 3 **[fetched]**. The
  *future-context* number is the relevant one: models are worst at refusing knowledge a character
  should not yet have, which is structurally the same operation as our `must_stay_hidden`.
- **Entity state tracking** has its own datasets and they are deliberately narrow.
  [OpenPI](https://github.com/allenai/openpi-dataset/) frames the task as producing
  `(entity, attribute, before-state, after-state)` tuples from open vocabulary **[fetched]**;
  ProPara restricts itself to three change types (create, destroy, move) over scientific
  procedural text [search-verified]. Both are paragraph-scale, non-narrative, and neither has a
  literary analogue. **There is no "track a character's attributes across a novel" dataset that I
  could find.**
- **The commercial tools treat this as a first-class field, which is itself evidence.**
  Novelcrafter's Codex supports aliases, relations, automatic mention tracking, and explicitly
  *"progressions over time"* — a per-entity, per-point-in-story value [search-verified, vendor
  page: <https://www.novelcrafter.com/features/codex>]. Independent reviews of the same product
  state that Codex entries must be created manually and that it does **not** auto-extract entities
  from an existing manuscript [search-verified, and note this conflicts with the vendor page's
  "automatically detects references" framing — the reconcilable reading is that *detection of
  mentions of entries you already made* is automatic while *creation of the entries* is not, but
  I could not open the vendor docs to confirm].

**What this means for us.** Extraction must not produce a flat World Model. It must produce a
**seed** (state before scene 1) plus **per-scene `state_updates`** — which is exactly the shape
ADR 0016's state-update commit log already stores. That is a pass-ordering constraint: you cannot
write the seed until you know the event sequence, because "Scrooge's `status`" has no single value
over *A Christmas Carol*. Anything the extractor cannot place on the timeline belongs in the
`bag`, not in a tiered column.

### 2.5 Contradictions extraction introduces that the source doesn't have

This is the ticket's sharpest question and the field's thinnest answer. What exists:

- **R²** names it as one of two fundamental challenges — "LLM hallucinations that may cause
  inconsistent plot extraction" — and answers it with **HAR, a hallucination-aware refinement
  method that iteratively discovers and eliminates the effects of hallucinations**, plus a causal
  plot-graph construction step (CPC) using a greedy cycle-breaking algorithm. In other words: the
  fix for extraction-induced contradiction, in the closest published system to our task, *is
  another pass*. Every clause here is in the paper's abstract, confirmed verbatim: "the LLM
  hallucinations may cause inconsistent plot extraction and screenplay generation", "a
  hallucination-aware refinement method (HAR) to iteratively discover and eliminate the affections
  of hallucinations", "a causal plot-graph construction method (CPC) based on a greedy
  cycle-breaking algorithm". Full title: *R²: A LLM Based Novel-to-Screenplay Generation Framework
  with Causal Plot Graphs* (Lin et al.). **[fetched —
  [arXiv:2503.15655](https://arxiv.org/abs/2503.15655)]**

  **Resolved 2026-09-15 — the previously-dropped "headline accuracy numbers".** This document
  declined to repeat R²'s headline figures because they reached it only through a third-party
  summary that described them as accuracy. That was the right call, and for a better reason than
  we knew: **the paper does not report accuracy figures at all.** Its abstract reports
  pairwise-comparison **win-rate** increases — "51.3%, 22.6%, and 57.1% absolute increases" for
  GPT-4o against three existing approaches. Those are relative preference margins from a
  comparative evaluation, not an absolute correctness score, and they say nothing about extraction
  fidelity. The third-party summary mislabelled them. Do not cite R² for an accuracy number; there
  isn't one to cite.
- **Hallucinated relations** are a known LLM-KG-construction failure: models infer causal links
  between co-mentioned entities that have no actual connection in the source [search-verified,
  general-literature claim; I could not open a single owning paper for it and would not cite a
  specific one].
- **ConStory-Bench / "Lost in Stories"** is about *generated* narrative, not extraction, but its
  taxonomy is directly reusable. Abstract, verbatim **[fetched —
  [Microsoft Research publication page](https://www.microsoft.com/en-us/research/publication/lost-in-stories-consistency-bugs-in-long-story-generation-by-llms/)]**:

  > "…we present ConStory-Bench, a benchmark designed to evaluate narrative consistency in
  > long-form story generation. It contains 2,000 prompts across four task scenarios and defines
  > a taxonomy of five error categories with 19 fine-grained subtypes. We also develop
  > ConStory-Checker, an automated pipeline that detects contradictions and grounds each judgment
  > in explicit textual evidence. … we find that consistency errors show clear tendencies: they
  > are most common in factual and temporal dimensions, tend to appear around the middle of
  > narratives, occur in text segments with higher token-level entropy, and certain error types
  > tend to co-occur."

  Authors: Junjie Li, Xinru Guo, Yuhao Wu, Roy Ka-Wei Lee, Hongzhi Li, Yutao Xie; arXiv, March
  2026. The design idea worth stealing is **"grounds each judgment in explicit textual
  evidence"** — a contradiction claim that cannot point at two spans is not a finding.

**What this means for us.** An extracted Story Package can be internally inconsistent in ways the
source novel is not, and our existing machinery will happily run on it: the plant-obligation walk
(ADR 0004) will reject a `pays_off` whose plant scene never declared the `fact_ref`, but it has no
opinion about a `fact_ref` the extractor invented in the first place. The three existing hard
errors — `plant_after_payoff`, `plant_not_declared`, `unfounded_seed_payoff` — become the first
*free* extraction-fidelity checks we have (see §8), because a hallucinated plant/payoff link
usually violates one of them.

---

## 3. Scene / beat segmentation from continuous prose

### 3.1 The task is defined, benchmarked, and not solved

The German CLS community owns this. The definition they converged on is close to our Scene Card's
implicit one, and Zehe et al. state it verbatim: "A scene here is a segment of the text where the
story time and the discourse time are more or less equal, the narration focuses on one action and
space and character constellations stay the same" **[fetched]**.

- **Zehe et al., "Detecting Scenes in Fiction: A new Segmentation Task"**, EACL 2021, pp.
  3167–3177. Introduced the task and a German dime-novel corpus. **Confirmed and refined
  2026-09-15**: the corpus is **15 annotated German dime novels, 36k sentences, 550k tokens**,
  annotated by two annotators with a curator establishing the gold standard. The headline
  agreement figure is **γ = 0.7 across all novels (σ = 0.07)**; the **0.57–0.83 range this
  document quotes is the per-novel worst and best**, from the Figure 1 caption — "Scene
  annotations of *Dr. Bergen* (1, γ = 0.57, worst agreement in the dataset) and *Tausend Pferde*
  (2, γ = 0.83, best agreement in the dataset)". Both readings are correct; the range is the
  spread, 0.7 is the average, and this document should say which it means. **[fetched —
  <https://aclanthology.org/2021.eacl-main.276/>]**
- **STSS 2021 @ KONVENS** — shared task: 20 dime novels as training data, Track 1 = four in-domain
  dime novels, Track 2 = two out-of-domain 19th-century literary texts; ranking metric was
  **exact F1 over all boundaries**. Track 1 winner: Kurfali & Wirén, *Breaking the Narrative:
  Scene Segmentation through Sequential Sentence Classification*; Track 2 winner: Gombert
  [search-verified — [overview paper](https://ceur-ws.org/Vol-3001/paper1.pdf)]. The winning
  system's repo is public but its README carries no scores
  **[fetched — [MurathanKurfali/scene_segmentation](https://github.com/MurathanKurfali/scene_segmentation)]**.
- **The "BERT baseline F1 ≈ 24%" figure is now confirmed, and was previously mis-located.**
  This document flagged it as unverified and do-not-quote, on the assumption it belonged to the
  STSS shared-task results table. It does not: it is in **Zehe et al. (EACL 2021)'s own abstract**,
  verbatim — "Baseline experiments using BERT achieve an F1 score of 24%, showing that the task is
  very challenging." **Promoted to quotable [fetched].** Attribute it to Zehe et al. 2021, not to
  the shared task. The same paper adds a second figure worth having: "on average, the system
  divides the novels into four times more scenes than the annotation specifies" — i.e. the BERT-era
  baseline's failure is gross over-segmentation, not near-misses on boundaries **[fetched]**.
- **Zehe, Fischer & Hotho, "Assessing the State of the Art in Scene Segmentation"**, NAACL 2025.
  Finds and fixes a problem in the previous training procedure, analyses generalisation, and
  compares BERT-era SotA against Llama models. Headline, confirmed verbatim: "We find that
  Llama-based models are more robust to different types of texts, while their overall performance
  is slightly worse than that of BERT-based models." The abstract also notes their corrected
  training procedure "provides a significant increase in performance", so the BERT-era baseline
  this compares against is a *fixed* one, not the 2021 number above. **[fetched —
  <https://aclanthology.org/2025.naacl-long.500/>]**
- **Guhr, Mao & Lin, "Rethinking Scene Segmentation. Advancing Automated Detection of Scene
  Changes in Literary Texts"**, LaTeCH-CLfL 2025. Every detail confirmed: the corpus is the
  Harlequin series "Men Made in America" (1982–2002), 47 romance novels by female authors, of
  which **10 were manually annotated (572,907 words, 795 gold scene changes)**; they fine-tuned
  both BERT and the **Universal Sentence Encoder** (Cer et al. 2018) on six-sentence passages as a
  binary "contains a scene change" classification, and "found USE to achieve better performance in
  our specific case"; the abstract calls the results "promising preliminary results". The
  six-sentence window is justified by the observation that "scene change transitions can span up to
  three sentences". **[fetched — <https://aclanthology.org/2025.latechclfl-1.8/>]**

### 3.2 The easier version of the task is also not solved

**Chapter Captor** (Pethe, Kim & Skiena, EMNLP 2020) predicts *chapter* breaks — a boundary the
author physically marked and the tooling then hid. Over 9,126 Project Gutenberg novels: header
recognition F1 **0.77**, and exact break prediction over book-length documents F1 **0.453**.
All three numbers are in the paper's own abstract and are confirmed verbatim: "a Project Gutenberg
chapter segmentation data set of 9,126 English novels … achieving an F1-score of 0.77 on this
task … achieving a F1-score of 0.453 on the challenging task of exact break prediction over
book-length documents." **[fetched — <https://aclanthology.org/2020.emnlp-main.672/>]**

Corroborating this from the applied side: Story Ribbons' own repo says chapter extraction "is the
only step in the pipeline that may require manual intervention", with users expected to fix
boundaries by hand in a config file
**[fetched — [catherinesyeh/story-viz](https://github.com/catherinesyeh/story-viz)]**.

### 3.3 Screenplays are the cheat, and the reason the cheat exists

Screenplay work looks far healthier than prose work because the format hands you the segmentation
for free: slug lines mark scenes. **TRIPOD** (99 movies with screenplays, plot synopses and gold
turning-point annotations, plus a CSI set of 39 episodes) is built on pre-segmented scripts, and
SUMMER operates over "screenplays segmented into scenes" without describing a segmentation step,
because there isn't one
**[fetched — [ppapalampidi/SUMMER](https://github.com/ppapalampidi/SUMMER)]**. Papalampidi et
al.'s turning-point work then labels which scenes are structurally load-bearing. Confirmed
verbatim: "turning points (e.g., change of plans, major setback, climax) are crucial narrative
moments within a screenplay: they define the plot structure, determine its progression and segment
the screenplay into thematic units (e.g., setup, complications, aftermath)", and the model
"identifies turning points in plot synopses and projects them onto scenes in screenplays".
**[fetched — [Movie Plot Analysis via Turning Point Identification, EMNLP
2019](https://aclanthology.org/D19-1180/)]**. Note the abstract does not itself name TRIPOD or
give the 99-movie / 39-episode counts; those come from the SUMMER repo, cited above.

**What this means for us.** Three transfers:

1. **Turning-point identification is the closest existing analogue to a Scene Card's dramatic
   function**, and it is only tractable because the scene boundaries are given. Our extraction has
   to produce the boundaries *and* the function; those are separate difficulties and should be
   separate passes.
2. **The scene-boundary question and the `required_beats` question are not the same question.**
   Segmentation says where a scene ends; beats say what has to happen inside it. Beat extraction
   has no benchmark at all that I could find — the nearest thing is turning-point labelling, which
   is per-film and coarse (six acts), not per-scene.
3. **Author correction must be a first-class step, not an error path.** At γ ≈ 0.57–0.83 human
   agreement, "the extractor picked different boundaries than you would have" is not a bug; it is
   the task's noise floor. #113's landing path already accommodates this: extraction stops at
   JSON valid against `DraftStoryPackageSchema`, which lands as a **Manuscript** through the
   Import mode (ADR 0017 §6) and goes through the normal editor/lint/publish loop. That is the
   right seam, and §3's numbers are the argument for why it has to stay the seam.

---

## 4. Recovering "what does the reader know when" — the told-ledger equivalent

**Finding: this has no prior art.** I looked for work that reconstructs, from prose that never
states it, a per-fact record of when a reader first learns something. I did not find any. What I
found are four adjacent lines, each solving a different problem, and it is worth naming exactly
how each one misses, because the gaps are informative.

### 4.1 Narrative revelation (aggregate, not per-fact)

Piper, Xu & Kolaczyk, **"Modeling Narrative Revelation"**, CHR 2023. Frames the exact question —
"given a beginning state of no knowledge about a story … and an end state of full knowledge …
what are the rhythms of dissemination through which we arrive at this final state?" — and answers
it with **relative entropy plus time-series analysis over 2,700+ books of contemporary English
prose** [**still [search-verified]** — <https://ceur-ws.org/Vol-3558/paper6166.pdf>. The 2026-09-15
pass reached the host and downloaded the PDF, but it uses subset-embedded fonts with a custom
encoding and no text layer that either the fetch tool or a local extractor could read. This is a
tooling failure, not a reachability failure; the claim is unconfirmed and should be re-checked by
someone who can open the PDF in a reader].

This is the right question at the wrong resolution. It measures the *rate* at which a text
discloses, as a distributional property of the whole book. It does not produce, and does not try
to produce, a row saying `the_will_was_forged` was first learned in scene 9.

### 4.2 Event-indexing / salience (authored plans, not extracted prose)

**Indexter** (Cardona-Rivera, Cassell, Ware & Young, CMN 2012) models the salience of a past event
given the current one, along **five indices: protagonist, time, space, causality, intentionality**
— the Pairwise Event Salience Hypothesis being that a past event sharing at least one index with
the most recent event is more salient than one sharing none [search-verified].

Indexter is the closest existing thing to our **re-anchoring policy** (ADR 0009) — a model of what
the audience currently has in mind, used to decide how much to restate. But it runs over
*authored plan structures*, not over prose, so it is a design precedent for the decision rule,
not a method for recovering the ledger from a novel.

Our told-ledger is deliberately cruder than Indexter: `{fact_ref, first_learned_scene,
last_touched_scene, centrality}` with `centrality` an ordinal, driven by
`scenes_since_last_touch`. The five-index idea is an available refinement if `scenes_since_last_touch`
ever proves too blunt; it is not needed now, and ADR 0009 is right that it isn't.

### 4.3 Information status (per-mention, sentence-local, not story-scale)

The linguistics answer to "has the reader met this before" is **information status** annotation:
mentions are **old** (previously referred to), **mediated** (not mentioned before but accessible
via another old mention or world knowledge — including bridging, comparative and syntactic
variants), or **new**. Confirmed verbatim from Hou's paper: the Switchboard dialogue IS corpus
"contains around 63k mentions annotated with IS types (i.e., old, mediated, and new) and
subtypes". **[fetched — [Fine-grained Information Status Classification Using
Discourse Context-Aware BERT, COLING 2020](https://aclanthology.org/2020.coling-main.537.pdf)]**
One detail did **not** confirm: this document described ISNotes as "50 WSJ documents", which does
not appear in Hou's paper — its Table 2 characterises ISNotes by mentions (10,980), not documents.
The document count presumably comes from Markert et al. 2012, which I did not open. Treat
"50 WSJ documents" as **unverified**; the 63k Switchboard figure and the three-way scheme are solid.

This is genuinely the same *concept* as the told-ledger's introduce/assume distinction, and the
three-way old/mediated/new split maps suggestively onto our four-band
introduce/assume/reanchor/reintroduce. But the task is per-noun-phrase and local; nothing in it
accumulates a ledger across a book, and the corpora are news and telephone speech, not fiction.

### 4.4 Spoiler detection (reader knowledge as a proxy, in the wrong document)

Spoiler detection is formally about reader knowledge — "a spoiler is, by definition, an event that
is later than the viewer's knowledge of the current work" [search-verified]. But it operates on
*reviews*, not on the book: the UCSD Goodreads spoiler dataset annotates review sentences, ~3% of
which are spoilers [search-verified — [Fine-Grained Spoiler Detection from Large-Scale Review
Corpora, ACL 2019](https://arxiv.org/pdf/1905.13416)]. It tells you nothing about when the source
text revealed a thing.

### 4.5 Character knowledge ≠ reader knowledge (and the benchmarks are about the former)

Theory-of-mind benchmarks — **FANToM** (information-asymmetric conversational ToM, "challenging
for state-of-the-art LLMs, which perform significantly worse than humans even with chain-of-thought
reasoning or fine-tuning") and **OpenToM** (multi-paragraph naturalistic narratives, physical and
psychological mental states) — measure whether a model can track *who among the characters knows
what*. FANToM's abstract confirms the quoted clause verbatim: "We show that FANToM is challenging
for state-of-the-art LLMs, which perform significantly worse than humans even with chain-of-thought
reasoning or fine-tuning", in "information-asymmetric conversational contexts via question
answering" **[fetched — [FANToM](https://arxiv.org/abs/2310.15421)]**. The OpenToM description
remains [search-verified]; I did not open it.

That is our `character_knowledge` join table, not our told-ledger. The distinction is
CONTEXT.md's "two memories" made concrete: FANToM/OpenToM are World-Model-side questions; the
told-ledger is Discourse-Record-side. Worth knowing the benchmarks exist — if extraction ever
needs to populate `character_knowledge` rows, these are the evaluations that say how hard that is
— but they are not a told-ledger method.

### 4.6 The one genuinely relevant artifact: a foreshadow–payoff dataset

The single closest published thing to our plant-obligation graph:
**"Codified Foreshadowing-Payoff Text Generation"** (Yun, Zhou, Hou, Peng & Shang,
[arXiv:2601.07033](https://arxiv.org/abs/2601.07033), January 2026) **[fetched]**. The paper's
framework is named **CFPG**. Properties, all read from the paper itself in the 2026-09-15
verification pass:

- A sentence-level foreshadow–payoff dataset built by a **three-stage pipeline**, whose stages the
  paper names *Sentence-Level Candidate Identification → Payoff Alignment Verification →
  Rubric-Based Filtering* (the "identify, verify, filter" shorthand used below is a paraphrase of
  those three). **"The resulting dataset consists of 629 validated foreshadow-payoff pairs
  extracted from 148 books"** **[fetched]**.
- **Corpus, reconciled.** The mining source is **BookSum** — the paper describes it as "a corpus of
  human-written, hierarchical abstractive summaries that distill long-range plot points into
  discourse-salient events" — and the 148 books are the books those validated pairs come from. The
  two descriptions in circulation ("mines triples from the BookSum corpus" vs. "148 books, 629
  validated pairs") are therefore **compatible, not competing**: BookSum is the corpus, 148 is the
  book count of the surviving pairs. Note the consequence, which neither description makes obvious:
  the pairs are mined from **summaries**, not from the novels' prose. The dependency lengths below
  are therefore distances in *summary* sentences, not in the source text — see the caveat in point
  4 of "what this means for us". **[fetched]**
- Each entry carries the source text, a sentence-level index of the verified payoff, a
  natural-language description of the relation, and a categorical foreshadow **type**.
  **Corrected 2026-09-15:** the taxonomy is **five-way**, not the three-way object/event/rule this
  document previously reported. The paper's distribution is object **48.2%**, event **35.3%**,
  **speech-act 9.7%**, rule **5.1%**, symbol **1.7%** **[fetched]**. The earlier version named
  "rule" as the third category; it is in fact the fourth and a 5.1% tail, with speech-act the
  third.
- Dependency lengths, **confirmed** — the paper reports mean 20.9 sentences, median 13.0, 75th
  percentile **29.0**, 90th percentile **45.0**, max **230** **[fetched]**. The previous phrasing
  of this document ("25% of payoffs sit more than 29 sentences from their plant, 10% more than 45,
  the longest over 200") is a correct restatement of those percentiles.
- The method contribution is codifying commitments as **Foreshadow–Trigger–Payoff predicates**
  tracked as a codified state; the paper reports "consistent improvements over prompt-based
  baselines in payoff timing, localization, and narrative alignment" **[fetched]**.

**What this means for us.** Four things:

1. The `{fact_ref, plant: scene_id | null}` shape ADR 0004 landed on is a two-place version of
   their three-place Foreshadow–Trigger–Payoff predicate. Their middle term (*trigger*) has no
   home in our schema. Worth noticing, not worth acting on yet.
2. **629 validated pairs from 148 books** is roughly four per book, after a verify-and-filter
   pass. That is a sobering recall expectation for any single-pass plant extraction over a novel,
   and a direct argument for our `plant: null` escape hatch (payoff grounded in the World Model
   seed) being load-bearing rather than a corner case. **Caveat added 2026-09-15:** now that the
   corpus is confirmed to be BookSum *summaries*, four-per-book is a floor on what survives
   summarisation and verification, not a measurement of plant density in the underlying prose. It
   bounds what a pipeline like theirs recovers; it does not tell us how many plants a novel has.
3. Their pipeline **is verify-then-filter**, i.e. two passes after the proposal pass. Same
   conclusion as R², reached independently on our exact sub-problem. This is the one point in §4.6
   the summary-vs-prose caveat does not touch, and it is the point §10 leans on.
4. The dependency-length distribution is the empirical case for why ADR 0004's backward walk
   exists at all: a quarter of plants are far enough from their payoff that no local window sees
   both. **Read this as a lower bound.** The 29/45/230-sentence figures are distances in BookSum
   summary sentences; the corresponding distances in the novels those summaries compress are
   necessarily larger, often by orders of magnitude. The argument for a backward walk over a local
   window survives the correction and in fact gets stronger — but the specific numbers should not
   be quoted as prose-sentence distances, which is how they read in the previous version of this
   section.

### 4.7 Conclusion for this section, stated plainly

**The told-ledger cannot be extracted; it has to be derived.** No method exists, and the shape of
the four adjacent literatures suggests why: every one of them either aggregates over the whole
book (Piper), works per-mention within a sentence (information status), works on a different
document (spoilers), or presupposes an authored structure (Indexter). The route that is actually
available is the one our own compiler already uses in the other direction: **once extraction has
produced ordered Scene Cards with `reader_must_learn`, the told-ledger is a mechanical replay over
them** — `first_learned_scene` is the first scene whose `reader_must_learn` names the `fact_ref`,
`last_touched_scene` the most recent, `met:<entity_id>` auto-generated per entity per ADR 0003
decision 4. That makes the told-ledger a *consequence* of the Scene Card pass, not a fourth
extraction pass, and it means the real question is the reliability of `reader_must_learn`, not of
the ledger.

---

## 5. Long-context failure modes the pass structure has to survive

These are the measured facts that constrain how extraction is allowed to read a novel.

- **Lost in the Middle** (Liu, Lin, Hewitt, Paranjape, Bevilacqua, Petroni & Liang, TACL 2024).
  Performance follows a **U-shaped curve** in the position of the relevant information: the
  abstract states performance "is often highest when relevant information occurs at the beginning
  or end of the input context, and significantly degrades when models must access relevant
  information in the middle of long contexts, even for explicitly long-context models."
  **[fetched — <https://aclanthology.org/2024.tacl-1.9/>]**
- **Same Task, More Tokens** (Levy, Jacoby & Goldberg, ACL 2024). Isolating input length by
  padding the same sample: a **consistent degradation across all tested models, average accuracy
  0.92 → 0.68**, beginning *well before* the models' maximum input length. Confirmed verbatim:
  "LLMs quickly degrade in their reasoning capabilities, even on input length of 3000 tokens,
  which is much shorter than their technical maximum (on average over all tested models, a drop in
  accuracy from 0.92 to 0.68)." **The 3,000-token figure is new to this document and is the
  sharper version of the claim** — the degradation does not begin near the context limit, it
  begins at a length shorter than a single chapter. **[fetched —
  <https://aclanthology.org/2024.acl-long.818/>, full text at
  [arXiv:2402.14848](https://arxiv.org/abs/2402.14848)]**
- **NoCha / "One Thousand and One Pairs"** (Karpinska, Thai, Lo, Goyal & Iyyer, EMNLP 2024).
  1,001 minimally-different true/false claim pairs over 67 recently-published English fiction
  books, written by human readers of those books. Book length runs **49,156 to 336,288 tokens**
  (mean ≈ 127k). **No open-weight model performed above random chance; GPT-4o was highest at
  55.8% pair accuracy.** Models did substantially better on pairs needing only sentence-level
  retrieval than on pairs needing global reasoning; model-generated explanations were often
  inaccurate *even for correctly-labelled claims*; and performance was substantially worse on
  **speculative fiction with extensive world-building**. Every clause here is in the paper's own
  abstract; the annotators additionally confirm that "the largest share of pairs in NoCha require
  global reasoning over the entire book to verify." **[fetched —
  <https://aclanthology.org/2024.emnlp-main.948/>, full text at
  [arXiv:2406.16264](https://arxiv.org/abs/2406.16264)]**
- **ConStory-Bench** (§2.5, **[fetched]**): consistency errors "tend to appear around the middle
  of narratives" and "occur in text segments with higher token-level entropy".
- **Our own stack.** [`gemini-capabilities.md`](gemini-capabilities.md) §1 already records two
  constraints that bite an extraction call harder than they bite a writer call: the response
  schema is billed as input on **every** call and is **not cacheable**, and Google's own docs warn
  that "a complex schema can result in an `InvalidArgument: 400` error", with complexity coming
  from "long property names, long array length limits, enums with many values, objects with lots
  of optional properties". A single-call extractor emitting the whole Story Package is precisely
  that schema. §1 also records that `MAX_TOKENS` under a schema yields truncated, unparseable JSON
  with **no partial-object recovery** — and unlike the writer contract, an extraction call has no
  prose-first ordering to salvage, so a truncated extraction is a total loss for that call.

**What this means for us.** The three findings compose badly. NoCha says whole-book global
reasoning over fiction is near-chance today. Lost-in-the-Middle and ConStory both say the middle
of a long input is where things go wrong. `gemini-capabilities.md` says a big response schema is
expensive on every call, uncacheable, and can be rejected outright. Every one of those pushes the
same direction: **read the novel in bounded windows, emit a small schema per window, reconcile
globally in a separate, cheap step over the extracted structures rather than over the prose.**
That is structurally identical to what ADR 0008's zoom levels already do for generation — and it
is the same reason the continuity pass works over digests and never over full prose (ADR 0011).

---

## 6. Closest existing systems, and what I would actually crib

| System | Link | What it actually gives us | What I would crib | What I would leave |
| --- | --- | --- | --- | --- |
| **BookNLP** | [github](https://github.com/booknlp/booknlp) | Characters, coref clusters, quotation speakers, event spans over a whole book, in CPU-minutes. Reported entity F1 90.0, coref avg F1 79.0 **[fetched]** | Run it **first**, as a cheap non-LLM proposal layer for the `character` table and for who speaks in which stretch. Its output is a candidate set for an LLM pass to name, tier and dedup — not a final World Model. | Its `event` layer as our Fabula event list. Realis-event spans are token-level, not narrative beats. |
| **LitBank** | [github](https://github.com/dbamman/litbank) | 100 works × ~2,000 words, gold entities/events/coref/quotes, CC-BY **[fetched]** | A ready-made fixture for *evaluating* our entity pass against gold annotations on public-domain prose — it overlaps the Gutenberg corpus our fixtures already come from. | Treating it as evidence about novel-scale behaviour. It is excerpt-scale by construction. |
| **BookCoref** | [github](https://github.com/SapienzaNLP/bookcoref) | Book-scale gold coref, plus `evaluate.py` with `full` / `split` / `gold_window` modes and competitor outputs **[fetched]** | The **evaluation harness and the three modes**, near-verbatim. `gold_window` (predict globally, score locally) is exactly the diagnostic for "did the extractor weld two characters together". | The dataset as training data — it is CC BY-NC-SA. |
| **GraphRAG** | [github](https://github.com/microsoft/graphrag) | A production multi-pass entity/relationship extractor with a re-ask loop **[fetched]** | The **gleaning loop verbatim** (see §7). Also its honesty about cost. | Its graph/community-summary machinery. We don't need a retrieval index; we need typed rows. |
| **R²** | [arXiv](https://arxiv.org/abs/2503.15655) | Novel → screenplay: sliding-window reading, causal plot-graph construction, iterative hallucination-aware refinement **[fetched]**. Reports win-rate margins, not accuracy (§2.5) | The **shape**: bounded reading window, a graph over extracted events, and a dedicated refinement pass whose whole job is removing extraction hallucinations. This is the single closest published system to #113's extraction arm. | Its output format. A screenplay is not a Scene Card; it has no `reader_must_learn`, no tiers, no invariants. |
| **Codified Foreshadowing-Payoff (CFPG)** | [arXiv](https://arxiv.org/abs/2601.07033) | A three-stage identify/verify/filter pipeline for plant→payoff pairs over BookSum summaries, and a dependency-length distribution **[fetched]** | The **verify + filter stages** as the model for our `pays_off` extraction, and the five-way type taxonomy (object 48.2 / event 35.3 / speech-act 9.7 / rule 5.1 / symbol 1.7 — *corrected 2026-09-15, previously listed here as three-way object/event/rule*) as a possible `fact_ref` classifier. | Its predicate arity; our two-place `{fact_ref, plant}` is already settled by ADR 0004. Also its dependency-length numbers as prose distances — they are summary-sentence distances (§4.6). |
| **Story Ribbons** | [github](https://github.com/catherinesyeh/story-viz) | LLM pipeline extracting character/location/theme trajectories from 36 literary works, four steps across a decomposition and an aggregation phase **[fetched]** | The **decompose-then-aggregate split**, and its admission that chapter extraction needs a human. Closest published pipeline to our pass 1 + pass 3 pairing. | The visualization; irrelevant here. |
| **TimeChara** | [github](https://github.com/ahnjaewoo/timechara) | A benchmark and leaderboard for point-in-time character state **[fetched]** | The **evaluation design**: ask about a character at a fixed narrative moment, and separately score past-presence, past-absence and future-context. That is a ready-made test for "does the extracted seed + state log actually reconstruct scene N". | Its role-play framing. |
| **Re3 / DOC / Dramatron** | [Re3](https://aclanthology.org/2022.emnlp-main.296/) · [DOC](https://github.com/yangkevin2/doc-story-generation) · [Dramatron](https://dl.acm.org/doi/10.1145/3544548.3581225) | Hierarchical *generation*, the mirror image of extraction | Relevant to #113's **arc-generation** arm, not its extraction arm: all three produce a structured plan and then expand it, which is what "generate a Fabula skeleton" means. Dramatron's ordering (log line → characters → plot → locations → dialogue) is a plausible default for the generation pass ordering. | Their prose generation. We have a writer contract (ADR 0012). |
| **Sudowrite Story Bible** | [docs](https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/what-is-story-bible/jmWepHcQdJetNrE991fjJC) | The commercial state of the art for "story bible", incl. importing a manuscript and having the AI "detect and create your characters, even populating your defined trait fields" [search-verified] | The **sequential-sections UX**: Braindump → … → Characters/Worldbuilding → Outline → Scenes → Prose, each section generatable and each editable. It is the same staged shape as every research pipeline, arrived at commercially. | Nothing to integrate — it's a closed product. |
| **Novelcrafter Codex** | [vendor page](https://www.novelcrafter.com/features/codex) | Entity entries with aliases, relations, mention tracking, and **progressions over time** [search-verified] | The **progressions** concept as external validation that "attribute as of point in story" is the field authors actually need — i.e. our state-update commit log, not a flat table. | Its manual-entry model. |
| **NovelAI Lorebook** | [docs](https://docs.novelai.net/en/text/editor/storysettings/) | Keyword-triggered insertion of world facts into context, plus fixed Memory / Author's Note positions [search-verified] | Nothing for extraction. Listed because it is the obvious comparison and because its keyword-trigger model is the *naive* version of what our filtered World Model rows + told-ledger slice already do properly (ADR 0012). | All of it. |

---

## 7. The evidence that a single pass under-extracts, in its own words

The strongest single piece of primary evidence I found for the multi-pass question is not a paper
— it's production source. GraphRAG's entity-extraction prompt file ships two follow-up prompts
whose entire existence presumes the first pass missed things
**[fetched — [raw source, v0.3.0](https://raw.githubusercontent.com/microsoft/graphrag/v0.3.0/graphrag/index/graph/extractors/graph/prompts.py)]**:

```python
CONTINUE_PROMPT = "MANY entities and relationships were missed in the last extraction. Remember to ONLY emit entities that match any of the previously extracted types. Add them below using the same format:\n"
LOOP_PROMPT = "It appears some entities and relationships may have still been missed.  Answer YES | NO if there are still entities or relationships that need to be added.\n"
```

The loop runs up to a configurable `max_gleanings`
(**[fetched — [issue #613](https://github.com/microsoft/graphrag/issues/613)]**), and the design
rationale is the plain one: an LLM does not extract everything available in one extraction pass
[search-verified — this is a paraphrase of the design intent, not a quotation from a source I
opened; the prompts themselves above are the primary evidence and are **[fetched]**].

Note what the `CONTINUE_PROMPT` does *not* do: it does not re-ask for a different kind of output.
It re-asks for **more of the same kind**. That is a recall fix, and it is different from R²'s HAR,
which is a *precision* fix (remove hallucinated extractions). Both exist, in different systems,
for the same task. A serious extraction pipeline needs both directions, and they are separate
passes because they optimise opposite errors.

---

## 8. What is mechanically checkable about extraction fidelity

Written out here because #115 (the evaluation rubric) needs it, and because several of these come
free from machinery the repo already has. "Mechanical" here means the same standard CONTEXT.md
uses for the variance contract: checkable without a human and without an LLM judge.

**Free from existing machinery — no new code:**

| Check | Mechanism that already exists | Catches |
| --- | --- | --- |
| Package parses against `DraftStoryPackageSchema` | `src/authoring/transfer.ts`, ADR 0017 §6 | Structurally invalid extraction output |
| Every linter `error` clears | Package linter (publish gate, ADR 0017) | Cross-reference errors — the class #18 found hand-authoring actually produces |
| `plant_after_payoff` | Plant-obligation walk (ADR 0004 §4) | A payoff extracted before its plant — i.e. the extractor read the syuzhet order as the fabula order |
| `plant_not_declared` | Same | A `pays_off` link whose plant scene never declares the `fact_ref` — the signature of an invented plant |
| `unfounded_seed_payoff` | Same | A `plant: null` payoff with no seed-known fact behind it |
| `entry_state` / `exit_state` chain consistency | State-update validator's amnesia guard (ADR 0005) | An extracted scene sequence that reverts a value nothing licensed it to touch — attribute drift, made visible |

**Cheap to add, and each targets a failure mode §2–§5 actually documented:**

| Check | How | Failure mode it owns |
| --- | --- | --- |
| **Entity-count and cluster sanity** | Compare the extractor's `character` row count against a BookNLP run on the same text; flag a large gap in either direction | Over-merge (§2.2) and under-merge / no-disambiguation (§2.3) — the two opposite fatal errors |
| **MUC-vs-B³ divergence** | Score two independent extraction passes against each other with BookCoref's `evaluate.py`; a high MUC with a collapsed B³ is *evidence of* welded entities | The specific book-scale coreference failure (§2.2), diagnosable without gold data. **Weakened 2026-09-15:** BookCoref's Appendix G shows these metrics are partly biased toward low scores on full-book predictions regardless of merging (§2.2), so the divergence is a screening signal that warrants a look, not a proof of over-merge. Score in windows (`gold_window`) as well as full-book and compare the two, which is what separates the artifact from the error. |
| **Coverage of the source** | Fraction of source text spanned by extracted Scene Cards; unassigned runs of prose | Silently dropped middle-of-book material (§5: lost-in-the-middle, ConStory's mid-narrative clustering) |
| **Span grounding for every fact** | Require each `fact_ref`, `state_update` and `pays_off` edge to carry a source character offset, and verify the offset is in range and non-empty | Extraction-induced contradiction (§2.5). ConStory-Checker's "grounds each judgment in explicit textual evidence" is the precedent; an ungroundable claim is a hallucination by construction |
| **Round-trip / point-in-time replay** | Replay the seed through the extracted per-scene state updates to scene N and ask the TimeChara-style question: what is true, what is not yet true | Attribute drift and flattened-timeline extraction (§2.4) |
| **Boundary agreement between passes** | Two segmentation runs; report boundary F1 against each other | Segmentation instability (§3) — and it gives a number to compare against the γ 0.57–0.83 human noise floor |

**What a rubric must have a check for, even though it cannot be fully mechanical:**

- **Over-merged vs. split characters.** The single most damaging error, because ADR 0001's slug
  identity makes it unrecoverable downstream. It needs an explicit rubric row even if the check is
  "a human confirms the character list", because no automatic check is reliable here today.
- **Invented `fact_ref`s.** Nothing in the current schema distinguishes a fact the source asserts
  from one the extractor synthesised. Span grounding is the fix, and it implies an extraction-only
  field the Story Package does not currently have.
- **`must_stay_hidden` correctness.** This is the Syuzhet-critical field and the one with no
  extraction prior art at all (§4). A rubric that scores `reader_must_learn` but not
  `must_stay_hidden` scores the easy half.
- **Beat granularity.** `required_beats` density is our variance dial (ADR 0006). An extractor
  that produces plausible beats at the wrong granularity yields a valid package that performs
  badly, and no check in the list above would notice.

**What is not mechanically checkable, and should be stated as such rather than faked:** whether
the extracted Scene Card sequence is the *right* segmentation (§3's γ range says humans don't
agree either), whether a `dramatic_function` label is correct, and whether `centrality` on a
told-ledger row is calibrated. These are judgment calls; a rubric should route them to a human or
score them as agreement-with-a-reference-package, not pretend to a ground truth.

---

## 9. Open gaps the field has not solved

Stated plainly, because knowing where the floor drops out is more useful than a confident survey:

1. **No told-ledger extraction method exists** (§4). Not a sparse literature — an empty one.
2. **No novel-scale entity-attribute-over-time dataset exists.** OpenPI and ProPara are
   paragraph-scale procedural text; LitBank is 2,000-word excerpts; BookCoref annotates identity,
   not attributes. There is nothing to evaluate a World Model's temporal correctness against
   except a benchmark like TimeChara that tests a model's *knowledge* of famous novels rather than
   its *extraction* from arbitrary ones.
3. **Beat-level segmentation has no benchmark.** Scene segmentation does (§3); turning-point
   identification does, at six-per-film granularity. Nothing evaluates "are these the right beats
   inside this scene", which is what `required_beats` needs.
4. **Extraction-induced contradiction has no standard evaluation.** R² and ConStory-Checker each
   build a bespoke detector. There is no shared benchmark for "did the extractor introduce a
   contradiction the source doesn't have", which is precisely the ticket's sharpest question.
5. **Book-scale reasoning over fiction is near-chance** (NoCha, §5), and it is *worse* on
   speculative fiction with heavy world-building — which is the genre most likely to be handed to
   an extraction feature.

---

## 10. Recommendation: multi-pass, and which passes

> **Verification status (2026-09-15).** This recommendation names its dependencies, and they have
> now been opened and read rather than search-verified. NoCha, *Same Task, More Tokens* and
> *Lost in the Middle* (§5) all check out against their own abstracts and result text, and the
> *Same Task, More Tokens* degradation onset turns out to be **3,000 tokens**, not merely "before
> the context limit" — which strengthens this section rather than qualifying it. The
> identify/verify/filter precedent from the foreshadow–payoff pipeline (§4.6) is confirmed from
> the paper, though its dependency-length numbers turn out to be summary-sentence distances (see
> §4.6), which affects how those numbers may be quoted but not the staged-pipeline argument made
> here. **The multi-pass recommendation stands on verified evidence.**

**Extraction should be multi-pass, and the argument is not aesthetic — it is that the four
failure modes §2–§5 document have mutually incompatible fixes, so a single pass cannot be tuned
against all of them at once.** A single call that emits World Model rows, an event list and a
scene segmentation together must read the whole novel in one context (where NoCha puts book-scale
global reasoning over fiction at or below chance — no open-weight model above random, GPT-4o at
55.8% — *Same Task, More Tokens* puts accuracy at 0.92 → 0.68 starting from **3,000 tokens**, far
short of any context limit, and Lost-in-the-Middle plus ConStory both put the damage in the
middle), under one enormous response schema (which `gemini-capabilities.md` §1 shows is billed
on every call, uncacheable, `400`-rejectable, and unrecoverable on `MAX_TOKENS` because an
extraction call has no prose-first ordering to salvage), while simultaneously optimising for
recall on entities, precision on relations, and boundary agreement on scenes — three targets whose
known fixes are opposite passes: GraphRAG's gleaning loop is a *recall* re-ask, R²'s HAR is a
*precision* refinement, and every staged system from Recursively-Summarizing-Books to Story
Ribbons to the foreshadow–payoff pipeline's identify/verify/filter reaches the same shape
independently. So: **pass 1 — World Model rows over bounded windows** (BookNLP as a cheap
non-LLM proposal layer, an LLM pass to type, tier and slug them, then a gleaning re-ask for
recall and a dedup/reconcile step for the over-merge that §2.2 shows is the unrecoverable error);
**pass 2 — a chronological event list with per-event source spans**, which is where the seed
splits from the change list so the World Model is never flattened to an end-state; **pass 3 —
scene segmentation and Scene Card fields** (`required_beats`, `reader_must_learn`,
`must_stay_hidden`, entry/exit state) over the event list, not over raw prose, because §3's γ
0.57–0.83 human agreement and Chapter Captor's 0.453 say this pass is the least reliable and
should be given the most structured input we can hand it; **pass 4 — the `pays_off` plant/payoff
graph**, last, because ADR 0004's walk needs scene ids to exist before a plant can be named, and
because the one published pipeline for this sub-problem is itself identify-then-verify-then-filter;
and **the told-ledger is not a pass at all** — it is a mechanical replay over pass 3's
`reader_must_learn` fields (§4.7), which is the only reason we get it at all, since nothing in the
literature can extract it from prose. Between passes, every artifact stays small enough to check
cheaply, every pass gets its own bounded retry rather than one all-or-nothing call, and the whole
chain still terminates where #113 requires: one JSON object valid against
`DraftStoryPackageSchema`, landed as a Manuscript through the existing Import path, with a human
in the loop at exactly the step (§3) where the research says a human has to be.
