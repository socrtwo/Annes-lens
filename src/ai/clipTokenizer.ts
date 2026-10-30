/**
 * The CLIP byte-pair tokenizer (vocab.json + merges.txt from the model repository): lower-case,
 * whitespace-cleaned text, GPT-2 byte-to-unicode mapping, BPE merges with the "</w>" word marker,
 * start/end tokens and padding to 77 ids. Used by Search by Content for the text side of CLIP.
 */
export interface ClipTokenizer { encode(text: string, length?: number): { ids: number[]; mask: number[] } }

const bytesToUnicode = (): Map<number, string> => {
  const bs: number[] = []; for (let i = 33; i <= 126; i++) bs.push(i); for (let i = 161; i <= 172; i++) bs.push(i); for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = bs.slice(); let n = 0;
  for (let b = 0; b < 256; b++) if (!bs.includes(b)) { bs.push(b); cs.push(256 + n); n++; }
  const m = new Map<number, string>(); bs.forEach((b, i) => m.set(b, String.fromCodePoint(cs[i])));
  return m;
};

export function makeClipTokenizer(vocab: Record<string, number>, mergesText: string, special = { bos: '<|startoftext|>', eos: '<|endoftext|>' }): ClipTokenizer {
  const lines = mergesText.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  const ranks = new Map<string, number>(); lines.forEach((l, i) => ranks.set(l.trim().replace(/\s+/, ' '), i));
  const b2u = bytesToUnicode(); const enc = new TextEncoder(); const cache = new Map<string, string[]>();
  const bos = vocab[special.bos], eos = vocab[special.eos];
  const pat = /'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+/giu;
  const bpe = (token: string): string[] => {
    const hit = cache.get(token); if (hit) return hit;
    let word = [...token]; if (!word.length) return [];
    word[word.length - 1] += '</w>';
    for (;;) {
      let best: [string, string] | null = null, bestRank = Infinity;
      for (let i = 0; i + 1 < word.length; i++) { const r = ranks.get(word[i] + ' ' + word[i + 1]); if (r !== undefined && r < bestRank) { bestRank = r; best = [word[i], word[i + 1]]; } }
      if (!best) break;
      const out: string[] = [];
      for (let i = 0; i < word.length; i++) { if (i + 1 < word.length && word[i] === best[0] && word[i + 1] === best[1]) { out.push(best[0] + best[1]); i++; } else out.push(word[i]); }
      word = out; if (word.length === 1) break;
    }
    cache.set(token, word); return word;
  };
  return {
    encode(text, length = 77) {
      const clean = text.replace(/\s+/g, ' ').trim().toLowerCase();
      const ids: number[] = [bos];
      for (const m of clean.matchAll(pat)) {
        const mapped = [...enc.encode(m[0])].map((b) => b2u.get(b)!).join('');
        for (const piece of bpe(mapped)) { const id = vocab[piece]; ids.push(id === undefined ? eos : id); }
      }
      ids.push(eos);
      const cut = ids.slice(0, length); if (cut.length === length) cut[length - 1] = eos;
      const mask = cut.map(() => 1);
      while (cut.length < length) { cut.push(eos); mask.push(0); }
      return { ids: cut, mask };
    },
  };
}
