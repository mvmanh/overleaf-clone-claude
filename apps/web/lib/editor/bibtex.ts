import { type StreamParser } from '@codemirror/language';

interface BibState {
  /** Brace depth inside an entry body. */
  depth: number;
  inEntry: boolean;
  inString: boolean;
}

/** Small BibTeX tokenizer: entry types, keys, field names, braces and strings. */
export const bibtex: StreamParser<BibState> = {
  name: 'bibtex',
  startState: () => ({ depth: 0, inEntry: false, inString: false }),
  token(stream, state) {
    if (state.inString) {
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === '\\') stream.next();
        else if (ch === '"') {
          state.inString = false;
          break;
        }
      }
      return 'string';
    }
    if (stream.eatSpace()) return null;
    if (!state.inEntry) {
      if (stream.match(/^@[A-Za-z]+/)) {
        state.inEntry = true;
        return 'keyword';
      }
      if (stream.match(/^%.*/)) return 'comment';
      stream.next();
      return 'comment'; // text outside entries is ignored by BibTeX
    }
    if (stream.peek() === '{' || stream.peek() === '(') {
      stream.next();
      state.depth++;
      if (state.depth === 1 && stream.match(/^\s*[^,\s=]+(?=\s*,)/)) return 'labelName';
      return 'bracket';
    }
    if (stream.peek() === '}' || stream.peek() === ')') {
      stream.next();
      state.depth--;
      if (state.depth <= 0) {
        state.depth = 0;
        state.inEntry = false;
      }
      return 'bracket';
    }
    if (stream.peek() === '"') {
      stream.next();
      state.inString = true;
      return 'string';
    }
    if (state.depth === 1 && stream.match(/^[A-Za-z][\w-]*(?=\s*=)/)) return 'propertyName';
    if (stream.match(/^\d+/)) return 'number';
    if (stream.match(/^\\[A-Za-z]+/)) return 'keyword';
    if (stream.match(/^[=,#]/)) return 'operator';
    stream.next();
    return state.depth > 1 ? 'string' : null;
  },
  languageData: { commentTokens: { line: '%' } },
};
