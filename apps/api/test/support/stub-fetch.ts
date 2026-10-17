/**
 * Test support: a stubbed fetch transport for @effect/ai-openai.
 *
 * Provides a canned Responses API envelope and captures outgoing requests.
 * Provide the stub via Layer.succeed(FetchHttpClient.Fetch, stub) — never
 * by mutating globalThis.fetch, which races across test files.
 */

export interface CapturedRequest {
  readonly url: string
  readonly body: unknown
}

const readBody = async (b: unknown): Promise<unknown> => {
  if (typeof b === "string") return JSON.parse(b)
  if (b instanceof Uint8Array) return JSON.parse(new TextDecoder().decode(b))
  if (b != null && typeof (b as ReadableStream<Uint8Array>).getReader === "function") {
    const reader = (b as ReadableStream<Uint8Array>).getReader()
    const chunks: Array<Uint8Array> = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
    const total = chunks.reduce((n, c) => n + c.length, 0)
    const all = new Uint8Array(total)
    let offset = 0
    for (const c of chunks) {
      all.set(c, offset)
      offset += c.length
    }
    return JSON.parse(new TextDecoder().decode(all))
  }
  return b
}

export const cannedResponsesApi = (text: string) => ({
  id: "resp_test",
  object: "response",
  model: "gpt-6.1-sol",
  created_at: 0,
  status: "completed",
  output: [
    {
      id: "msg_test",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text, annotations: [] }]
    }
  ],
  usage: {
    input_tokens: 10,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 5,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 15
  }
})

export const createStubFetch = (canned: unknown) => {
  const captured: Array<CapturedRequest> = []
  const stub = (async (input: unknown, init?: { body?: unknown }) => {
    captured.push({ url: String(input), body: await readBody(init?.body) })
    return new Response(JSON.stringify(canned), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  }) as typeof fetch
  return { stub, captured }
}
