# Fixture menus — evaluation data (NOT provided by this repo)

Each fixture is one complete scanning session (one menu), in its own
directory under `fixtures/menus/`:

```
fixtures/menus/
  pho-hoa-d1/
    photos/
      page-1.jpg
      page-2.jpg
    gold.json      # manually verified MenuExtraction for the whole session
    meta.json      # { "difficulty": "typical" | "dense", "notes": "..." }
  ...
```

Rules (from the evaluation plan):

- 10–20 real Vietnamese menu photos from HCMC District 1, District 3,
  Bình Thạnh. No scraped menus. Mix typical + dense/difficult (glare,
  blur, multi-page, handwritten, mixed Vietnamese/English).
- Sessions, not isolated images: multi-photo menus are evaluated as one
  complete scanning session.
- `gold.json` is manually verified. Illegible fields are `null` + an
  uncertainty entry — never guessed. The decisive case is
  `Trà đào — Size M 35k / L 45k`: the gold label must keep M→35k and
  L→45k associated.
- Run the harness with `OPENAI_API_KEY=... bun run --cwd apps/api evaluate`
  (see `apps/api/scripts/evaluate.ts` for flags).

Whether fixtures are committed to this public repo is the maintainer's
call — they are user-provided data, not code.
