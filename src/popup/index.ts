/**
 * Popup — 弹出窗口
 *
 * 职责：
 * 1. 当前网站总开关：控制掰 it 是否注入当前域名
 * 2. 掰句子开关：站点级控制自动拆句，默认开启
 * 3. 单词翻译开关：站点级控制点词查释义和生词标注，默认关闭
 * 4. 掰句显示设置：辅助力度 + 显示方式
 */

import type { Message, BaitConfig } from "../shared/types.ts";

// ========== DOM 元素 ==========

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const siteName = $("site-name");
const siteDomain = $("site-domain");
const actionBtn = $<HTMLButtonElement>("action-btn");
const actionText = $("action-text");
const siteState = $("site-state");
const chunkBtn = $<HTMLButtonElement>("chunk-toggle");
const chunkState = $("chunk-state");
const wordBtn = $<HTMLButtonElement>("word-toggle");
const wordState = $("word-state");
const content = $("content");
const sliderContainer = $("assist-slider");
const sliderFill = $("slider-fill");
const sliderThumb = $("slider-thumb");
const assistHint = $("assist-hint");
const segControl = $("seg-control");
const segPill = $("seg-pill");
const modeDesc = $("mode-desc");
const preview = $("preview");
const linkOptions = $<HTMLAnchorElement>("link-options");

// ========== 常量 ==========

const ASSIST_HINTS: Record<number, string> = {
  1: "只掰最难的句子",
  2: "复杂句才掰",
  3: "复杂句自动掰，简单句不打扰",
  4: "大部分长句都会掰",
  5: "尽量都掰开",
};

/** 辅助力度到底层配置的映射 */
const ASSIST_TO_CONFIG: Record<number, { chunkGranularity: "coarse" | "medium" | "fine"; scanThreshold: "short" | "medium" | "long"; sensitivity: number }> = {
  1: { chunkGranularity: "coarse", scanThreshold: "long", sensitivity: 5 },
  2: { chunkGranularity: "coarse", scanThreshold: "long", sensitivity: 4 },
  3: { chunkGranularity: "medium", scanThreshold: "medium", sensitivity: 3 },
  4: { chunkGranularity: "fine", scanThreshold: "short", sensitivity: 2 },
  5: { chunkGranularity: "fine", scanThreshold: "short", sensitivity: 1 },
};

/** 显示方式配置 */
const DISPLAY_MODES: Record<string, { desc: string; intensity: number; html: string }> = {
  structure: {
    desc: "掰成段，缩进显示主从关系",
    intensity: 5,
    html: `
      <span class="line line-main">She finished the project</span>
      <span class="line line-sub1">that no one thought was possible,</span>
      <span class="line line-sub2">before the deadline.</span>
    `,
  },
  lines: {
    desc: "只分行，不加额外标记",
    intensity: 3,
    html: `
      <span class="line">She finished the project</span>
      <span class="line">that no one thought was possible,</span>
      <span class="line">before the deadline.</span>
    `,
  },
  light: {
    desc: "不分行，次要部分变淡",
    intensity: 1,
    html: `<span class="line line-main">She finished the project</span><span class="dot"> · </span><span class="line line-sub">that no one thought was possible,</span><span class="dot"> · </span><span class="line line-sub">before the deadline.</span>`,
  },
};

type SiteFeature = "site" | "chunk" | "wordTranslation";

interface SiteFeatureState {
  siteEnabled: boolean;
  chunkEnabled: boolean;
  wordTranslationEnabled: boolean;
}

// ========== 滑杆 ==========

const SLIDER_MIN = 1;
const SLIDER_MAX = 5;
let currentLevel = 3;

