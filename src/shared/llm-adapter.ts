/**
 * LLM 适配层
 *
 * 支持两种 API 格式：Gemini 和 OpenAI 兼容。
 * 在 Service Worker 中运行，直接调用 LLM API。
 */

import type { LLMConfig, ChunkResult, FullAnalysisResult } from "./types.ts";

// ========== Prompt 构建 ==========

export function buildChunkPrompt(sentences: string[], knownWords: string[] = []): string {
  const knownWordsNote =
    knownWords.length > 0
      ? `The user already knows these words (do NOT mark them as new): ${knownWords.join(", ")}`
      : "The user is at an advanced English level (IELTS 7+). Be very selective — only mark words that a proficient non-native reader would genuinely not know.";

  return `You are an English reading assistant. Your job is to restructure complex English sentences into indented chunks that reveal their grammatical structure, making them easier to parse visually.

## Rules

1. **Skeleton first**: The main clause (subject-verb-object) stays at the top level (no indentation).
2. **Indent subordinate elements**: Each level of nesting gets 2 more spaces of indentation:
   - Subordinate clauses (that, which, who, if, because, although, etc.)
   - Relative clauses
   - Conditional clauses
   - Temporal clauses
   - Participial phrases, prepositional phrases, and appositive phrases
3. **Simple sentences**: If a sentence has no subordinate clauses and is straightforward, return it unchanged with is_simple=true.
4. **Preserve original text**: Do not change any words. Only add line breaks and indentation. Do NOT add brackets, parentheses, or any other symbols that are not in the original text.

## New Words

${knownWordsNote}

For each sentence, identify words that the user likely doesn't know. Provide a brief Chinese definition for each.

Important constraints for new_words:
- Do NOT mark proper nouns, brand names, or product names (e.g. ChatGPT, Google, Tesla, iPhone)
- Do NOT mark common tech/internet terms (e.g. AI, API, app, blog, email, online)
- Do NOT mark words that appear in any standard 6000-word English vocabulary list
- Only mark words that would genuinely challenge an advanced reader — rare, literary, domain-specific, or highly idiomatic expressions
- When in doubt, do NOT mark it. Fewer is better.

## Input

${sentences.map((s, i) => `[${i}] ${s}`).join("\n")}

## Output Format

Return a JSON array with one object per input sentence, in the same order:

\`\`\`json
[
  {
    "index": 0,
    "original": "the original sentence",
    "chunked": "the chunked version with\\n  indentation\\n    and nested clauses",
    "is_simple": false,
    "new_words": [
      {"word": "example", "definition": "例子，实例"}
    ]
  }
]
\`\`\`

Important:
- Use \\n for line breaks in the chunked field
- Use spaces (not tabs) for indentation, 2 spaces per level
- Return valid JSON only, no markdown fences
- The array must have exactly ${sentences.length} elements`;
}

// ========== 请求构建 ==========

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeminiRequestBody {
  contents: { parts: { text: string }[] }[];
  generationConfig: {
    temperature: number;
    responseMimeType?: string;
    thinkingConfig: { thinkingBudget: number };
  };
}

export function buildGeminiRequest(prompt: string, config: LLMConfig): { url: string; body: GeminiRequestBody } {
  const model = config.model || "gemini-2.0-flash";
  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${config.apiKey}`;

  const body: GeminiRequestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  return { url, body };
}

export function buildGeminiTextRequest(prompt: string, config: LLMConfig): { url: string; body: GeminiRequestBody } {
  const { url, body } = buildGeminiRequest(prompt, config);
  delete body.generationConfig.responseMimeType;
  return { url, body };
}

export interface OpenAIRequestBody {
  model: string;
  messages: { role: string; content: string }[];
  temperature: number;
  response_format?: { type: string };
  max_tokens?: number;
}

export function buildOpenAIRequest(prompt: string, config: LLMConfig): { url: string; body: OpenAIRequestBody; headers: Record<string, string> } {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/v1/chat/completions`;

  const body: OpenAIRequestBody = {
    model: config.model,
    messages: [
      { role: "system", content: "You are a helpful English reading assistant. Always respond with valid JSON." },
      { role: "user", content: prompt },
    ],
    temperature: 0.1,
    response_format: { type: "json_object" },
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
  };

  return { url, body, headers };
}

