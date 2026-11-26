// The local classifier's text embedder: potion-multilingual-128M (model2vec, MIT), a static table of 500k word pieces
// x 256. Plain Node, built-ins only: a Unigram tokenizer over its tokenizer.json, then the mean of the pieces' rows.
// POTION_DIR names the folder with tokenizer.json and model.safetensors from huggingface.co/minishlab/potion-multilingual-128M.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function loadPotion(dir = process.env.POTION_DIR) {
  if (!dir) throw new Error('set POTION_DIR to a folder holding tokenizer.json and model.safetensors of minishlab/potion-multilingual-128M')
  const tok = JSON.parse(readFileSync(join(dir, 'tokenizer.json'), 'utf8'))
  const vocab = new Map()
  tok.model.vocab.forEach(([p, score], id) => vocab.set(p, [id, score]))
  const UNK = tok.model.unk_id
  const buf = readFileSync(join(dir, 'model.safetensors'))
  const hlen = Number(buf.readBigUInt64LE(0))
  const head = JSON.parse(buf.subarray(8, 8 + hlen).toString('utf8'))
  const info = Object.entries(head).find(([k]) => k !== '__metadata__')[1]
  const [rows, dim] = info.shape
  const start = 8 + hlen + info.data_offsets[0]
  const table = new Float32Array(buf.buffer.slice(buf.byteOffset + start, buf.byteOffset + start + rows * dim * 4))

  // The tokenizer's normalizer, with NFKC standing in for its precompiled charsmap: punctuation padded, spaces collapsed.
  const normalize = s => s.normalize('NFKC').replace(/([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, ' $1 ').replace(/\s+/g, ' ').trim()
  const MAXLEN = 32 // shortcut: pieces longer than 32 characters are never matched (a handful of 500k); fine for routing
  function encode(text) {
    const s = '▁' + normalize(text).replaceAll(' ', '▁')
    const n = s.length, best = new Float64Array(n + 1).fill(-Infinity), from = new Int32Array(n + 1), ids = new Int32Array(n + 1)
    best[0] = 0
    for (let i = 0; i < n; i++) {
      if (best[i] === -Infinity) continue
      let hit = false
      for (let j = i + 1; j <= Math.min(n, i + MAXLEN); j++) {
        const v = vocab.get(s.slice(i, j))
        if (!v) continue
        hit = true
        if (best[i] + v[1] > best[j]) { best[j] = best[i] + v[1]; from[j] = i; ids[j] = v[0] }
      }
      if (!hit && best[i] - 20 > best[i + 1]) { best[i + 1] = best[i] - 20; from[i + 1] = i; ids[i + 1] = UNK }
    }
    const out = []
    for (let j = n; j > 0; j = from[j]) out.push(ids[j])
    return out.reverse()
  }
  // Mean of the pieces' rows, unit length; the first 2000 characters, as the Haiku classifier reads.
  function embed(text) {
    const v = new Float32Array(dim)
    for (const id of encode(text.slice(0, 2000))) { if (id === UNK) continue; const o = id * dim; for (let c = 0; c < dim; c++) v[c] += table[o + c] }
    let norm = 0
    for (const x of v) norm += x * x
    norm = Math.sqrt(norm) || 1
    for (let c = 0; c < dim; c++) v[c] /= norm
    return v
  }
  return { embed, dim }
}
