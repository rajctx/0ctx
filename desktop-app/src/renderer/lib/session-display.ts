import type { ChatSessionSummary } from '../../shared/types/domain';

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function stripPresentationMarkdown(value?: string | null) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .replace(/```[\s\S]*?```/g, (match) => {
      const inner = match
        .replace(/^```[^\n]*\n?/, '')
        .replace(/\n?```$/, '')
        .trim();
      return inner ? ` ${inner} ` : ' ';
    })
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function deriveSessionTitle(session: Pick<ChatSessionSummary, 'title' | 'summary' | 'sessionId'>) {
  const explicitTitle = stripPresentationMarkdown(session.title);
  if (explicitTitle) {
    return truncate(explicitTitle, 88);
  }

  const rawSummary = String(session.summary || '').trim();
  if (rawSummary.includes('->')) {
    const [prompt] = rawSummary.split(/\s*->\s*/, 1);
    const cleanedPrompt = stripPresentationMarkdown(prompt);
    if (cleanedPrompt) {
      return truncate(cleanedPrompt, 88);
    }
  }

  const firstLine = stripPresentationMarkdown(rawSummary.split(/\r?\n/).find((line) => line.trim()) || '');
  if (firstLine) {
    return truncate(firstLine, 88);
  }

  return truncate(session.sessionId, 48);
}

export function deriveSessionPreview(session: Pick<ChatSessionSummary, 'title' | 'summary' | 'sessionId'>) {
  const rawSummary = String(session.summary || session.title || session.sessionId || '').trim();
  const [, rhs = rawSummary] = rawSummary.split(/\s*->\s*/, 2);
  const cleaned = stripPresentationMarkdown(rhs || rawSummary);
  return truncate(cleaned || deriveSessionTitle(session), 260);
}