export function buildOpenAITextRequest(
  prompt: string,
  config: LLMConfig,
  maxTokens?: number
): { url: string; body: OpenAIRequestBody; headers: Record<string, string> } {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/v1/chat/completions`;

  const body: OpenAIRequestBody = {
    model: config.model,
    messages: [
      { role: "system", content: "你是快速英译中引擎。只输出简体中文译文，不要解释。" },
      { role: "user", content: prompt },
    ],
    temperature: 0,
  };

  if (maxTokens) {
    body.max_tokens = maxTokens;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
  };

  return { url, body, headers };
}

export function buildOpenAIJsonRequest(
  prompt: string,
  config: LLMConfig,
  maxTokens?: number
): { url: string; body: OpenAIRequestBody; headers: Record<string, string> } {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/v1/chat/completions`;

  const body: OpenAIRequestBody = {
    model: config.model,
    messages: [
      { role: "system", content: "你是网页英译中引擎。始终返回合法 JSON，不要输出额外说明。" },
      { role: "user", content: prompt },
    ],
    temperature: 0,
    response_format: { type: "json_object" },
  };

  if (maxTokens) {
    body.max_tokens = maxTokens;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
  };

  return { url, body, headers };
}

export function resolveFastTranslationConfig(config: LLMConfig): LLMConfig {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  if (config.format === "openai-compatible" && baseUrl === "http://127.0.0.1:17877") {
    return { ...config, model: "gpt-5.3-codex-spark" };
  }
  return config;
}

// ========== 响应解析 ==========

interface LLMChunkItem {
  index: number;
  original: string;
  chunked: string;
  is_simple: boolean;
  new_words?: { word: string; definition: string }[];
}

interface GeminiResponse {
  candidates?: {
    content?: {
      parts?: { text?: string }[];
    };
  }[];
}

interface OpenAIResponse {
  choices?: {
    message?: {
      content?: string;
    };
  }[];
}

interface PageTranslationItem {
  index: number;
  translation: string;
}

export function parseGeminiResponse(data: unknown): LLMChunkItem[] {
  const response = data as GeminiResponse;
  const text = response?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini 返回了空响应");
  }
  return parseChunkJson(text);
}

export function parseOpenAIResponse(data: unknown): LLMChunkItem[] {
  const response = data as OpenAIResponse;
  const text = response?.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("OpenAI 返回了空响应");
  }
  return parseChunkJson(text);
}

/**
 * 解析 LLM 返回的 JSON 文本为 ChunkItem 数组
 * 兼容 markdown fence 包裹和直接 JSON
 */
export function parseChunkJson(text: string): LLMChunkItem[] {
  // 去除可能的 markdown fence
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`LLM 返回的 JSON 格式无效: ${cleaned.slice(0, 100)}...`);
  }

  // 处理可能的外层包装（如 { results: [...] }）
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const arrayKey = Object.keys(obj).find(k => Array.isArray(obj[k]));
    if (arrayKey) {
      parsed = obj[arrayKey];
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error("LLM 返回的不是数组格式");
  }

  return (parsed as LLMChunkItem[]).map(item => ({
    index: item.index ?? 0,
    original: item.original ?? "",
    chunked: item.chunked ?? item.original ?? "",
    is_simple: item.is_simple ?? true,
    new_words: Array.isArray(item.new_words) ? item.new_words : [],
  }));
}

// ========== 统一调用接口 ==========

/**
 * 将 LLM 返回的 items 映射为 ChunkResult 数组
 */
export function mapToChunkResults(
  sentences: string[],
  items: LLMChunkItem[]
): ChunkResult[] {
  return sentences.map((sentence, i) => {
    const match = items.find(item => item.index === i);
    if (!match) {
      return {
        original: sentence,
        chunked: sentence,
        isSimple: true,
        newWords: [],
      };
    }
    return {
      original: match.original || sentence,
      chunked: match.chunked,
      isSimple: match.is_simple,
      newWords: match.new_words ?? [],
    };
  });
}

/**
 * 调用 LLM API 对句子进行分块
 */
