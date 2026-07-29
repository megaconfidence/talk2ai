import { VoiceClient } from 'https://cdn.jsdelivr.net/npm/@cloudflare/voice@0.3.5/client/+esm';
import {
	buttons,
	clearMessages,
	renderTranscript,
	resetAudioLevel,
	setAudioLevel,
	setControls,
	setError,
	setInterim,
	setPhase,
	setStatus,
	setVisualizerVisible,
	showNotice,
} from './ui.js';

const { startButton, stopButton, clearChatButton } = buttons;

// No trailing ellipses — CSS animates its own for the "thinking" phase.
const STATUS_LABEL = {
	idle: 'Ready to talk',
	listening: 'Listening',
	thinking: 'Thinking',
	speaking: 'Speaking',
};

/**
 * `agent` matches the exported Durable Object class name in src/index.ts. The
 * client kebab-cases it to build the WebSocket URL, so this must stay in sync
 * with the `class_name` in wrangler.jsonc.
 */
const client = new VoiceClient({ agent: 'VoiceAgent' });

// The client keeps every message it has seen. "Clear" wipes server-side history
// and moves this offset so the cleared turns stop being rendered.
let clearOffset = 0;
let connected = false;
let inCall = false;

function syncControls() {
	setControls({ inCall, connected });
}

client.addEventListener('connectionchange', (isConnected) => {
	connected = isConnected;
	if (!isConnected) setStatus('Reconnecting');
	else if (!inCall) setStatus(STATUS_LABEL.idle);
	syncControls();
});

client.addEventListener('statuschange', (status) => {
	inCall = status !== 'idle';
	setPhase(status);
	setStatus(STATUS_LABEL[status] ?? status);
	setVisualizerVisible(inCall);
	if (!inCall) resetAudioLevel();
	syncControls();
});

client.addEventListener('transcriptchange', (messages) => {
	renderTranscript(messages.slice(clearOffset));
});

client.addEventListener('interimtranscript', (text) => setInterim(text));

client.addEventListener('audiolevelchange', (level) => {
	if (inCall) setAudioLevel(level);
});

client.addEventListener('error', (message) => {
	if (message) setError(message);
});

// Latency breakdown per turn — the hand-rolled pipeline had no visibility here.
client.addEventListener('metricschange', (metrics) => {
	if (metrics) console.log('[voice] metrics', metrics);
});

startButton.addEventListener('click', async () => {
	try {
		await client.startCall();
	} catch (error) {
		console.error('Failed to start call:', error);
		setError('Could not access the microphone');
	}
});

stopButton.addEventListener('click', () => client.endCall());

clearChatButton.addEventListener('click', () => {
	client.sendJSON({ type: 'clear' });
	clearOffset = client.transcript.length;
	clearMessages();
	setInterim(null);
	showNotice('Chat cleared');
});

setStatus('Connecting');
syncControls();
client.connect();
