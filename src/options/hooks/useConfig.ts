import { useState, useEffect, useCallback } from "react";
import type { BaitConfig, LLMMultiConfig } from "../../shared/types.ts";
import { DEFAULT_CONFIG, migrateLLMConfig } from "../../shared/types.ts";

export function useConfig() {
  const [config, setConfig] = useState<BaitConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    chrome.storage.sync.get(Object.keys(DEFAULT_CONFIG), (items) => {
      const raw = items as unknown as BaitConfig;
      // 补全缺失字段
      const merged: BaitConfig = {
        ...DEFAULT_CONFIG,
        ...raw,
        llm: migrateLLMConfig(raw.llm),
      };
      if (!Array.isArray(merged.disabledSites)) merged.disabledSites = [];
      if (!Array.isArray(merged.disabledChunkSites)) merged.disabledChunkSites = [];
      if (!Array.isArray(merged.wordTranslationEnabledSites)) merged.wordTranslationEnabledSites = [];
      setConfig(merged);
      setLoading(false);
    });
  }, []);

  const saveConfig = useCallback(async (partial: Partial<BaitConfig>) => {
    setConfig((prev) => {
      const updated = { ...prev, ...partial };
      if (partial.llm) {
        updated.llm = { ...prev.llm, ...partial.llm };
      }
      chrome.storage.sync.set(updated as Record<string, unknown>);
      return updated;
    });
  }, []);

  const updateLLM = useCallback(async (partial: Partial<LLMMultiConfig>) => {
    setConfig((prev) => {
      const llm = { ...prev.llm, ...partial };
      if (partial.providers) {
        llm.providers = { ...prev.llm.providers, ...partial.providers };
      }
      const updated = { ...prev, llm };
      chrome.storage.sync.set(updated as Record<string, unknown>);
      return updated;
    });
  }, []);

  return { config, loading, saveConfig, updateLLM };
}