export async function chunkSentences(
  sentences: string[],
  config: LLMConfig,
  knownWords: string[] = []
): Promise<ChunkResult[]> {
  const prompt = buildChunkPrompt(sentences, knownWords);

  let responseData: unknown;

  if (config.format === "gemini") {
    const { url, body } = buildGeminiRequest(prompt, config);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API 错误 (${response.status}): ${errorText.slice(0, 200)}`);
    }

    responseData = await response.json();
    const items = parseGeminiResponse(responseData);
    return mapToChunkResults(sentences, items);
  } else {
    const { url, body, headers } = buildOpenAIRequest(prompt, config);
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API 错误 (${response.status}): ${errorText.slice(0, 200)}`);
    }

    responseData = await response.json();
    const items = parseOpenAIResponse(responseData);
    return mapToChunkResults(sentences, items);
  }
}

// ========== 完整分析（单句，给管理端用） ==========

const VALID_PATTERN_KEYS = [
  "insertion", "background_first", "nested", "long_list", "inverted",
  "long_subject", "omission", "contrast", "condition", "long_modifier", "other",
];

export function buildFullAnalysisPrompt(sentence: string): string {
  return `You are an English reading assistant for Chinese learners. Analyze the following English sentence in depth.

## Input sentence

${sentence}

## Output format

Return a single JSON object (NOT an array) with these fields:

\`\`\`json
{
  "chunked": "the chunked version with\\n  indentation",
  "pattern_key": "one of the allowed keys",
  "sentence_analysis": "用中文解释这句话为什么难读，指出哪些结构造成了阅读障碍",
  "expression_tips": "用中文讲解这句话中值得学习的表达方式和句式，用 **加粗** 标注关键表达",
  "new_words": [{"word": "example", "definition": "例子，实例"}],
  "is_worth_practicing": true
}
\`\`\`

## Rules

### chunked
- Main clause (subject-verb-object) at top level (no indentation)
- Indent subordinate elements with 2 spaces per level
- Preserve original text exactly, only add \\n and spaces

### pattern_key
Must be one of: ${VALID_PATTERN_KEYS.join(", ")}

### sentence_analysis & expression_tips
- Write in Chinese (中文)
- Be concise but insightful

### new_words
- Only words that a IELTS 7+ Chinese reader might not know
- Do NOT mark proper nouns, brand names, common tech terms
- Provide brief Chinese definitions

### is_worth_practicing
- true if the sentence has interesting structure worth studying
- false if it's straightforward despite being long

Return valid JSON only, no markdown fences.`;
}

// ========== 全文翻译 ==========

export function buildTranslationPrompt(text: string): string {
  return `把下面英文帖文快速翻译成自然简体中文。保留段落；人名、@用户名、URL、代码词、产品名不硬翻。只输出译文，不要解释。

${text}`;
}

export function buildPageTranslationPrompt(texts: string[]): string {
  return `你是网页整页翻译引擎。把下面英文网页文本块逐条翻译成自然、准确、适合阅读的简体中文。

规则：
- 保持输入顺序和 index，不要漏项，不要合并条目。
- 保留人名、机构名、地名、产品名、URL、代码词、年份和数字。
- 译文要像中文文章，不要像机器直译。
- 只返回 JSON，不要解释。

输出格式：
{
  "translations": [
    { "index": 0, "translation": "中文译文" }
  ]
}

输入：
${texts.map((text, index) => `[${index}] ${text}`).join("\n\n")}`;
}

export function parseTranslationJson(text: string): string {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`LLM 返回的 JSON 格式无效: ${cleaned.slice(0, 100)}...`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("LLM 返回的翻译结果不是对象");
  }

  const translation = String((parsed as Record<string, unknown>).translation || "").trim();
  if (!translation) {
    throw new Error("LLM 返回了空翻译");
  }
  return translation;
}

export function parseTranslationText(text: string): string {
  const cleaned = text.trim();
  if (!cleaned) {
    throw new Error("LLM 返回了空翻译");
  }

  try {
    return parseTranslationJson(cleaned);
  } catch {
    return cleaned
      .replace(/^```(?:[a-zA-Z]+)?\s*/, "")
      .replace(/\s*```$/, "")
      .replace(/^["“]|["”]$/g, "")
      .trim();
  }
}

