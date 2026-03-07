function sanitizeText(text) {
  return text
    .replace(/\u00AD/g, '')   // soft hyphen (shown as ¿ in BBEdit)
    .replace(/\u200B/g, '')   // zero-width space
    .replace(/\u200C/g, '')   // zero-width non-joiner
    .replace(/\u200D/g, '')   // zero-width joiner
    .replace(/\uFEFF/g, '')   // BOM / zero-width no-break space
    .replace(/\u00A0/g, ' '); // non-breaking space → regular space
}

export function parseSRT(content) {
    const blocks = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n\n');
    return blocks.map((block) => {
      const [id, timeCode, ...textLines] = block.split('\n');
      const [startTime, endTime] = timeCode.split(' --> ');
      return {
        id: parseInt(id),
        startTime,
        endTime,
        text: sanitizeText(textLines.join('\n')),
      };
    });
  }
  
  export function stringifySRT(subtitles) {
    return subtitles
      .map(
        (sub) =>
          `${sub.id}\n${sub.startTime} --> ${sub.endTime}\n${sub.text}\n`
      )
      .join('\n');
  }