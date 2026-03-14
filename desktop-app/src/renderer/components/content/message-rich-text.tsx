import { Fragment } from 'react';

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; text: string };

function normalizeText(value: string) {
  let text = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.replace(/\s+(##\s+)/g, '\n$1');
  text = text.replace(/\s+\*\*(\d+\.\s[^*]+)\*\*/g, '\n$1');

  const lines: string[] = [];
  for (const originalLine of text.split('\n')) {
    const line = originalLine.trimEnd();
    const headingMatch = line.match(/^(#{1,6}\s+[^-]+?)\s+-\s+(.+)$/);
    if (headingMatch) {
      lines.push(headingMatch[1]);
      for (const item of headingMatch[2].split(/\s+-\s+/)) {
        const trimmed = item.trim();
        if (trimmed) {
          lines.push(`- ${trimmed}`);
        }
      }
      continue;
    }
    lines.push(line);
  }

  return lines.join('\n');
}

function parseBlocks(value: string): Block[] {
  const source = normalizeText(value);
  const lines = source.split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const current = lines[index].trim();
    if (!current) {
      index += 1;
      continue;
    }

    if (current.startsWith('```')) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({ kind: 'code', text: codeLines.join('\n').trim() });
      continue;
    }

    if (/^#{1,6}\s+/.test(current)) {
      blocks.push({ kind: 'heading', text: current.replace(/^#{1,6}\s+/, '').trim() });
      index += 1;
      continue;
    }

    if (/^\d+\.\s+/.test(current) || /^[-*+]\s+/.test(current)) {
      const ordered = /^\d+\.\s+/.test(current);
      const items: string[] = [];
      while (index < lines.length) {
        const line = lines[index].trim();
        if (!line) {
          index += 1;
          break;
        }
        if (ordered && /^\d+\.\s+/.test(line)) {
          items.push(line.replace(/^\d+\.\s+/, '').trim());
          index += 1;
          continue;
        }
        if (!ordered && /^[-*+]\s+/.test(line)) {
          items.push(line.replace(/^[-*+]\s+/, '').trim());
          index += 1;
          continue;
        }
        break;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const line = lines[index].trim();
      if (!line || line.startsWith('```') || /^#{1,6}\s+/.test(line) || /^\d+\.\s+/.test(line) || /^[-*+]\s+/.test(line)) {
        break;
      }
      paragraphLines.push(line);
      index += 1;
    }
    blocks.push({ kind: 'paragraph', text: paragraphLines.join(' ') });
  }

  return blocks;
}

function renderInline(value: string) {
  const normalized = value.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const parts = normalized.split(/(<strong>.*?<\/strong>|<code>.*?<\/code>)/g).filter(Boolean);

  return parts.map((part, index) => {
    if (part.startsWith('<strong>') && part.endsWith('</strong>')) {
      return <strong key={index}>{part.slice(8, -9)}</strong>;
    }
    if (part.startsWith('<code>') && part.endsWith('</code>')) {
      return <code key={index} className="msg-inline-code">{part.slice(6, -7)}</code>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

export function MessageRichText({ content }: { content: string }) {
  const blocks = parseBlocks(content);

  return (
    <div className="msg-rich">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'heading':
            return (
              <div key={index} className="msg-heading">
                {renderInline(block.text)}
              </div>
            );
          case 'list': {
            const ListTag = block.ordered ? 'ol' : 'ul';
            return (
              <ListTag key={index} className={block.ordered ? 'msg-list ordered' : 'msg-list'}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{renderInline(item)}</li>
                ))}
              </ListTag>
            );
          }
          case 'code':
            return (
              <pre key={index} className="msg-code">
                {block.text}
              </pre>
            );
          case 'paragraph':
          default:
            return (
              <p key={index} className="msg-paragraph">
                {renderInline(block.text)}
              </p>
            );
        }
      })}
    </div>
  );
}