export function parsePageTranslationJson(text: string): PageTranslationItem[] {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`LLM 返回的 JSON 格式无效: ${cleaned.slice(0, 100)}...`);
  }

  if (Array.isArray(parsed)) {
    return normalizePageTranslationItems(parsed);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("LLM 返回的整页翻译结果不是对象");
  }

  const translations = (parsed as Record<string, unknown>).translations;
  if (!Array.isArray(translations)) {
    throw new Error("LLM 返回的整页翻译结果缺少 translations 数组");
  }

  return normalizePageTranslationItems(translations);
}

function normalizePageTranslationItems(items: unknown[]): PageTranslationItem[] {
  return items.map((item, fallbackIndex) => {
    const obj = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return {
      index: Number.isFinite(Number(obj.index)) ? Number(obj.index) : fallbackIndex,
      translation: String(obj.translation || "").trim(),
    };
  }).filter((item) => item.translation.length > 0);
}

// ========== 单词释义 ==========

export function buildWordDefinitionPrompt(word: string, sentence = ""): string {
  const context = sentence.trim()
    ? `\n\n## Context sentence\n\n${sentence.trim()}`
    : "";

  return `You are an English-Chinese dictionary for a browser reading assistant.

Explain the selected English word or phrase in concise Simplified Chinese.

## Word

${word}
${context}

## Rules

- Return the most likely meaning in this context.
- Keep it short: part of speech + Chinese meaning, under 32 Chinese characters when possible.
- If the word is a proper noun, brand name, username, or not a real English word, return an empty definition.
- Do not add examples, notes, markdown, or extra commentary.

## Output format

Return valid JSON only:

{
  "definition": "n. 信息图；信息可视化图表",
  "phonetic": ""
}`;
}

export function parseWordDefinitionJson(text: string): { definition: string; phonetic?: string } {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`LLM 返回的 JSON 格式无效: ${cleaned.slice(0, 100)}...`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("LLM 返回的单词释义不是对象");
  }

  const obj = parsed as Record<string, unknown>;
  const definition = String(obj.definition || "").trim();
  const phonetic = String(obj.phonetic || "").trim();
  return {
    definition,
    phonetic: phonetic || undefined,
  };
}

export async function defineWordToChinese(
  word: string,
  sentence: string,
  config: LLMConfig
): Promise<{ definition: string; phonetic?: string }> {
  const prompt = buildWordDefinitionPrompt(word, sentence);

  let responseData: unknown;

  if (config.format === "gemini") {
    const { url, body } = buildGeminiRequest(prompt, config);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API 错误 (${response.status}): ${errorText.slice(0, 200)}`);
    }
    responseData = await response.json();
  } else {
    const { url, body, headers } = buildOpenAIRequest(prompt, config);
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API 错误 (${response.status}): ${errorText.slice(0, 200)}`);
    }
    responseData = await response.json();
  }

  const responseText = extractResponseText(responseData, config.format);
  return parseWordDefinitionJson(responseText);
}

export async function translateTextToChinese(
  text: string,
  config: LLMConfig
): Promise<string> {
  const prompt = buildTranslationPrompt(text);
  const maxTokens = Math.min(1200, Math.max(160, Math.ceil(text.length * 1.5)));
  const translationConfig = resolveFastTranslationConfig(config);

  let responseData: unknown;

  if (config.format === "gemini") {
    const { url, body } = buildGeminiTextRequest(prompt, config);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API 错误 (${response.status}): ${errorText.slice(0, 200)}`);
    }
    responseData = await response.json();
  } else {
    try {
      responseData = await fetchOpenAITextResponse(prompt, translationConfig, maxTokens);
    } catch (err) {
      if (translationConfig.model !== config.model && shouldRetryOriginalTranslationModel(err)) {
        responseData = await fetchOpenAITextResponse(prompt, config, maxTokens);
      } else {
        throw err;
      }
    }
  }

  const responseText = extractResponseText(responseData, config.format);
  return parseTranslationText(responseText);
}

export async function translatePageTextsToChinese(
  texts: string[],
  config: LLMConfig
): Promise<string[]> {
  const prompt = buildPageTranslationPrompt(texts);
  const totalChars = texts.reduce((sum, text) => sum + text.length, 0);
  const maxTokens = Math.min(6000, Math.max(600, Math.ceil(totalChars * 1.5)));
  const translationConfig = resolveFastTranslationConfig(config);

  let responseData: unknown;

  if (config.format === "gemini") {
    const { url, body } = buildGeminiRequest(prompt, config);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API 错误 (${response.status}): ${errorText.slice(0, 200)}`);
    }
    responseData = await response.json();
  } else {
    try {
      responseData = await fetchOpenAIJsonResponse(prompt, translationConfig, maxTokens);
    } catch (err) {
      if (translationConfig.model !== config.model && shouldRetryOriginalTranslationModel(err)) {
        responseData = await fetchOpenAIJsonResponse(prompt, config, maxTokens);
      } else {
        throw err;
      }
    }
  }

  const responseText = extractResponseText(responseData, config.format);
  const items = parsePageTranslationJson(responseText);
  return texts.map((text, index) => items.find((item) => item.index === index)?.translation || text);
}

