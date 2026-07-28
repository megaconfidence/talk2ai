const statusText = document.getElementById('statusText');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const clearChatButton = document.getElementById('clearChatButton');
const messagesArea = document.getElementById('messagesArea');
const voiceVisualizationArea = document.getElementById('voiceVisualizationArea');
const voiceBars = Array.from(voiceVisualizationArea.querySelectorAll('.voice-bar'));

const MIN_BAR_HEIGHT = 5;
const MAX_BAR_HEIGHT_MOBILE = 30;
const MAX_BAR_HEIGHT_DESKTOP = 40;
// Speech RMS sits well below 1.0, so scale it up before mapping to pixels.
const LEVEL_GAIN = 3;
// Middle bars peak highest, which reads as an equaliser rather than a row of
// identical blocks. Purely cosmetic — the input is a real measurement.
const BAR_WEIGHTS = [0.55, 0.8, 1, 0.8, 0.55];

let maxBarHeight = MAX_BAR_HEIGHT_MOBILE;

export const buttons = { startButton, stopButton, clearChatButton };

export function setStatus(text) {
	statusText.textContent = text;
}

export function updateButtonText() {
	const isMobile = window.innerWidth < 640;
	startButton.textContent = isMobile ? 'Start' : 'Start Conversation';
	stopButton.textContent = isMobile ? 'Stop' : 'Stop Conversation';
	clearChatButton.textContent = isMobile ? 'Clear' : 'Clear Chat';
	maxBarHeight = isMobile ? MAX_BAR_HEIGHT_MOBILE : MAX_BAR_HEIGHT_DESKTOP;
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

	messagesArea.scrollTop = messagesArea.scrollHeight;
}

/** Show the live partial transcript as a faded user bubble. */
let interimBubble = null;
export function setInterim(text) {
	if (!text) {
		interimBubble?.remove();
		interimBubble = null;
		return;
	}
	if (!interimBubble) {
		interimBubble = document.createElement('div');
		interimBubble.classList.add('message-bubble', 'user-message');
		interimBubble.style.opacity = '0.55';
		interimBubble.appendChild(document.createElement('p'));
		messagesArea.appendChild(interimBubble);
	}
	interimBubble.firstChild.textContent = text;
	messagesArea.scrollTop = messagesArea.scrollHeight;
}

export function clearMessages() {
	interimBubble = null;
	bubbles.length = 0;
	messagesArea.innerHTML = '';
}

export function showNotice(text) {
	const bubble = document.createElement('div');
	bubble.classList.add('message-bubble', 'ai-message');
	bubble.style.opacity = '0.7';
	const p = document.createElement('p');
	p.textContent = text;
	bubble.appendChild(p);
	messagesArea.appendChild(bubble);
	messagesArea.scrollTop = messagesArea.scrollHeight;
}

/** Drive the bars from the real mic RMS reported by the voice client. */
export function setAudioLevel(level) {
	const normalized = Math.min(1, Math.max(0, level) * LEVEL_GAIN);
	voiceBars.forEach((bar, i) => {
		const weight = BAR_WEIGHTS[i % BAR_WEIGHTS.length];
		const height = MIN_BAR_HEIGHT + (maxBarHeight - MIN_BAR_HEIGHT) * normalized * weight;
		bar.style.height = `${Math.round(height)}px`;
		bar.style.opacity = 0.5 + normalized * 0.5;
	});
}

export function resetAudioLevel() {
	voiceBars.forEach((bar) => {
		bar.style.height = `${MIN_BAR_HEIGHT}px`;
		bar.style.opacity = '0.5';
	});
}

export function setVisualizerVisible(visible) {
	voiceVisualizationArea.style.display = visible ? 'flex' : 'none';
}

export function setControls({ inCall, connected }) {
	startButton.disabled = inCall || !connected;
	stopButton.disabled = !inCall;
	clearChatButton.disabled = !connected;
}

updateButtonText();
window.addEventListener('resize', updateButtonText);
setVisualizerVisible(false);
resetAudioLevel();
