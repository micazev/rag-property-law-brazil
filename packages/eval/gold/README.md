# Golden set

`questions.jsonl` — one question per line:

```json
{"id":"cc-001","question":"A partir de quando o comprador passa a ser dono do imóvel?","type":"paraphrase","gold":[{"norm":"lei-10406-2002","article":"1.245"}],"status":"reviewed","note":"caput + §1º"}
```

| Field | Meaning |
|---|---|
| `id` | Unique. Prefix by norm or topic (`cc-`, `lrp-`, `af-`). |
| `question` | Written the way a buyer, broker or lawyer would ask it, in Portuguese. |
| `type` | `reference` names the article; `paraphrase` asks about the rule without naming it; `multi` needs two or more articles; `unanswerable` is in scope but the corpus does not answer it; `out_of_scope` is outside property/registry law. |
| `gold` | Every article needed to answer, as `{norm, article}`. `norm` is a slug from `packages/corpus/src/manifest.ts`; `article` is written as in the law (`1.245`, `5º`, `185-A`). Empty for `unanswerable` / `out_of_scope`. |
| `status` | `draft` until someone checked the question and the articles against the fetched text; then `reviewed`. `--reviewed-only` scores only those. |
| `note` | Optional: which paragraph answers it, why an article is or is not in the gold. |

## Labeling rules

- **Gold = the articles a correct answer must cite**, not every related article.
  If the rule is in a § of article 1.245, the gold is `1.245`.
- **Paraphrases must not reuse the article's wording.** A question that copies
  the statute measures string matching, not retrieval.
- **An article the manifest filters out cannot be gold.** The runner fails on
  any gold article missing from the chunked corpus, so a typo or a filter gap
  is caught before it is scored as a miss.
- **Unanswerable and out-of-scope questions are not scored for retrieval** —
  they exist for the answer step's refusal gates.
