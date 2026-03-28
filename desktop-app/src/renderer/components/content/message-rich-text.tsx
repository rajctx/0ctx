import { Fragment, type ReactNode } from 'react';
import { desktopBridge } from '../../lib/bridge';
import { parseMarkdownBlocks } from '../../lib/message-markdown';

function renderTextWithBreaks(value: string, keyPrefix: string) {
  const segments = value.split('\n');
  return segments.map((segment, index) => (
    <Fragment key={`${keyPrefix}-${index}`}>
      {index > 0 ? <br /> : null}
      {segment}
    </Fragment>
  ));
}

function normalizeLinkTarget(href: string) {
  const trimmed = href.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return { kind: 'external' as const, target: trimmed };
  }
  if (/^\/[A-Za-z]:\//.test(trimmed)) {
    return { kind: 'path' as const, target: trimmed.slice(1) };
  }
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return { kind: 'path' as const, target: trimmed };
  }
  if (/^file:\/\//i.test(trimmed)) {
    const normalized = trimmed.replace(/^file:\/\//i, '');
    return { kind: 'path' as const, target: normalized.replace(/^\/([A-Za-z]:\/)/, '$1') };
  }
  return null;
}

async function openMarkdownTarget(href: string) {
  const resolved = normalizeLinkTarget(href);
  if (!resolved) {
    return;
  }
  if (resolved.kind === 'external') {
    await desktopBridge.shell.openExternal(resolved.target);
    return;
  }
  await desktopBridge.shell.openPath(resolved.target.replace(/\//g, '\\'));
}

function renderInline(value: string): ReactNode[] {
  const pattern = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      const text = value.slice(lastIndex, match.index);
      nodes.push(
        <Fragment key={`text-${lastIndex}`}>
          {renderTextWithBreaks(text, `text-${lastIndex}`)}
        </Fragment>
      );
    }

    if (match[1] && match[2]) {
      const href = match[2];
      nodes.push(
        <a
          key={`link-${match.index}`}
          href={href}
          className="msg-link"
          onClick={(event) => {
            event.preventDefault();
            void openMarkdownTarget(href);
          }}
        >
          {match[1]}
        </a>
      );
    } else if (match[3]) {
      nodes.push(<strong key={`strong-${match.index}`}>{renderTextWithBreaks(match[3], `strong-${match.index}`)}</strong>);
    } else if (match[4]) {
      nodes.push(<code key={`code-${match.index}`} className="msg-inline-code">{match[4]}</code>);
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < value.length) {
    const text = value.slice(lastIndex);
    nodes.push(
      <Fragment key={`text-${lastIndex}`}>
        {renderTextWithBreaks(text, `text-${lastIndex}`)}
      </Fragment>
    );
  }

  return nodes;
}

export function MessageRichText({
  content,
  compact = false
}: {
  content: string;
  compact?: boolean;
}) {
  const blocks = parseMarkdownBlocks(content);

  return (
    <div className={compact ? 'msg-rich compact' : 'msg-rich'}>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'heading':
            return (
              <div key={index} className={`msg-heading level-${block.level}`}>
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
          case 'table':
            return (
              <div key={index} className="msg-table-wrap">
                <table className="msg-table">
                  <thead>
                    <tr>
                      {block.headers.map((header, headerIndex) => (
                        <th key={headerIndex}>{renderInline(header)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex}>{renderInline(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
