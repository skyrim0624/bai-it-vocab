/**
 * Background Service Worker
 *
 * 职责：
 * 1. 接收 Content Script 的分块请求
 * 2. 查 IndexedDB 缓存，命中直接返回
 * 3. 未命中的句子调 LLM API
 * 4. 结果写入缓存后返回
 * 5. 管理配置和站点开关
 */

import type { Message, BaitConfig, ChunkResult, PatternKey, DictionaryLookupResult } from "../shared/types.ts";
import { DEFAULT_CONFIG, resolveLLMConfig, migrateLLMConfig } from "../shared/types.ts";
import { clearCache, getCachedBatch, setCacheBatch } from "../shared/cache.ts";
import { chunkSentences, analyzeSentenceFull, defineWordToChinese, translateTextToChinese } from "../shared/llm-adapter.ts";
import { clearLearningData, openDB as openDataDB, pendingSentenceDAO, learningRecordDAO, vocabContextDAO, vocabDAO } from "../shared/db.ts";
import { recordVocabEncounters } from "../shared/vocab-recording.ts";
import { buildVocabEntries } from "../shared/vocab-export.ts";
import { buildLocalStudyAdvice, generateLocalPracticeSentence } from "../shared/vocab-study.ts";
import { lookupOnlineDictionary, normalizeLookupWord } from "../shared/online-dictionary.ts";

const ONLINE_DICT_CACHE_KEY = "onlineDictionaryCacheV1";
const ONLINE_DICT_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const ONLINE_DICT_TIMEOUT = 4500;

type DictionaryCache = Record<string, DictionaryLookupResult>;

// ========== 配置管理 ==========

async function getConfig(): Promise<BaitConfig> {
  const keys = Object.keys(DEFAULT_CONFIG);
  const items = await chrome.storage.sync.get(keys);
  const config = items as unknown as BaitConfig;

  if (!Array.isArray(config.disabledSites)) {
    config.disabledSites = [];
  }
  if (!config.chunkGranularity) {
    config.chunkGranularity = "fine";
  }
  // 兼容旧格式 + 新格式
  config.llm = migrateLLMConfig(config.llm);

  return config;
}

async function updateConfig(partial: Partial<BaitConfig>): Promise<BaitConfig> {
  const current = await getConfig();
  const updated = { ...current, ...partial };
  if (partial.llm) {
    updated.llm = { ...current.llm, ...partial.llm };
  }
  await chrome.storage.sync.set(updated as Record<string, unknown>);
  return updated;
}

// ========== 在线词典 ==========

async function getDictionaryCache(): Promise<DictionaryCache> {
  const stored = await chrome.storage.local.get({ [ONLINE_DICT_CACHE_KEY]: {} });
  const cache = stored[ONLINE_DICT_CACHE_KEY];
  return cache && typeof cache === "object" && !Array.isArray(cache) ? cache as DictionaryCache : {};
}

async function putDictionaryCache(word: string, result: DictionaryLookupResult): Promise<void> {
  const cache = await getDictionaryCache();
  cache[word] = { ...result, updated_at: Date.now() };

  // NOTE: 词典缓存可能长期增长，保留最近 500 条就足够支撑个人阅读场景。
  const entries = Object.entries(cache).sort(
    ([, a], [, b]) => (b.updated_at ?? 0) - (a.updated_at ?? 0)
  );
  await chrome.storage.local.set({
    [ONLINE_DICT_CACHE_KEY]: Object.fromEntries(entries.slice(0, 500)),
  });
}

async function getCachedDictionaryResult(word: string): Promise<DictionaryLookupResult | null> {
  const cache = await getDictionaryCache();
  const cached = cache[word];
  if (!cached?.definition) return null;
  if ((cached.updated_at ?? 0) < Date.now() - ONLINE_DICT_CACHE_TTL) return null;
  return {
    ...cached,
    source: "online-cache",
  };
}

async function lookupDictionaryOnlineFirst(
  word: string,
  offlineDefinition = "",
  sentence = ""
): Promise<DictionaryLookupResult> {
  const normalizedWord = normalizeLookupWord(word);
  const browserIsOffline = navigator.onLine === false;

  if (!browserIsOffline) {
    try {
      const online = await lookupOnlineDictionary(normalizedWord, fetch, ONLINE_DICT_TIMEOUT);
      if (online?.definition) {
        await putDictionaryCache(normalizedWord, online);
        return online;
      }
    } catch {
      // 网络、接口或超时失败时继续走缓存和离线兜底。
    }
  }

  if (!browserIsOffline) {
    const cached = await getCachedDictionaryResult(normalizedWord);
    if (cached) return cached;
  }

  if (offlineDefinition.trim()) {
    return {
      word: normalizedWord,
      definition: offlineDefinition.trim(),
      source: "offline",
      provider: "离线词库",
    };
  }

  try {
    const cfg = await getConfig();
    const llmCfg = resolveLLMConfig(cfg.llm);
    if (llmCfg.apiKey) {
      const ai = await defineWordToChinese(normalizedWord, sentence, llmCfg);
      if (ai.definition) {
        return {
          word: normalizedWord,
          definition: ai.definition,
          phonetic: ai.phonetic,
          source: "ai",
          provider: "AI 释义",
        };
      }
    }
  } catch {
    // AI 兜底失败时返回空结果，tooltip 会给出可重试提示。
  }

  return {
    word: normalizedWord,
    definition: "",
    source: "none",
  };
}