function updateSliderVisuals(level: number): void {
  const pct = ((level - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 100;
  sliderFill.style.width = pct + "%";
  sliderThumb.style.left = pct + "%";
  sliderContainer.setAttribute("aria-valuenow", String(level));
  sliderContainer.setAttribute("aria-valuetext", ASSIST_HINTS[level]);
}

function getSliderLevelFromX(clientX: number): number {
  const rect = sliderContainer.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return Math.round(ratio * (SLIDER_MAX - SLIDER_MIN) + SLIDER_MIN);
}

// ========== 状态 ==========

let currentTab: chrome.tabs.Tab | null = null;
let currentHostname = "";
let siteEnabled = true;
let chunkEnabled = true;
let wordTranslationEnabled = false;

// ========== 通信 ==========

function sendMessage(message: Message): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}

// ========== 辅助力度：从配置推导滑杆值 ==========

function configToAssistLevel(config: BaitConfig): number {
  const s = config.sensitivity;
  if (s >= 5) return 1;
  if (s >= 4) return 2;
  if (s >= 3) return 3;
  if (s >= 2) return 4;
  return 5;
}

// ========== 显示方式：从渲染强度推导模式 ==========

function intensityToMode(intensity: number): string {
  if (intensity >= 4) return "structure";
  if (intensity >= 2) return "lines";
  return "light";
}

// ========== UI 更新 ==========

function setFeatureButton(
  button: HTMLButtonElement,
  stateEl: HTMLElement,
  enabled: boolean,
  disabled: boolean
): void {
  button.classList.toggle("is-on", enabled);
  button.classList.toggle("is-off", !enabled);
  button.classList.toggle("is-disabled", disabled);
  button.disabled = disabled;
  button.setAttribute("aria-pressed", String(enabled));
  stateEl.textContent = enabled ? "开启" : "关闭";
}

function applyState(state: SiteFeatureState): void {
  siteEnabled = state.siteEnabled;
  chunkEnabled = state.chunkEnabled;
  wordTranslationEnabled = state.wordTranslationEnabled;
  updateControls();
}

function updateControls(): void {
  const hasSite = Boolean(currentHostname);

  actionBtn.className = `action-btn ${siteEnabled ? "is-on" : "is-off"}`;
  actionBtn.disabled = !hasSite;
  actionBtn.setAttribute("aria-pressed", String(siteEnabled));
  actionText.textContent = siteEnabled ? "此网站开启掰 it" : "此网站关闭掰 it";
  siteState.textContent = siteEnabled ? "开启" : "关闭";

  setFeatureButton(chunkBtn, chunkState, chunkEnabled, !hasSite || !siteEnabled);
  setFeatureButton(wordBtn, wordState, wordTranslationEnabled, !hasSite || !siteEnabled);

  content.classList.toggle("disabled", !siteEnabled || !chunkEnabled);
}

function setDisplayMode(modeKey: string): void {
  const mode = DISPLAY_MODES[modeKey];
  if (!mode) return;

  const btns = segControl.querySelectorAll(".seg-btn");
  let activeIndex = 0;
  btns.forEach((btn, i) => {
    const isActive = (btn as HTMLElement).dataset.mode === modeKey;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
    if (isActive) activeIndex = i;
  });
  segPill.style.transform = `translateX(${activeIndex * 100}%)`;

  modeDesc.textContent = mode.desc;
  preview.className = "display-preview mode-" + modeKey;
  preview.innerHTML = mode.html;
}

async function setSiteFeature(feature: SiteFeature, enabled: boolean): Promise<void> {
  if (!currentHostname) return;

  const result = (await sendMessage({
    type: "setSiteFeature",
    hostname: currentHostname,
    feature,
    enabled,
  })) as SiteFeatureState;

  applyState(result);
}

// ========== 初始化 ==========

async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab ?? null;

  if (currentTab?.url) {
    try {
      currentHostname = new URL(currentTab.url).hostname;
    } catch {
      currentHostname = "";
    }
  }

  siteName.textContent = currentHostname || "—";
  siteDomain.textContent = currentHostname || "—";

  if (currentTab?.id && currentHostname) {
    const result = (await sendMessage({
      type: "getTabState",
      tabId: currentTab.id,
      hostname: currentHostname,
    })) as SiteFeatureState & { state: "active" | "paused" | "disabled" };

    applyState({
      siteEnabled: result.siteEnabled ?? result.state !== "disabled",
      chunkEnabled: result.chunkEnabled ?? result.state === "active",
      wordTranslationEnabled: result.wordTranslationEnabled ?? false,
    });
  } else {
    applyState({ siteEnabled: false, chunkEnabled: false, wordTranslationEnabled: false });
  }

  const config = (await sendMessage({ type: "getConfig" })) as BaitConfig;

  const assistLevel = configToAssistLevel(config);
  currentLevel = assistLevel;
  updateSliderVisuals(currentLevel);
  assistHint.textContent = ASSIST_HINTS[assistLevel];

  const currentMode = intensityToMode(config.chunkIntensity);
  setDisplayMode(currentMode);
  updateControls();

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sliderContainer.classList.remove("no-transition");
      segControl.classList.remove("no-transition");
    });
  });

  // ===== 事件绑定 =====

  actionBtn.addEventListener("click", () => {
    setSiteFeature("site", !siteEnabled).catch(() => {});
  });

  chunkBtn.addEventListener("click", () => {
    setSiteFeature("chunk", !chunkEnabled).catch(() => {});
  });

  wordBtn.addEventListener("click", () => {
    setSiteFeature("wordTranslation", !wordTranslationEnabled).catch(() => {});
  });

  let isDragging = false;

  sliderContainer.addEventListener("pointerdown", (e) => {
    isDragging = true;
    sliderContainer.setPointerCapture(e.pointerId);
    const level = getSliderLevelFromX(e.clientX);
    if (level !== currentLevel) {
      currentLevel = level;
      updateSliderVisuals(currentLevel);
      assistHint.textContent = ASSIST_HINTS[currentLevel];
    }
  });

  sliderContainer.addEventListener("pointermove", (e) => {
    if (!isDragging) return;
    const level = getSliderLevelFromX(e.clientX);
    if (level !== currentLevel) {
      currentLevel = level;
      updateSliderVisuals(currentLevel);
      assistHint.textContent = ASSIST_HINTS[currentLevel];
    }
  });

  sliderContainer.addEventListener("pointerup", async () => {
    if (!isDragging) return;
    isDragging = false;
    await sendMessage({ type: "updateConfig", config: ASSIST_TO_CONFIG[currentLevel] });
  });

  sliderContainer.addEventListener("keydown", async (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    if (e.key === "Home") currentLevel = SLIDER_MIN;
    if (e.key === "End") currentLevel = SLIDER_MAX;
    if (e.key === "ArrowLeft") currentLevel = Math.max(SLIDER_MIN, currentLevel - 1);
    if (e.key === "ArrowRight") currentLevel = Math.min(SLIDER_MAX, currentLevel + 1);
    updateSliderVisuals(currentLevel);
    assistHint.textContent = ASSIST_HINTS[currentLevel];
    await sendMessage({ type: "updateConfig", config: ASSIST_TO_CONFIG[currentLevel] });
  });

  segControl.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest(".seg-btn") as HTMLElement | null;
    if (!btn || btn.classList.contains("active")) return;

    const modeKey = btn.dataset.mode!;
    setDisplayMode(modeKey);

    const mode = DISPLAY_MODES[modeKey];
    await sendMessage({
      type: "updateConfig",
      config: { chunkIntensity: mode.intensity },
    });
  });

  linkOptions.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

init();
