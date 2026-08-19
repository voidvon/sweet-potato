import type { ReactNode } from 'react';
import './markdown.scss';

export function splitThinking(content: string) {
  const thoughts = Array.from(content.matchAll(/<think>([\s\S]*?)<\/think>/gi))
    .map((item) => item[1]?.trim())
    .filter(Boolean);
  const answer = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  return {
    answer: answer || content,
    thinking: thoughts.join('\n\n'),
  };
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>;
    }

    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    }

    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      return (
        <a href={link[2]} key={`${part}-${index}`} rel="noreferrer" target="_blank">
          {link[1]}
        </a>
      );
    }

    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

export function MarkdownContent({ content }: { content: string }) {
  const blocks = content.split(/(```[\s\S]*?```)/g).filter(Boolean);

  return (
    <div className="chat-markdown">
      {blocks.map((block, blockIndex) => {
        if (block.startsWith('```') && block.endsWith('```')) {
          const code = block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '');
          return (
            <pre key={`code-${blockIndex}`}>
              <code>{code}</code>
            </pre>
          );
        }

        const lines = block.split('\n');
        const rendered: ReactNode[] = [];
        let listItems: Array<{ kind: 'ol' | 'ul'; text: string }> = [];

        function flushList() {
          if (!listItems.length) {
            return;
          }

          const ListTag = listItems[0].kind;
          rendered.push(
            <ListTag key={`list-${blockIndex}-${rendered.length}`}>
              {listItems.map((item) => <li key={item.text}>{renderInlineMarkdown(item.text)}</li>)}
            </ListTag>,
          );
          listItems = [];
        }

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
          const line = lines[lineIndex];
          const trimmed = line.trim();
          if (!trimmed) {
            flushList();
            continue;
          }

          const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
          if (heading) {
            flushList();
            const level = heading[1].length;
            const HeadingTag = `h${level + 2}` as 'h3' | 'h4' | 'h5';
            rendered.push(<HeadingTag key={`h-${blockIndex}-${lineIndex}`}>{renderInlineMarkdown(heading[2])}</HeadingTag>);
            continue;
          }

          if (trimmed.startsWith('>')) {
            flushList();
            rendered.push(
              <blockquote key={`quote-${blockIndex}-${lineIndex}`}>
                {renderInlineMarkdown(trimmed.replace(/^>\s?/, ''))}
              </blockquote>,
            );
            continue;
          }

          const nextLine = lines[lineIndex + 1]?.trim();
          if (trimmed.includes('|') && /^\|?[\s:-]+\|[\s|:-]+$/.test(nextLine || '')) {
            flushList();
            const headers = trimmed.split('|').map((cell) => cell.trim()).filter(Boolean);
            const bodyRows: string[][] = [];
            lineIndex += 2;
            while (lineIndex < lines.length && lines[lineIndex].includes('|')) {
              bodyRows.push(lines[lineIndex].split('|').map((cell) => cell.trim()).filter(Boolean));
              lineIndex += 1;
            }
            lineIndex -= 1;
            rendered.push(
              <table key={`table-${blockIndex}-${rendered.length}`}>
                <thead>
                  <tr>{headers.map((header) => <th key={header}>{renderInlineMarkdown(header)}</th>)}</tr>
                </thead>
                <tbody>
                  {bodyRows.map((row, rowIndex) => (
                    <tr key={`row-${rowIndex}`}>
                      {headers.map((header, cellIndex) => (
                        <td key={`${header}-${cellIndex}`}>{renderInlineMarkdown(row[cellIndex] || '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>,
            );
            continue;
          }

          const unordered = trimmed.match(/^[-*]\s+(.+)$/);
          const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
          if (unordered || ordered) {
            const kind = ordered ? 'ol' : 'ul';
            if (listItems.length && listItems[0].kind !== kind) {
              flushList();
            }
            listItems.push({ kind, text: (unordered || ordered)?.[1] || trimmed });
            continue;
          }

          flushList();
          rendered.push(<p key={`p-${blockIndex}-${lineIndex}`}>{renderInlineMarkdown(trimmed)}</p>);
        }

        flushList();
        return <div key={`block-${blockIndex}`}>{rendered}</div>;
      })}
    </div>
  );
}
