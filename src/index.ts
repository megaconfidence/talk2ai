import { Agent, routeAgentRequest, type Connection } from 'agents';
import { withVoice, WorkersAIFluxSTT, WorkersAITTS, type VoiceTurnContext } from '@cloudflare/voice';
import { streamText } from 'ai';
import { createWorkersAI } from 'workers-ai-provider';
import { stripMarkdown } from './utils';

/**
 * Chosen by measuring, not by parameter count. Against llama-4-scout on the
 * same prompts: near-identical time-to-first-token (~250ms, dominated by
 * round-trip), but ~2.7x faster to finish a reply (425ms vs 1134ms p50) and
 * noticeably terser (26 vs 46 words on average) — which for a voice agent also
 * means less audio to synthesize.
 *
 * Avoid reasoning models here (qwen3-a3b, gemma-4-a4b, gpt-oss). They emit
 * `reasoning` deltas before any spoken content, so the first sentence — and
 * therefore the first audio — is delayed by the entire thinking pass.
 */
const LLM = '@cf/meta/llama-3.2-3b-instruct';

const SYSTEM_PROMPT = [
	'You are a helpful assistant in a spoken, real-time voice conversation.',
	'',
	'Your reply is read aloud by a text-to-speech engine, so:',
	'- Reply in plain spoken prose. Never use Markdown, bullet points, numbered',
	'  lists, headings, asterisks, or emoji — they get pronounced literally.',
	'- Keep answers to one or two short sentences unless asked for detail.',
	'- Write numbers, dates, and units the way a person would say them',
	'  ("about twenty dollars", not "~$20").',
	'- Never describe what you are doing, just answer.',
	'',
	'If a question is ambiguous, ask one short clarifying question.',
	'',
	// Without this the model reads the product names literally: it has described
	// a Durable Object as something "that retains its shape under stress", an R2
	// bucket as oilfield equipment, and KV as kilovolts. The second sentence is
	// load-bearing — an earlier version that only mentioned Cloudflare made the
	// model refuse off-topic questions ("that's not something we can discuss in
	// the context of Cloudflare Workers").
	'Workers, Durable Objects, R2, KV, D1, and Workers AI are Cloudflare developer',
	'products, not physical objects. Answer questions on every other topic normally.',
].join('\n');

const GREETING = "Hi! I'm listening — what would you like to talk about?";

/**
 * The voice pipeline (STT -> turn detection -> LLM -> sentence chunking -> TTS
 * -> playback) comes from the mixin. `historyLimit` caps how many prior
 * messages are replayed into the model, which bounds the context window; the
 * old hand-rolled version grew its history array forever.
 */
const VoiceAgentBase = withVoice(Agent, {
	historyLimit: 12,
	maxMessageCount: 200,
});

export class VoiceAgent extends VoiceAgentBase<Env> {
	/**
	 * Flux does end-of-turn detection server-side, which is what replaced the
	 * browser-side Silero VAD, the ONNX runtime, and the hand-written WAV
	 * encoder that used to live in public/vad/.
	 */
	transcriber = new WorkersAIFluxSTT(this.env.AI);

	/**
	 * Declared explicitly because `tts` has no implicit default — omit it and the
	 * agent transcribes but never speaks.
	 *
	 * Pass `{ speaker: "..." }` to change voice; "asteria" is the default.
	 */
	tts = new WorkersAITTS(this.env.AI);

	async onCallStart(connection: Connection) {
		// Only greet a fresh conversation; a reconnect resumes silently so the
		// user is not re-greeted mid-topic.
		if (this.getConversationHistory(1).length > 0) return;
		await this.speak(connection, GREETING);
	}

	beforeSynthesize(text: string) {
		const spoken = stripMarkdown(text);
		// Nothing pronounceable left (e.g. the model emitted only a bullet
		// marker) — skip the TTS call instead of synthesizing silence.
		return spoken.length > 0 ? spoken : null;
	}

	async onTurn(transcript: string, context: VoiceTurnContext) {
		const workersai = createWorkersAI({ binding: this.env.AI });

		const result = streamText({
			model: workersai(LLM as Parameters<typeof workersai>[0]),
			system: SYSTEM_PROMPT,
			messages: [
				...context.messages.map((m) => ({
					role: m.role as 'user' | 'assistant',
					content: m.content,
				})),
				{ role: 'user' as const, content: transcript },
			],
			// Aborted when the user talks over the reply. Without this the model
			// keeps generating tokens nobody will hear, and every remaining
			// sentence still gets synthesized and billed.
			abortSignal: context.signal,
		});

		return result.textStream;
	}

	/**
	 * App-level messages that are not part of the voice protocol. The voice
	 * mixin forwards anything it does not recognise here.
	 */
	async onMessage(connection: Connection, message: string | ArrayBuffer) {
		if (typeof message !== 'string') return;

		let payload: { type?: string };
		try {
			payload = JSON.parse(message);
		} catch {
			return;
		}

		if (payload.type === 'clear') {
			// The mixin persists turns to this table; there is no public API to
			// reset it, so clear it directly through the Agent's SQL handle.
			this.sql`DELETE FROM cf_voice_messages`;
			connection.send(JSON.stringify({ type: 'cleared' }));
		}
	}
}

export default {
	async fetch(request, env): Promise<Response> {
		return (await routeAgentRequest(request, env)) ?? env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;
