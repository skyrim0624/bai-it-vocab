import { useState, useCallback, useEffect } from "react";
import type { ProviderKey, LLMMultiConfig } from "../../shared/types.ts";
import { DEFAULT_PROVIDERS, PROVIDER_META, resolveLLMConfig } from "../../shared/types.ts";
import { chunkSentences } from "../../shared/llm-adapter.ts";
import { GlassCard } from "../components/GlassCard.tsx";
import { PROVIDER_INFO } from "../constants.ts";

const PROVIDER_KEYS: ProviderKey[] = ["gemini", "chatgpt", "deepseek", "qwen", "kimi", "codex"];

const TEST_SENTENCE = "Although the project had been delayed by several unexpected issues, the team managed to deliver a working prototype on time.";

interface SettingsProps {
  config: { llm: LLMMultiConfig };
  configLoading: boolean;
  updateLLM: (partial: Partial<LLMMultiConfig>) => Promise<void>;
}

export function Settings({ config, configLoading: loading, updateLLM }: SettingsProps) {
  const [activeProvider, setActiveProvider] = useState<ProviderKey>("gemini");
  const [verifyStatus, setVerifyStatus] = useState<Record<ProviderKey, "idle" | "checking" | "ok" | "error">>({
    gemini: "idle", chatgpt: "idle", deepseek: "idle", qwen: "idle", kimi: "idle", codex: "idle",
  });
  const [verifyError, setVerifyError] = useState<string>("");
  const [resetStatus, setResetStatus] = useState<"idle" | "resetting" | "done" | "error">("idle");

  // NOTE: 配置异步加载完成后同步本地 Tab，否则页面可能仍停在默认 Gemini。
  useEffect(() => {
    if (!loading && config.llm.activeProvider) {
      setActiveProvider(config.llm.activeProvider);
    }
  }, [loading, config.llm.activeProvider]);

  const handleProviderSwitch = useCallback((p: ProviderKey) => {
    setActiveProvider(p);
    updateLLM({ activeProvider: p });
  }, [updateLLM]);

  const handleKeyChange = useCallback((value: string) => {
    const providers = { ...config.llm.providers };
    providers[activeProvider] = { ...providers[activeProvider], apiKey: value };
    updateLLM({ providers });
    setVerifyStatus((prev) => ({ ...prev, [activeProvider]: "idle" }));
    setVerifyError("");
  }, [activeProvider, config.llm.providers, updateLLM]);

  const handleModelChange = useCallback((value: string) => {
    const providers = { ...config.llm.providers };
    providers[activeProvider] = { ...providers[activeProvider], model: value };
    updateLLM({ providers });
    setVerifyStatus((prev) => ({ ...prev, [activeProvider]: "idle" }));
  }, [activeProvider, config.llm.providers, updateLLM]);

  const handleVerify = useCallback(async () => {
    const pc = config.llm.providers[activeProvider] ?? DEFAULT_PROVIDERS[activeProvider];
    if (!pc.apiKey) {
      setVerifyError("请先填入 API Key");
      return;
    }

    setVerifyStatus((prev) => ({ ...prev, [activeProvider]: "checking" }));
    setVerifyError("");

    try {
      // 端到端验证：用真实句子走完整 chunkSentences 链路
      const llmConfig = resolveLLMConfig({
        activeProvider,
        providers: config.llm.providers,
      });
      const results = await chunkSentences([TEST_SENTENCE], llmConfig);

      if (!results || results.length === 0 || !results[0].chunked) {
        throw new Error("API 返回了空结果，请检查模型是否可用");
      }

      setVerifyStatus((prev) => ({ ...prev, [activeProvider]: "ok" }));
    } catch (err) {
      setVerifyStatus((prev) => ({ ...prev, [activeProvider]: "error" }));
      const msg = err instanceof Error ? err.message : "连接失败";
      // 友好化常见错误
      if (msg.includes("401") || msg.includes("403") || msg.includes("PERMISSION_DENIED")) {
        setVerifyError("API Key 无效");
      } else if (msg.includes("404") || msg.includes("not found")) {
        setVerifyError("模型不存在，请换一个模型试试");
      } else {
        setVerifyError(msg);
      }
    }
  }, [activeProvider, config.llm.providers]);

  const handleResetLearningData = useCallback(async () => {
    const confirmed = window.confirm("清空后不可恢复。API 配置会保留，只删除本地生词、句子、复习和缓存数据。");
    if (!confirmed) return;

    setResetStatus("resetting");
    try {
      const response = await chrome.runtime.sendMessage({ type: "resetLearningData" });
      if (!response?.ok) throw new Error(response?.error || "清空失败");
      setResetStatus("done");
    } catch {
      setResetStatus("error");
    }
  }, []);

  if (loading) return null;

  const currentProviderConfig = config.llm.providers[activeProvider] ?? DEFAULT_PROVIDERS[activeProvider];
  const providerInfo = PROVIDER_INFO[activeProvider];
  const isCodex = activeProvider === "codex";
  const status = verifyStatus[activeProvider];
  const configuredProviderCount = PROVIDER_KEYS.filter((p) => {
    const providerConfig = config.llm.providers[p] ?? DEFAULT_PROVIDERS[p];
    return Boolean(providerConfig.apiKey?.trim());
  }).length;
  const providerStatusLabel = status === "checking"
    ? "测试中"
    : status === "ok"
      ? "已连接"
      : status === "error"
        ? "需检查"
        : currentProviderConfig.apiKey?.trim()
          ? "已配置"
          : "未配置";

  return (
    <>
      <div className="settings-page-head rv">
        <div>
          <div className="settings-kicker">配置中心</div>
          <h1 className="settings-title">设置</h1>
          <p className="settings-page-desc">管理模型通道、本机学习数据和连接状态。API Key 只保存在本地浏览器。</p>
        </div>
        <div className="settings-summary-grid" aria-label="当前设置状态">
          <div className="settings-summary-item">
            <span>当前通道</span>
            <strong>{providerInfo.label}</strong>
          </div>
          <div className="settings-summary-item">
            <span>模型</span>
            <strong>{currentProviderConfig.model}</strong>
          </div>
          <div className={`settings-summary-item ${status === "error" ? "danger" : status === "ok" ? "ok" : ""}`}>
            <span>连接状态</span>
            <strong>{providerStatusLabel}</strong>
          </div>
          <div className="settings-summary-item">
            <span>已配通道</span>
            <strong>{configuredProviderCount}</strong>
          </div>
        </div>
      </div>

      <div className="settings-section rv">
        <div className="settings-section-title">模型服务</div>
        <GlassCard className="settings-card">
          <div className="settings-card-head">
            <div>
              <div className="settings-card-title">选择一个默认通道</div>
              <div className="settings-desc">一键翻译、难句分析和学习建议会走这里配置的模型服务。</div>
            </div>
          </div>
          <div className="settings-provider-row" role="tablist" aria-label="选择模型服务">
            {PROVIDER_KEYS.map((p) => {
              const providerConfig = config.llm.providers[p] ?? DEFAULT_PROVIDERS[p];
              const providerStatus = verifyStatus[p];
              const hasKey = Boolean(providerConfig.apiKey?.trim());
              const statusText = providerStatus === "checking"
                ? "测试中"
                : providerStatus === "ok"
                  ? "已连接"
                  : providerStatus === "error"
                    ? "异常"
                    : hasKey
                      ? "已配置"
                      : "待填写";

              return (
                <button
                  key={p}
                  className={`settings-provider-btn ${activeProvider === p ? "active" : ""}`}
                  onClick={() => handleProviderSwitch(p)}
                  role="tab"
                  aria-selected={activeProvider === p}
                  type="button"
                >
                  <span className="settings-provider-name">{PROVIDER_INFO[p].label}</span>
                  <span className={`settings-provider-state ${providerStatus === "error" ? "error" : hasKey ? "ready" : ""}`}>
                    {statusText}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="settings-field-grid">
            <div className="settings-field">
              <label className="settings-label" htmlFor="settings-api-key">
                {isCodex ? "Codex 本机桥接 Token" : `${providerInfo.label} API Key`}
              </label>
              <div className="settings-desc">
                {isCodex
                  ? "这里不是 OpenAI Key。扩展只连 127.0.0.1，真正的 Codex 登录态留在本机桥接服务里。"
                  : "你的 Key 只存在本地，不会上传到任何地方。"}
              </div>
            </div>
            <div className="settings-key-row">
              <input
                id="settings-api-key"
                className="settings-input"
                type="password"
                value={currentProviderConfig.apiKey}
                onChange={(e) => handleKeyChange(e.target.value)}
                placeholder={isCodex ? "默认 bait-local-codex" : "填入你的 API Key"}
                aria-label={isCodex ? "Codex 本机桥接 Token" : `${providerInfo.label} API Key`}
              />
              <button
                className="settings-verify-btn"
                onClick={handleVerify}
                disabled={status === "checking"}
                type="button"
              >
                {status === "checking" ? "验证中" : "测试连接"}
              </button>
            </div>
          </div>
          {(status === "ok" || status === "error") && (
            <div className={`settings-verify-result ${status}`}>
              {status === "ok" ? "连接成功" : verifyError}
            </div>
          )}
          <div className="settings-field-grid settings-model-setting">
            <div className="settings-field">
              <label className="settings-label" htmlFor="settings-model">模型</label>
              <div className="settings-desc">翻译建议用快模型，深度分析再换更强模型。</div>
            </div>
            <div>
              <select
                id="settings-model"
                className="settings-select"
                value={currentProviderConfig.model}
                onChange={(e) => handleModelChange(e.target.value)}
                aria-label="选择模型"
              >
                {providerInfo.models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="settings-model-info">{providerInfo.hint}</div>
        </GlassCard>
      </div>

      <div className="settings-section rv">
        <div className="settings-section-title">本地数据</div>
        <GlassCard className="settings-card settings-danger-card">
          <div className="settings-data-reset-row">
            <div>
              <div className="settings-card-title">重新开始学习记录</div>
              <div className="settings-desc">清空本地生词、语境、句式、复习项和缓存，保留 API 配置。</div>
            </div>
            <button
              className="settings-danger-btn"
              onClick={handleResetLearningData}
              disabled={resetStatus === "resetting"}
              type="button"
            >
              {resetStatus === "resetting" ? "清空中" : "清空学习数据"}
            </button>
          </div>
          {resetStatus === "done" && (
            <div className="settings-reset-result ok">已清空。刷新管理页后会从 0 开始。</div>
          )}
          {resetStatus === "error" && (
            <div className="settings-reset-result error">清空失败，请重新打开管理页再试。</div>
          )}
        </GlassCard>
      </div>
    </>
  );
}
