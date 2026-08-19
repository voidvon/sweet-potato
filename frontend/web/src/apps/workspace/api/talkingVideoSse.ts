export function parseSseBlocks<T>(buffer: string, options: {
  final?: boolean;
  revive: (data: string) => T;
}) {
  const blocks = buffer.split(/\r?\n\r?\n/u);
  const trailing = options.final ? '' : blocks.pop() || '';
  const events: T[] = [];
  blocks.forEach((block) => {
    const data = block.split(/\r?\n/u)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.replace(/^data:\s?/u, ''))
      .join('\n');
    if (!data) return;
    events.push(options.revive(data));
  });

  if (options.final && trailing.trim()) {
    const data = trailing.split(/\r?\n/u)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.replace(/^data:\s?/u, ''))
      .join('\n');
    if (data) {
      events.push(options.revive(data));
    }
  }

  return {
    events,
    trailing,
  };
}

export function createUtf8SseEventParser<T>(revive: (data: string) => T) {
  const decoder = new TextDecoder();
  let buffer = '';

  return {
    finish() {
      buffer += decoder.decode();
      const parsed = parseSseBlocks(buffer, { final: true, revive });
      buffer = '';
      return parsed.events;
    },
    push(chunk: Uint8Array) {
      buffer += decoder.decode(chunk, { stream: true });
      const parsed = parseSseBlocks(buffer, { revive });
      buffer = parsed.trailing;
      return parsed.events;
    },
  };
}
