/**
 * Fixture evaluation runner — M0.
 *
 * Runs MenuExtractionService over every fixture in <fixtures>/ (each a
 * directory with gold.json + photos/ + optional meta.json), scores each
 * run against the gold label, and writes a JSON report with ACTUAL
 * latency, token usage (incl. reasoning), retries, and cost per scan.
 * Nothing here is estimated: cost comes from the --input-price /
 * --output-price flags (defaults: GPT-6.1 Sol list prices $2/$10 per 1M,
 * printed in the report header — override for other providers).
 *
 * Usage:
 *   OPENAI_API_KEY=... bun scripts/evaluate.ts \
 *     --fixtures ../../fixtures/menus \
 *     --out ../../fixtures/menus/report-gpt-6.1-sol.json \
 *     --repeat 2
 *
 * No fixtures and no API key are provided by this repo. If the fixtures
 * directory is missing or empty, the runner exits with instructions —
 * it never invents menu photos or gold labels.
 */
import { readdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Effect, Layer, Schema } from "effect"
import { MenuExtraction } from "@traveevu/contracts"
import {
  MenuExtractionService,
  MenuExtractionServiceLive
} from "../src/ai/menu-extraction-service.js"
import { OpenAiProviderLive } from "../src/ai/providers/openai.js"
import { scoreExtraction, type ExtractionScore } from "../src/eval/scoring.js"

interface FixtureMeta {
  readonly difficulty?: string
  readonly notes?: string
}

interface RunResult {
  readonly fixture: string
  readonly run: number
  readonly difficulty: string
  readonly success: boolean
  readonly latencyMs: number
  readonly retries: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly reasoningTokens: number
  readonly costUsd: number | null
  readonly score: ExtractionScore | null
  readonly error: string | null
}

const parseArgs = (argv: Array<string>): Record<string, string> => {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg?.startsWith("--") && i + 1 < argv.length) {
      out[arg.slice(2)] = argv[i + 1]!
    }
  }
  return out
}

const percentile = (values: Array<number>, p: number): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!
}

const readJsonFile = (path: string, label: string) =>
  Effect.tryPromise({
    try: async () => JSON.parse(await readFile(path, "utf-8")) as unknown,
    catch: () => new Error(`${label}: cannot read ${path}`)
  })