// ========== 站点开关 ==========

function getHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

async function isSiteEnabled(hostname: string): Promise<boolean> {
  const config = await getConfig();
  return !config.disabledSites.includes(hostname);
}

async function toggleSite(hostname: string): Promise<{ enabled: boolean; disabledSites: string[] }> {
  const config = await getConfig();
  const index = config.disabledSites.indexOf(hostname);
  let enabled: boolean;

  if (index >= 0) {
    config.disabledSites.splice(index, 1);
    enabled = true;
  } else {
    config.disabledSites.push(hostname);
    enabled = false;
  }

  await chrome.storage.sync.set({ disabledSites: config.disabledSites });
  return { enabled, disabledSites: config.disabledSites };
}

/** 切换工具栏图标：带绿点(启用) / 无绿点(禁用) */
async function updateIcon(tabId: number, active: boolean): Promise<void> {
  const suffix = active ? "-on" : "";
  try {
    await chrome.action.setIcon({
      path: {
        16: `icons/icon16${suffix}.png`,
        48: `icons/icon48${suffix}.png`,
        128: `icons/icon128${suffix}.png`,
      },
      tabId,
    });
  } catch {
    // tab 可能已关闭，静默忽略
  }
}

// ========== Tab 暂停状态 ==========

const pausedTabs = new Set<number>();

chrome.tabs.onRemoved.addListener((tabId) => {
  pausedTabs.delete(tabId);
});

// ========== 请求合并 ==========

let pendingBatch: {
  sentences: string[];
  source_url?: string;
  resolvers: Map<string, (result: ChunkResult) => void>;
  timer: ReturnType<typeof setTimeout> | null;
} | null = null;

const BATCH_DELAY = 50;
const MAX_BATCH_SIZE = 5;

function addToBatch(
  sentence: string,
  sourceUrl?: string
): Promise<ChunkResult> {
  return new Promise((resolve) => {
    if (!pendingBatch) {
      pendingBatch = { sentences: [], source_url: sourceUrl, resolvers: new Map(), timer: null };
    }

    pendingBatch.sentences.push(sentence);
    pendingBatch.resolvers.set(sentence, resolve);

    if (pendingBatch.timer) clearTimeout(pendingBatch.timer);

    if (pendingBatch.sentences.length >= MAX_BATCH_SIZE) {
      flushBatch();
    } else {
      pendingBatch.timer = setTimeout(flushBatch, BATCH_DELAY);
    }
  });
}

async function flushBatch(): Promise<void> {
  if (!pendingBatch || pendingBatch.sentences.length === 0) return;

  const batch = pendingBatch;
  pendingBatch = null;
  if (batch.timer) clearTimeout(batch.timer);

  try {
    const config = await getConfig();
    const llmConfig = resolveLLMConfig(config.llm);

    if (!llmConfig.apiKey) {
      throw new Error("API key 未配置");
    }

    const results = await chunkSentences(batch.sentences, llmConfig);

    // 写缓存
    const cachePairs = results.map((r, i) => ({
      sentence: batch.sentences[i],
      result: r,
    }));
    setCacheBatch(cachePairs).catch(() => {});

    // 回调所有等待者
    for (let i = 0; i < results.length; i++) {
      const resolver = batch.resolvers.get(batch.sentences[i]);
      if (resolver) resolver(results[i]);
    }

    updateDailyStats(results.filter(r => !r.isSimple).length);
  } catch {
    for (const [sentence, resolver] of batch.resolvers) {
      resolver({
        original: sentence,
        chunked: sentence,
        isSimple: true,
        newWords: [],
      });
    }
  }
}

// ========== 统计 ==========

async function updateDailyStats(chunkedCount: number): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const data = await chrome.storage.local.get({ statsDate: "", todayChunked: 0 });
  if (data.statsDate !== today) {
    await chrome.storage.local.set({ statsDate: today, todayChunked: chunkedCount });
  } else {
    await chrome.storage.local.set({
      todayChunked: (data.todayChunked as number) + chunkedCount,
    });
  }
}

