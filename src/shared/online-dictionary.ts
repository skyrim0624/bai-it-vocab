import type { DictionaryLookupResult } from "./types.ts";

type UnknownRecord = Record<string, unknown>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const YOUDAO_JSON_API = "https://dict.youdao.com/jsonapi";

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function cleanText(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values.map(cleanText)) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }

  return result;
}

function normalizeComparable(value: string): string {
  return value.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

export function normalizeLookupWord(word: string): string {
  return word.trim().toLowerCase();
}

function extractPhonetic(wordEntry: UnknownRecord): string | undefined {
  const value =
    asString(wordEntry.usphone) ||
    asString(wordEntry.ukphone) ||
    asString(wordEntry.phone) ||
    asString(wordEntry.phonetic);
  if (!value) return undefined;
  const clean = value.replace(/^\/|\/$/g, "").trim();
  return clean ? `/${clean}/` : undefined;
}

function extractEcDefinitions(data: UnknownRecord, word: string): { definition: string; phonetic?: string } | null {
  const ec = isRecord(data.ec) ? data.ec : null;
  const wordEntries = ec ? asArray(ec.word).filter(isRecord) : [];
  if (wordEntries.length === 0) return null;

  const comparableWord = normalizeComparable(word);
  const exactEntry =
    wordEntries.find((entry) => {
      const returnPhrase = isRecord(entry["return-phrase"]) && isRecord(entry["return-phrase"].l)
        ? asString((entry["return-phrase"].l as UnknownRecord).i)
        : "";
      return normalizeComparable(returnPhrase) === comparableWord;
    }) ?? wordEntries[0];

  const definitions: string[] = [];
  for (const trs of asArray(exactEntry.trs).filter(isRecord)) {
    for (const tr of asArray(trs.tr).filter(isRecord)) {
      const l = isRecord(tr.l) ? tr.l : null;
      if (!l) continue;
      const items = Array.isArray(l.i) ? l.i.map(asString) : [asString(l.i)];
      definitions.push(...items);
    }
  }

  const cleanDefinitions = uniqueNonEmpty(definitions).slice(0, 3);
  if (cleanDefinitions.length === 0) return null;

  return {
    definition: cleanDefinitions.join("；"),
    phonetic: extractPhonetic(exactEntry),
  };
}

function extractWebDefinitions(data: UnknownRecord, word: string): { definition: string } | null {
  const webTrans = isRecord(data.web_trans) ? data.web_trans : null;
  const entries = webTrans ? asArray(webTrans["web-translation"]).filter(isRecord) : [];
  if (entries.length === 0) return null;

  const comparableWord = normalizeComparable(word);
  const exactEntry =
    entries.find((entry) => normalizeComparable(asString(entry.key)) === comparableWord) ??
    entries.find((entry) => normalizeComparable(asString(entry.key)) === comparableWord.replace(/-/g, " ")) ??
    entries[0];

  const values: string[] = [];
  for (const trans of asArray(exactEntry.trans).filter(isRecord)) {
    values.push(asString(trans.value));
  }

  const cleanValues = uniqueNonEmpty(values).slice(0, 3);
  if (cleanValues.length === 0) return null;
  return { definition: cleanValues.join("；") };
}

export function parseYoudaoDictionary(data: unknown, word: string): DictionaryLookupResult | null {
  if (!isRecord(data)) return null;

  const normalizedWord = normalizeLookupWord(word);
  const ec = extractEcDefinitions(data, normalizedWord);
  if (ec) {
    return {
      word: normalizedWord,
      definition: ec.definition,
      phonetic: ec.phonetic,
      source: "online",
      provider: "有道词典",
    };
  }

  const web = extractWebDefinitions(data, normalizedWord);
  if (!web) return null;

  return {
    word: normalizedWord,
    definition: web.definition,
    source: "online",
    provider: "有道网络释义",
  };
}

export async function lookupOnlineDictionary(
  word: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 1800
): Promise<DictionaryLookupResult | null> {
  const normalizedWord = normalizeLookupWord(word);
  if (!/^[a-z][a-z'-]*$/.test(normalizedWord)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${YOUDAO_JSON_API}?q=${encodeURIComponent(normalizedWord)}`;
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) return null;

    const parsed = parseYoudaoDictionary(await response.json(), normalizedWord);
    return parsed ? { ...parsed, updated_at: Date.now() } : null;
  } finally {
    clearTimeout(timeout);
  }
}
