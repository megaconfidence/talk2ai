const root = document.documentElement;
const statusText = document.getElementById('statusText');
const callTimer = document.getElementById('callTimer');
const connPill = document.getElementById('connPill');
const connLabel = document.getElementById('connLabel');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const clearChatButton = document.getElementById('clearChatButton');
const messagesArea = document.getElementById('messagesArea');
const voiceVisualizationArea = document.getElementById('voiceVisualizationArea');
const voiceBars = document.getElementById('voiceBars');

// Speech RMS sits well below 1.0, so scale it up before mapping to the bars.
const LEVEL_GAIN = 3;

export const buttons = { startButton, stopButton, clearChatButton };

export function setStatus(text) {
	statusText.textContent = text;
}

/**
 * Reflect the call phase ('idle' | 'listening' | 'thinking' | 'speaking' |
 * 'error') on the root element. CSS keys the accent colour, the status dot and
 * the thinking ellipsis off this, so the JS never has to touch presentation.
 */
export function setPhase(phase) {
	root.dataset.phase = phase;
}

export function setError(message) {
	setPhase('error');
	setStatus(message);
}

/**
 * Render the transcript.
 *
 * The client streams an assistant reply by appending an empty message and then
 * growing its text, so the last bubble is updated in place rather than being
 * appended each time.
 */
const bubbles = [];
export function renderTranscript(messages) {
	messages.forEach((message, i) => {
		let bubble = bubbles[i];
		if (!bubble) {
			bubble = document.createElement('div');
			bubble.classList.add('message-bubble', message.role === 'user' ? 'user-message' : 'ai-message');
			bubble.appendChild(document.createElement('p'));
			messagesArea.appendChild(bubble);
			bubbles[i] = bubble;
		}
		const p = bubble.firstChild;
		if (p.textContent !== message.text) p.textContent = message.text;
	});

	// Drop any bubbles left over from a cleared conversation.
	while (bubbles.length > messages.length) {
		bubbles.pop().remove();
	}

	scrollToLatest();
}

/** Show the live partial transcript as a provisional user bubble. */
let interimBubble = null;
export function setInterim(text) {
	if (!text) {
		interimBubble?.remove();
		interimBubble = null;
		return;
	}
	if (!interimBubble) {
		interimBubble = document.createElement('div');
		interimBubble.classList.add('message-bubble', 'user-message', 'is-interim');
		interimBubble.appendChild(document.createElement('p'));
		messagesArea.appendChild(interimBubble);
	}
	interimBubble.firstChild.textContent = text;
	scrollToLatest();
}

export function clearMessages() {
	interimBubble = null;
	bubbles.length = 0;
	messagesArea.replaceChildren();
}

/** A centred pill for things neither party said, e.g. "chat cleared". */
export function showNotice(text) {
	const bubble = document.createElement('div');
	bubble.classList.add('message-bubble', 'is-notice');
	const p = document.createElement('p');
	p.textContent = text;
	bubble.appendChild(p);
	messagesArea.appendChild(bubble);
	scrollToLatest();
}

function scrollToLatest() {
	messagesArea.scrollTop = messagesArea.scrollHeight;
}

/**
 * Drive the bars from the real mic RMS reported by the voice client.
 *
 * Only a single custom property changes per frame; CSS scales each bar by its
 * own `--w` weight, so the equaliser shape and sizing stay in the stylesheet.
 */
export function setAudioLevel(level) {
	const normalized = Math.min(1, Math.max(0, level) * LEVEL_GAIN);
	voiceBars.style.setProperty('--level', normalized.toFixed(3));
}

export function resetAudioLevel() {
	voiceBars.style.setProperty('--level', '0');
}

/** Kept mounted at a flat baseline when inactive, so nothing reflows. */
export function setVisualizerVisible(visible) {
	voiceVisualizationArea.dataset.active = visible ? 'true' : 'false';
}

let timerId = null;
let callStartedAt = 0;

function tickTimer() {
	const seconds = Math.floor((Date.now() - callStartedAt) / 1000);
	callTimer.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Flux bills for wall-clock call duration, not words spoken, so surfacing how
 * long the mic has been open is a cost signal rather than decoration.
 */
function setTimerRunning(running) {
	if (running === Boolean(timerId)) return;
	if (running) {
		callStartedAt = Date.now();
		tickTimer();
		timerId = setInterval(tickTimer, 1000);
	} else {
		clearInterval(timerId);
		timerId = null;
		callTimer.textContent = '0:00';
	}
}

export function setControls({ inCall, connected }) {
	startButton.disabled = inCall || !connected;
	stopButton.disabled = !inCall;
	clearChatButton.disabled = !connected;

	root.dataset.call = inCall ? 'active' : 'idle';
	connPill.dataset.online = connected ? 'true' : 'false';
	connLabel.textContent = connected ? 'Connected' : 'Connecting';

	setTimerRunning(inCall);
}

setVisualizerVisible(false);
resetAudioLevel();