// ========== IndexedDB 连接 ==========

let bgDb: IDBDatabase | null = null;

async function getDB(): Promise<IDBDatabase> {
  if (bgDb) return bgDb;
  bgDb = await openDataDB();
  bgDb.onclose = () => { bgDb = null; };
  return bgDb;
}

// ========== 分析批处理 ==========

async function processAnalysisBatch(sentenceIds: string[]): Promise<void> {
  const db = await getDB();
  const config = await getConfig();
  const llmConfig = resolveLLMConfig(config.llm);

  if (!llmConfig.apiKey) return;

  for (let i = 0; i < sentenceIds.length; i++) {
    const id = sentenceIds[i];

    try {
      const pending = await pendingSentenceDAO.getById(db, id);
      if (!pending || pending.analyzed) continue;

      // 防止 service worker 重启导致重复分析
      const existing = await learningRecordDAO.getBySentence(db, pending.text);
      if (existing) {
        await pendingSentenceDAO.markAnalyzed(db, id);
        chrome.runtime.sendMessage({
          type: "sentenceAnalyzed",
          pendingId: id,
          learningRecord: existing,
        }).catch(() => {});
        continue;
      }

      const result = await analyzeSentenceFull(pending.text, llmConfig);

      const lr = await learningRecordDAO.add(db, {
        sentence: pending.text,
        chunked: result.chunked,
        sentence_analysis: result.sentence_analysis,
        expression_tips: result.expression_tips,
        pattern_key: result.pattern_key as PatternKey,
        new_words: result.new_words,
        source_url: pending.source_url,
        llm_provider: config.llm.activeProvider,
      });

      await recordVocabEncounters(
        db,
        result.new_words,
        pending.text,
        pending.source_url
      );

      await pendingSentenceDAO.markAnalyzed(db, id);

      chrome.runtime.sendMessage({
        type: "sentenceAnalyzed",
        pendingId: id,
        learningRecord: lr,
      }).catch(() => {});
    } catch (err) {
      chrome.runtime.sendMessage({
        type: "sentenceAnalysisFailed",
        pendingId: id,
        error: err instanceof Error ? err.message : "Unknown error",
      }).catch(() => {});
    }

    // 每条之间加 500ms 间隔，避免 API 限流
    if (i < sentenceIds.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

// ========== 消息监听 ==========

chrome.runtime.onMessage.addListener(
  (message: Message, sender, sendResponse) => {
    handleMessage(message, sender).then((result) => {
      try { sendResponse(result); } catch { /* tab 可能已关闭 */ }
    }).catch((error) => {
      try {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "后台处理失败",
        });
      } catch { /* tab 可能已关闭 */ }
    });
    return true;
  }
);

async function handleMessage(
  message: Message,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  switch (message.type) {
    case "chunk": {
      const { sentences, source_url } = message;

      // 1. 先查缓存
      const cached = await getCachedBatch(sentences);
      const uncached = sentences.filter(s => !cached.has(s));

      // 2. 缓存全命中
      if (uncached.length === 0) {
        return { results: sentences.map(s => cached.get(s)!) };
      }

      // 3. 未命中的加入批量队列
      const apiResults = await Promise.all(
        uncached.map(s => addToBatch(s, source_url))
      );

      // 4. 合并
      const apiResultMap = new Map<string, ChunkResult>();
      uncached.forEach((s, i) => apiResultMap.set(s, apiResults[i]));

      return {
        results: sentences.map(s => cached.get(s) ?? apiResultMap.get(s)!),
      };
    }

    case "checkActive": {
      const tabId = sender.tab?.id;
      const tabUrl = sender.tab?.url ?? "";
      const hostname = getHostname(tabUrl);
      const siteOn = hostname ? await isSiteEnabled(hostname) : false;
      const active = siteOn && !(tabId && pausedTabs.has(tabId));
      if (tabId) updateIcon(tabId, active);
      return { active };
    }

    case "toggleSite": {
      const { hostname } = message;
      const result = await toggleSite(hostname);

      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id && tab.url) {
          const tabHost = getHostname(tab.url);
          if (tabHost === hostname) {
            updateIcon(tab.id, result.enabled);
            chrome.tabs.sendMessage(tab.id, {
              type: result.enabled ? "activate" : "deactivate",
            }).catch(() => {});
          }
        }
      }

      return { enabled: result.enabled, disabledSites: result.disabledSites };
    }

    case "pauseTab": {
      const { tabId } = message;
      pausedTabs.add(tabId);
      updateIcon(tabId, false);
      chrome.tabs.sendMessage(tabId, { type: "pause" }).catch(() => {});
      return { ok: true };
    }

    case "resumeTab": {
      const { tabId } = message;
      pausedTabs.delete(tabId);
      updateIcon(tabId, true);
      chrome.tabs.sendMessage(tabId, { type: "resume" }).catch(() => {});
      return { ok: true };
    }

    case "getTabState": {
      const { tabId, hostname } = message;
      if (pausedTabs.has(tabId)) return { state: "paused" };
      const enabled = hostname ? await isSiteEnabled(hostname) : false;
      if (!enabled) return { state: "disabled" };
      return { state: "active" };
    }

    case "hasApiKey": {
      const cfg = await getConfig();
      const llmCfg = resolveLLMConfig(cfg.llm);
      return { hasKey: !!llmCfg.apiKey };
    }

    case "getConfig":
      return getConfig();

    case "updateConfig":
      return updateConfig(message.config);

    case "lookupWordDefinition": {
      return lookupDictionaryOnlineFirst(
        message.word,
        message.offline_definition ?? "",
        message.sentence ?? ""
      );
    }

    case "translateText": {
      const text = message.text.trim();
      if (!text) return { ok: false, error: "没有可翻译的内容" };

      const cfg = await getConfig();
      const llmCfg = resolveLLMConfig(cfg.llm);
      if (!llmCfg.apiKey) {
        return { ok: false, error: "API key 未配置" };
      }

      try {
        const translation = await translateTextToChinese(text.slice(0, 5000), llmCfg);
        return { ok: true, translation };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "翻译失败",
        };
      }
    }

    case "resetLearningData": {
      const db = await getDB();
      await clearLearningData(db);
      await clearCache();
      await chrome.storage.local.remove([
        "knownWords",
        "statsDate",
        "todayChunked",
        ONLINE_DICT_CACHE_KEY,
      ]);
      return { ok: true };
    }

    case "saveSentence": {
      try {
        const db = await getDB();
        const wordDetails =
          message.new_word_details ??
          message.new_words.map((word) => ({ word, definition: "" }));
        const record = await pendingSentenceDAO.add(db, {
          text: message.text,
          source_url: message.source_url,
          source_hostname: message.source_hostname,
          manual: message.manual,
          new_words: message.new_words,
          new_word_details: wordDetails,
        });
        await recordVocabEncounters(
          db,
          wordDetails,
          message.text,
          message.source_url
        );
        return { ok: true, saved: record !== null };
      } catch {
        return { ok: true, saved: false };
      }
    }

    case "addVocabWord": {
      const db = await getDB();
      await recordVocabEncounters(
        db,
        [{ word: message.word, definition: message.definition ?? "", phonetic: message.phonetic }],
        message.sentence,
        message.source_url
      );
      return { ok: true };
    }

    case "markWordMastered": {
      const db = await getDB();
      const word = message.word.trim().toLowerCase();
      if (!word) return { ok: false };

      const existing = await vocabDAO.getByWord(db, word);
      if (existing) {
        await vocabDAO.markMastered(db, existing.id);
      } else {
        const created = await vocabDAO.add(db, {
          word,
          status: "mastered",
        });
        await vocabDAO.markMastered(db, created.id);
      }
      return { ok: true };
    }

    case "generatePracticeSentence": {
      const db = await getDB();
      const [vocab, contexts] = await Promise.all([
        vocabDAO.getAll(db),
        vocabContextDAO.getAll(db),
      ]);
      const entries = buildVocabEntries(vocab, contexts);
      return {
        ok: true,
        result: generateLocalPracticeSentence(entries, message.word),
      };
    }

    case "generateStudyAdvice": {
      const db = await getDB();
      const [vocab, contexts] = await Promise.all([
        vocabDAO.getAll(db),
        vocabContextDAO.getAll(db),
      ]);
      return {
        ok: true,
        result: buildLocalStudyAdvice(buildVocabEntries(vocab, contexts)),
      };
    }

    case "analyzeSentences": {
      const { sentenceIds } = message;
      // 立即返回，异步处理
      processAnalysisBatch(sentenceIds).catch(() => {});
      return { ok: true };
    }

    default:
      return { error: "Unknown message type" };
  }
}

// ========== Badge 更新 ==========

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) {
      const hostname = getHostname(tab.url);
      const siteOn = hostname ? await isSiteEnabled(hostname) : false;
      const active = siteOn && !pausedTabs.has(activeInfo.tabId);
      updateIcon(activeInfo.tabId, active);
    }
  } catch {
    // tab 可能已关闭，静默忽略
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    const hostname = getHostname(tab.url);
    const siteOn = hostname ? await isSiteEnabled(hostname) : false;
    const active = siteOn && !pausedTabs.has(tabId);
    updateIcon(tabId, active);
  }
});
