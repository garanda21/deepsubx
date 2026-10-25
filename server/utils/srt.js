function sanitizeText(text) {
  return text
    .replace(/\u00AD/g, '')   // soft hyphen (shown as ¿ in BBEdit)
    .replace(/\u200B/g, '')   // zero-width space
    .replace(/\u200C/g, '')   // zero-width non-joiner
    .replace(/\u200D/g, '')   // zero-width joiner
    .replace(/\uFEFF/g, '')   // BOM / zero-width no-break space
    .replace(/\u00A0/g, ' '); // non-breaking space → regular space
}

const TIMECODE_LINE = /^\s*\S+\s+-->\s+\S+/;

export function parseSRT(content) {
    const lines = content.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    // A block starts at a numeric id followed by a timecode line. Finding blocks
    // this way (instead of splitting on blank lines) keeps blocks with empty text.
    const starts = [];
    for (let i = 1; i < lines.length; i++) {
      if (TIMECODE_LINE.test(lines[i]) && /^\d+$/.test(lines[i - 1].trim())) {
        starts.push(i - 1);
      }
    }

    return starts.map((start, n) => {
      const end = n + 1 < starts.length ? starts[n + 1] : lines.length;
      const textLines = lines.slice(start + 2, end);
      while (textLines.length > 0 && textLines[textLines.length - 1].trim() === '') {
        textLines.pop();
      }
      const [startTime, endTime] = lines[start + 1].split(' --> ').map(part => part.trim());
      return {
        id: parseInt(lines[start].trim()),
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