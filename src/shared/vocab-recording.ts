import type { VocabRecord } from "./types.ts";
import { vocabContextDAO, vocabDAO } from "./db.ts";

export interface VocabEncounterInput {
  word: string;
  definition?: string;
  phonetic?: string;
}

function normalizeWord(word: string): string {
  return word.trim().toLowerCase();
}

function normalizeSentence(sentence: string): string {
  return sentence.replace(/\s+/g, " ").trim();
}

function uniqueWords(words: VocabEncounterInput[]): VocabEncounterInput[] {
  const byWord = new Map<string, VocabEncounterInput>();

  for (const item of words) {
    const word = normalizeWord(item.word);
    if (!word || !/^[a-z][a-z'-]*$/.test(word)) continue;

    const existing = byWord.get(word);
    const definition = item.definition?.trim() ?? "";
    const phonetic = item.phonetic?.trim() ?? "";
    if (!existing || (!existing.definition && definition) || (!existing.phonetic && phonetic)) {
      byWord.set(word, {
        word,
        definition: definition || existing?.definition,
        phonetic: phonetic || existing?.phonetic,
      });
    }
  }

  return [...byWord.values()];
}

async function ensureVocab(
  db: IDBDatabase,
  word: string,
  definition: string,
  phonetic?: string
): Promise<VocabRecord> {
  const existing = await vocabDAO.getByWord(db, word);
  if (existing) {
    if ((!existing.definition && definition) || (!existing.phonetic && phonetic)) {
      const updated = await vocabDAO.update(db, existing.id, {
        definition: existing.definition || definition || undefined,
        phonetic: existing.phonetic || phonetic || undefined,
      });
      return updated ?? existing;
    }
    return existing;
  }

  return vocabDAO.add(db, {
    word,
    status: "new",
    definition: definition || undefined,
    phonetic: phonetic || undefined,
  });
}

/**
 * 将网页里真实遇到的生词沉淀进生词表和语境表。
 * 同一单词在同一句里重复保存时不增加 encounter_count，避免页面重扫造成虚高。
 */
export async function recordVocabEncounters(
  db: IDBDatabase,
  words: VocabEncounterInput[],
  sentence: string,
  sourceUrl: string
): Promise<void> {
  const cleanSentence = normalizeSentence(sentence);
  if (!cleanSentence) return;

  for (const item of uniqueWords(words)) {
    const definition = item.definition?.trim() ?? "";
    const phonetic = item.phonetic?.trim();
    const vocab = await ensureVocab(db, item.word, definition, phonetic);
    const contexts = await vocabContextDAO.getByVocabId(db, vocab.id);
    const existingContext = contexts.find(
      (ctx) => normalizeSentence(ctx.sentence) === cleanSentence
    );

    if (existingContext) {
      if (definition && existingContext.context_definition !== definition) {
        await vocabContextDAO.update(db, existingContext.id, {
          context_definition: definition,
        });
      }
      continue;
    }

    if (contexts.length > 0) {
      await vocabDAO.recordEncounter(db, vocab.id);
    }

    await vocabContextDAO.add(db, {
      vocab_id: vocab.id,
      sentence: cleanSentence,
      context_definition: definition || vocab.definition || "",
      source_url: sourceUrl,
    });
  }
}