async function fetchOpenAITextResponse(
  prompt: string,
  config: LLMConfig,
  maxTokens: number
): Promise<unknown> {
  const { url, body, headers } = buildOpenAITextRequest(prompt, config, maxTokens);
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API 错误 (${response.status}): ${errorText.slice(0, 200)}`);
  }
  return response.json();
}

async function fetchOpenAIJsonResponse(
  prompt: string,
  config: LLMConfig,
  maxTokens: number
): Promise<unknown> {
  const { url, body, headers } = buildOpenAIJsonRequest(prompt, config, maxTokens);
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API 错误 (${response.status}): ${errorText.slice(0, 200)}`);
  }
  return response.json();
}

function shouldRetryOriginalTranslationModel(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err || "");
  return /model|unsupported|unknown|unavailable|not found|无效|不可用/i.test(message);
}

/**
 * 解析单条完整分析结果 JSON
 */
export function parseFullAnalysisJson(text: string): FullAnalysisResult {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`LLM 返回的 JSON 格式无效: ${cleaned.slice(0, 100)}...`);
  }

  const obj = parsed as Record<string, unknown>;

  // 验证 pattern_key
  let patternKey = String(obj.pattern_key || "other");
  if (!VALID_PATTERN_KEYS.includes(patternKey)) {
    patternKey = "other";
  }

  return {
    chunked: String(obj.chunked || ""),
    pattern_key: patternKey,
    sentence_analysis: String(obj.sentence_analysis || ""),
    expression_tips: String(obj.expression_tips || ""),
    new_words: Array.isArray(obj.new_words)
      ? (obj.new_words as { word: string; definition: string }[]).map(w => ({
          word: String(w.word || ""),
          definition: String(w.definition || ""),
        }))
      : [],
    is_worth_practicing: Boolean(obj.is_worth_practicing),
  };
}

/**
 * 提取 LLM 响应文本（Gemini 或 OpenAI 格式）
 */
function extractResponseText(data: unknown, format: "gemini" | "openai-compatible"): string {
  if (format === "gemini") {
    const response = data as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = response?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini 返回了空响应");
    return text;
  } else {
    const response = data as { choices?: { message?: { content?: string } }[] };
    const text = response?.choices?.[0]?.message?.content;
    if (!text) throw new Error("OpenAI 返回了空响应");
    return text;
  }
}

/**
 * 对单句进行完整 LLM 分析（句式、分块、讲解、表达、生词）
 */
export async function analyzeSentenceFull(
  sentence: string,
  config: LLMConfig
): Promise<FullAnalysisResult> {
  const prompt = buildFullAnalysisPrompt(sentence);

  let responseData: unknown;

  if (config.format === "gemini") {
    const { url, body } = buildGeminiRequest(prompt, config);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API 错误 (${response.status}): ${errorText.slice(0, 200)}`);
    }
    responseData = await response.json();
  } else {
    const { url, body, headers } = buildOpenAIRequest(prompt, config);
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API 错误 (${response.status}): ${errorText.slice(0, 200)}`);
    }
    responseData = await response.json();
  }

  const text = extractResponseText(responseData, config.format);
  return parseFullAnalysisJson(text);
}
