# talk2ai

This is a real-time voice-based chat application that allows users to have spoken conversations with an AI. It runs entirely on Cloudflare: the [`@cloudflare/voice`](https://developers.cloudflare.com/agents/communication-channels/voice/) Agents SDK handles the voice pipeline, and Workers AI provides Speech-to-Text (STT), Large Language Model (LLM) inference, and Text-to-Speech (TTS).

[🚀🚀🚀 Live Demo](https://talk2ai.conflare.workers.dev/)

## 🚀 Deploy your own

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/megaconfidence/talk2ai)

One click clones this repo into your own GitHub account, provisions the Durable Object and Workers AI bindings, and deploys. There are no secrets or API keys to configure — Workers AI is a binding, and STT, LLM, and TTS all run on it.

It runs on the **Workers Free plan**. See [A note on cost](#-a-note-on-cost) for what the free daily allowance buys you.

> Your first deploy logs a `stale_tombstone` notice for `MyDurableObject`. That is expected — it retires a class from this project's pre-Agents-SDK version, and it does not exist on a new account. Delete that entry from `exports` in `wrangler.jsonc` to silence it.

## ✨ Features

- **Real-time Voice Interaction:** Speak directly to the AI and hear its responses.
- **Model-Driven Turn Detection:** Deepgram Flux detects end-of-turn server-side, so there is no browser VAD, ONNX runtime, or WAV encoding to ship.
- **Streaming AI Responses:** Replies are sentence-chunked and synthesized as they stream, so the AI starts speaking before it finishes thinking.
- **True Barge-In:** Talking over the AI aborts LLM generation and TTS server-side via an `AbortSignal`, instead of only muting local playback.
- **Persistent Chat History:** Conversation turns are stored in the Durable Object's SQLite database and survive reconnects.
- **Live Transcription:** Partial transcripts render as you speak.
- **Free-Plan Friendly:** SQLite-backed Durable Objects keep it inside the Workers Free plan's limits.
- **No Build Step:** The frontend is plain ES modules; the voice client loads from a CDN.

## 🚀 How It Works

![Architecture Diagram](arch.png)

The application facilitates a voice conversation between a user and an AI through a series of steps orchestrated between the frontend (browser) and the backend (Cloudflare Workers).

<details>
<summary>Frontend</summary>

### Frontend (Client-Side)

The frontend uses `VoiceClient` from `@cloudflare/voice/client`, loaded as an ES module from a CDN so the project keeps its zero-build-step setup.

1.  **Connection:** `client.connect()` opens a reconnecting WebSocket to the `VoiceAgent` Durable Object.
2.  **Starting a Call:** Clicking "Start" calls `client.startCall()`, which requests microphone access and streams 16 kHz mono PCM to the agent as binary frames. The client owns mic capture, playback, and interrupt detection.
3.  **Rendering:** The client exposes reactive state that the UI subscribes to:
    - `transcriptchange` — the full conversation. Assistant replies arrive as an empty message that grows via deltas, so the last bubble is updated in place.
    - `interimtranscript` — the live partial transcript of what you are currently saying.
    - `statuschange` — `idle` / `listening` / `thinking` / `speaking`.
    - `audiolevelchange` — real mic RMS (0–1), which drives the visualizer bars.
    - `metricschange` — per-turn latency breakdown, logged to the console.
4.  **Controls:**
    - **Start / Stop:** `client.startCall()` and `client.endCall()`.
    - **Clear Chat:** Sends `{ type: 'clear' }` to the agent, which deletes the persisted history.

</details>

<details>
<summary>Backend</summary>

### Backend (Cloudflare Worker with Durable Object)

The backend is an Agent (a SQLite-backed Durable Object) with the `withVoice` mixin applied. The mixin owns the pipeline; the app only supplies providers and an `onTurn` handler.

1.  **Routing:** `routeAgentRequest` handles the WebSocket upgrade and dispatches to the `VoiceAgent` class. Anything it does not claim falls through to the `ASSETS` binding.
2.  **Providers** (`src/index.ts`):
    - `transcriber` — `WorkersAIFluxSTT` (`@cf/deepgram/flux`). A single session lives for the whole call and fires an utterance when the model detects end-of-turn.
    - `tts` — `WorkersAITTS` (`@cf/deepgram/aura-1`), the SDK default. See "A note on cost" below.
3.  **Greeting:** `onCallStart` speaks a greeting, but only when there is no prior history, so reconnects resume silently.
4.  **LLM Inference:** `onTurn` receives the transcript plus `context.messages` (history from SQLite) and returns `streamText(...).textStream` from `@cf/meta/llama-3.2-3b-instruct`. `context.signal` is passed as `abortSignal`, so a barge-in cancels generation rather than paying for tokens nobody hears.
5.  **Sentence Chunking & TTS:** The mixin splits the token stream into sentences and synthesizes them in order.
6.  **Markdown Stripping:** `beforeSynthesize` runs `stripMarkdown` so the TTS never reads `**` or bullet markers aloud, even when the model ignores the system prompt.
7.  **Persistence:** Turns are written to SQLite. `historyLimit` caps how many are replayed into the model, which bounds the context window.

</details>

### Data Flow Summary

User Speech → Mic PCM (Client) → WebSocket → Durable Object → Flux STT (turn detection) → Transcript (to Client & LLM) → Llama 3.2 3B Stream → Sentence Chunking → aura-1 TTS → Audio → WebSocket → Client (Play Audio & Display Text)

## ⚙️ Local development

```
git clone https://github.com/megaconfidence/talk2ai
cd talk2ai
npm install
npm run dev
```

Workers AI has no local simulator, so `wrangler dev` proxies the `AI` binding to the real service and you need to be logged in (`npx wrangler login`). Deploy with `npm run deploy`.

## 🧠 Model choice

`@cf/meta/llama-3.2-3b-instruct`, picked by measuring rather than by parameter count.

The metric that matters is **time to first *sentence***, not time to first token and not time to full completion. TTFT is dominated by round-trip and barely varies between models, while full completion is irrelevant because the pipeline chunks on sentence boundaries and starts synthesizing immediately. What the user actually waits for is the first sentence, plus TTS.

Measured across every text-generation model on Workers AI, 12 samples each:

| Model | Time to first sentence (p50) | + TTS = first audio |
| --- | --- | --- |
| **`llama-3.2-3b-instruct`** | **465 ms** | **~823 ms** |
| `mistral-small-3.1-24b` | 663 ms | ~1021 ms |
| `llama-3.2-1b-instruct` | 748 ms | ~1106 ms |
| `granite-4.0-h-micro` | 951 ms | ~1309 ms |
| `llama-4-scout-17b` | 1128 ms | ~1486 ms |
| `llama-3.3-70b-fp8-fast` | 1333 ms | ~1691 ms |
| `llama-3.1-8b-instruct-fp8` | 2774 ms | ~3132 ms |

Two things worth knowing before you swap the model:

**Avoid reasoning models.** `qwen3-30b-a3b`, `gemma-4-26b-a4b`, `gpt-oss-20b`, and `glm-4.7-flash` all stream `reasoning` deltas and return `content: null`, so the first audio is delayed by the entire thinking pass. The "flash" in `glm-4.7-flash` refers to the model family, not to latency.

**Small models are weak on Cloudflare's own vocabulary.** Out of the box, 3B described a Durable Object as something that "retains its shape under stress", an R2 bucket as oilfield equipment, and KV as kilovolts. The last two lines of `SYSTEM_PROMPT` fix this for about 40 ms. Note the phrasing is deliberate: an earlier version that only established the Cloudflare context caused the model to refuse off-topic questions entirely ("that's not something we can discuss in the context of Cloudflare Workers"), which is why it explicitly grants permission to answer everything else.

If you want stronger factual answers and can spend ~200 ms, `mistral-small-3.1-24b` was the most accurate model tested and needs no prompt patch. If free-plan runway matters more than latency, `granite-4.0-h-micro` is ~3x cheaper per token and far terser, which also cuts the TTS bill.

## 💸 A note on cost

Everything runs on Workers AI, so cost is measured in neurons — 10,000 free per day.

Almost none of that goes on the LLM. Speech is the expensive part — and the STT half is charged by the clock, not by how much you say. Flux bills per audio minute of the **call**: the transcriber session streams continuously from `startCall` to `endCall`, so an open call with nobody talking still costs about 700 neurons a minute.

Roughly, per minute of conversation:

| Component | Neurons / min | Share |
| --- | --- | --- |
| Flux STT | ~700 | ~52% |
| `aura-1` TTS | ~650 | ~48% |
| `llama-3.2-3b` | ~18 | <2% |

That works out to about **7 minutes of conversation per day** on the free plan. Ending calls promptly matters more than talking less.

## ⚠️ Known Issues & Limitations

- **Beta SDK:** `@cloudflare/voice` is in beta and its API may change.
- **Free-Plan Ceiling:** About 7 minutes of conversation per day. Flux bills for the whole call, so an idle open call still costs ~700 neurons per minute.
- **Local dev behind WARP:** With Cloudflare WARP and Gateway enabled, the `AI` binding may fail with `InferenceUpstreamError: 403` in `wrangler dev`, even though the same calls succeed over the REST API. Disconnecting WARP is the quickest workaround.

## 🤝 Contributing

Issues and PRs are welcome.
