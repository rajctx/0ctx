export type MarkdownBlock =
  | { kind: 'heading'; text: string; level: number }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; text: string; language: string | null }
  | { kind: 'table'; headers: string[]; rows: string[][] };

function normalizeMarkdownText(value: string) {
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

function splitTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableSeparatorLine(line: string) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isTableHeaderLine(line: string) {
  return /\|/.test(line) && splitTableRow(line).length > 1;
}

export function parseMarkdownBlocks(value: string): MarkdownBlock[] {
  const source = normalizeMarkdownText(value);
  const lines = source.split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const current = lines[index].trim();
    if (!current) {
      index += 1;
      continue;
    }

    if (current.startsWith('```')) {
      const language = current.slice(3).trim() || null;
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({ kind: 'code', text: codeLines.join('\n').trim(), language });
      continue;
    }

    if (/^#{1,6}\s+/.test(current)) {
      const hashes = current.match(/^#{1,6}/)?.[0].length ?? 1;
      blocks.push({ kind: 'heading', text: current.replace(/^#{1,6}\s+/, '').trim(), level: hashes });
      index += 1;
      continue;
    }

    if (
      index + 1 < lines.length
      && isTableHeaderLine(lines[index])
      && isTableSeparatorLine(lines[index + 1])
    ) {
      const headers = splitTableRow(lines[index]);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length) {
        const line = lines[index].trim();
        if (!line || !isTableHeaderLine(line) || isTableSeparatorLine(line)) {
          break;
        }
        rows.push(splitTableRow(line));
        index += 1;
      }
      blocks.push({ kind: 'table', headers, rows });
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
      const line = lines[index];
      const trimmed = line.trim();
      if (
        !trimmed
        || trimmed.startsWith('```')
        || /^#{1,6}\s+/.test(trimmed)
        || /^\d+\.\s+/.test(trimmed)
        || /^[-*+]\s+/.test(trimmed)
        || (
          index + 1 < lines.length
          && isTableHeaderLine(lines[index])
          && isTableSeparatorLine(lines[index + 1])
        )
      ) {
        break;
      }
      paragraphLines.push(line.trimEnd());
      index += 1;
    }
    blocks.push({ kind: 'paragraph', text: paragraphLines.join('\n').trim() });
  }

  return blocks;
}