const program = Effect.gen(function* () {
  const args = parseArgs(Bun.argv.slice(2))
  const fixturesDir = args.fixtures ?? join(import.meta.dir, "../../../fixtures/menus")
  const outPath = args.out ?? join(fixturesDir, "eval-report.json")
  const model = args.model ?? "gpt-6.1-sol"
  const repeat = Number(args.repeat ?? 1)
  const inputPrice = Number(args["input-price"] ?? 2)
  const outputPrice = Number(args["output-price"] ?? 10)

  const service = yield* MenuExtractionService

  const entries = yield* Effect.tryPromise({
    try: () => readdir(fixturesDir, { withFileTypes: true }),
    catch: () =>
      new Error(
        `Fixtures directory not found: ${fixturesDir}\n` +
          "Provide 10–20 real menu photo sets (see fixtures/README.md). " +
          "This runner never invents fixtures."
      )
  })
  const fixtureNames = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
  if (fixtureNames.length === 0) {
    return yield* Effect.fail(
      new Error(`No fixtures in ${fixturesDir}. See fixtures/README.md for the format.`)
    )
  }

  const results: Array<RunResult> = []
  for (const name of fixtureNames) {
    const dir = join(fixturesDir, name)
    const gold = Schema.decodeUnknownSync(MenuExtraction)(
      yield* readJsonFile(join(dir, "gold.json"), `Fixture ${name}`)
    )
    const meta = (yield* Effect.tryPromise({
      try: async () => {
        try {
          return JSON.parse(await readFile(join(dir, "meta.json"), "utf-8")) as FixtureMeta
        } catch {
          return {} as FixtureMeta
        }
      },
      catch: () => new Error(`Fixture ${name}: unreadable meta.json`)
    }))
    const photoNames = (
      yield* Effect.tryPromise({
        try: () => readdir(join(dir, "photos")),
        catch: () => new Error(`Fixture ${name}: missing photos/ directory`)
      })
    )
      .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
      .sort()
    const images = yield* Effect.forEach(photoNames, (file) =>
      Effect.gen(function* () {
        const buffer = yield* Effect.tryPromise({
          try: () => readFile(join(dir, "photos", file)),
          catch: () => new Error(`Fixture ${name}: cannot read photo ${file}`)
        })
        const ext = file.split(".").pop()?.toLowerCase()
        const mediaType = ext === "png"
          ? "image/png"
          : ext === "webp"
            ? "image/webp"
            : "image/jpeg"
        return { mediaType, data: `data:${mediaType};base64,${buffer.toString("base64")}` }
      })
    )

    for (let run = 1; run <= repeat; run++) {
      const started = Date.now()
      // Single attempt; the M0 service does not retry.
      const exit = yield* Effect.exit(service.extractMenu({ images }))
      const latencyMs = Date.now() - started
      if (exit._tag === "Failure") {
        results.push({
          fixture: name,
          run,
          difficulty: meta.difficulty ?? "unknown",
          success: false,
          latencyMs,
          retries: 0,
          inputTokens: 0,
          outputTokens: 0,
          reasoningTokens: 0,
          costUsd: null,
          score: null,
          error: String(exit.cause)
        })
      } else {
        const { extraction, usage } = exit.value
        const costUsd = (usage.inputTokens / 1_000_000) * inputPrice +
          (usage.outputTokens / 1_000_000) * outputPrice
        results.push({
          fixture: name,
          run,
          difficulty: meta.difficulty ?? "unknown",
          success: true,
          latencyMs,
          retries: 0,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          reasoningTokens: usage.reasoningTokens,
          costUsd,
          score: scoreExtraction(gold, extraction),
          error: null
        })
      }
      const last = results[results.length - 1]!
      console.log(`  ${name} run ${run}/${repeat}: ${last.success ? "ok" : "FAILED"} (${latencyMs}ms)`)
    }
  }

  const successes = results.filter((r) => r.success)
  const latencies = successes.map((r) => r.latencyMs)
  const totalSevere = successes.reduce((n, r) => n + (r.score?.severeFailures.length ?? 0), 0)
  const totalCost = successes.reduce((n, r) => n + (r.costUsd ?? 0), 0)
  const goldItems = successes.reduce((n, r) => n + (r.score?.goldItems ?? 0), 0)
  const report = {
    model,
    runAt: new Date().toISOString(),
    fixturesDir,
    repeat,
    pricesUsed: { inputPer1M: inputPrice, outputPer1M: outputPrice, currency: "USD" },
    notes: [
      "Costs computed from ACTUAL token usage reported by the provider.",
      "M0 service does not retry; retries = 0 for every run.",
      "Severe failures: price_mismatch, price_misassociated, invented_price, fabricated_option."
    ],
    totals: {
      runs: results.length,
      successes: successes.length,
      successRate: results.length === 0 ? 0 : successes.length / results.length,
      meanLatencyMs: latencies.length === 0
        ? 0
        : latencies.reduce((a, b) => a + b, 0) / latencies.length,
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: percentile(latencies, 95),
      totalInputTokens: successes.reduce((n, r) => n + r.inputTokens, 0),
      totalOutputTokens: successes.reduce((n, r) => n + r.outputTokens, 0),
      totalReasoningTokens: successes.reduce((n, r) => n + r.reasoningTokens, 0),
      totalCostUsd: totalCost,
      costPerSuccessfulScanUsd: successes.length === 0 ? null : totalCost / successes.length,
      severeFailures: totalSevere,
      severeFailuresPer100Items: goldItems === 0 ? null : (totalSevere / goldItems) * 100,
      goldItems,
      matchedItems: successes.reduce((n, r) => n + (r.score?.matchedItems ?? 0), 0)
    },
    runs: results
  }

  yield* Effect.tryPromise({
    try: () => writeFile(outPath, JSON.stringify(report, null, 2)),
    catch: (e) => new Error(`Cannot write report to ${outPath}: ${String(e)}`)
  })
  console.log(`\nReport: ${outPath}`)
  console.log(
    `Runs: ${report.totals.runs}, success: ${report.totals.successes}, ` +
      `mean latency: ${Math.round(report.totals.meanLatencyMs)}ms, ` +
      `cost/successful scan: $${report.totals.costPerSuccessfulScanUsd?.toFixed(4) ?? "n/a"}, ` +
      `severe failures: ${totalSevere}`
  )
})

const MainLive = program.pipe(
  Effect.provide(MenuExtractionServiceLive.pipe(Layer.provide(OpenAiProviderLive)))
)

Effect.runPromise(MainLive as Effect.Effect<void, unknown, never>).catch((e) => {
  console.error(`\nEvaluation failed: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
