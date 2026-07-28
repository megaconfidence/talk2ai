/**
 * Strip Markdown syntax so TTS does not read punctuation aloud.
 *
 * The system prompt already asks the model for plain speech, but prompts leak —
 * models slip back into bullet lists and bold text, and the voice then says
 * "star star important star star". This runs in `beforeSynthesize` so the
 * spoken audio is clean regardless of what the model returns. The transcript
 * shown in the UI keeps the original text.
 */
export function stripMarkdown(text: string): string {
	return (
		text
			// Fenced code blocks -> their contents
			.replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, '$1')
			// Inline code
			.replace(/`([^`]+)`/g, '$1')
			// Images -> alt text, before links so the leading ! is consumed
			.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
			// Links -> label
			.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
			// Bold / italic / strikethrough
			.replace(/(\*\*|__)(.*?)\1/g, '$2')
			.replace(/(\*|_)(.*?)\1/g, '$2')
			.replace(/~~(.*?)~~/g, '$1')
			// ATX headings
			.replace(/^#{1,6}\s+/gm, '')
			// Blockquotes
			.replace(/^\s*>\s?/gm, '')
			// Unordered list markers
			.replace(/^\s*[-*+]\s+/gm, '')
			// Horizontal rules
			.replace(/^\s*([-*_])\s*(?:\1\s*){2,}$/gm, '')
			// Collapse the whitespace the substitutions leave behind
			.replace(/[ \t]{2,}/g, ' ')
			.replace(/\n{3,}/g, '\n\n')
			.trim()
	);
}
