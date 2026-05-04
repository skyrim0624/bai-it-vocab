/**
 * 生成插件注入的 CSS
 * 设计原则：克制、优雅，不抢视觉焦点，但让结构一目了然
 */
export const ENLEARN_STYLES = `
/* 分块容器 — 不用 position:relative，避免挡住 Reddit 等站点的覆盖导航链接 */
.enlearn-chunked {
  display: block !important;
  font-family: inherit;
  font-size: inherit;
  line-height: 1.5;
  padding: 0;
  margin: 1px 0;
  background: transparent;
  border-radius: 0;
  transition: background 0.2s;
}

.enlearn-chunked:hover {
  background: rgba(37, 99, 235, 0.03);
}

/* 段落间距 */
.enlearn-para-break { display: block !important; height: 0.8em; }

/* 缩进层级 */
.enlearn-line { display: block !important; }
.enlearn-indent-0 { padding-left: 0; }
.enlearn-indent-1 { padding-left: 1.0em; }
.enlearn-indent-2 { padding-left: 2.0em; }
.enlearn-indent-3 { padding-left: 3.0em; }
.enlearn-indent-4 { padding-left: 4.0em; }
.enlearn-indent-5 { padding-left: 5.0em; }

/* 颜色层级 — 主句正常色，从句逐级变淡 */
.enlearn-depth-0 { opacity: 1; }
.enlearn-depth-1 { opacity: 0.75; }
.enlearn-depth-2 { opacity: 0.55; }
.enlearn-depth-3 { opacity: 0.45; }
.enlearn-depth-4 { opacity: 0.38; }
.enlearn-depth-5 { opacity: 0.32; }

/* L2/L1：inline 模式容器 */
.enlearn-chunked-inline .enlearn-inline-content {
  display: inline;
}

/* L2：行内分隔符 */
.enlearn-separator {
  margin: 0 0.3em;
  color: rgba(37, 99, 235, 0.35);
  user-select: none;
  font-weight: 400;
}

/* L1：从句变淡 */
.enlearn-dim {
  opacity: 0.5;
}

/* 生词轻标记 */
.enlearn-word {
  border-bottom: 1px dotted rgba(37, 99, 235, 0.45);
  cursor: pointer;
  transition: border-color 0.15s;
}

.enlearn-word:hover {
  border-bottom-color: #2563eb;
}

/* 全局浮窗 — position:fixed 挂在 body，永远不被容器裁剪 */
.enlearn-tooltip {
  position: fixed;
  display: none;
  background: rgba(255, 255, 255, 0.96);
  color: #111827;
  padding: 12px;
  border: 1px solid rgba(15, 23, 42, 0.10);
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.5;
  white-space: normal;
  z-index: 2147483647;
  pointer-events: auto;
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.18), 0 4px 12px rgba(15, 23, 42, 0.10);
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  display: none;
  align-items: stretch;
  gap: 12px;
  max-width: min(420px, calc(100vw - 16px));
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.enlearn-tooltip-main {
  min-width: 0;
  max-width: 300px;
}

.enlearn-tooltip-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.enlearn-tooltip-word {
  font-weight: 700;
  color: #0f172a;
  font-size: 15px;
  line-height: 1.2;
}

.enlearn-tooltip-phonetic {
  color: #64748b;
  font-size: 12px;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

.enlearn-tooltip-def {
  display: block;
  color: #334155;
  font-size: 13px;
  line-height: 1.55;
  margin-top: 6px;
}

.enlearn-tooltip-source {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  color: #64748b;
  font-size: 11px;
  line-height: 1.2;
}

.enlearn-tooltip-source::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.12);
}

.enlearn-tooltip-source.is-loading::before {
  background: #f59e0b;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.14);
  animation: enlearn-source-pulse 0.9s ease-in-out infinite;
}

.enlearn-tooltip-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.enlearn-tooltip-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 36px;
  padding: 0;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  color: #475569;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.18s ease;
  font-family: inherit;
  line-height: 1;
  flex-shrink: 0;
}

.enlearn-tooltip-btn svg {
  width: 17px;
  height: 17px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.enlearn-tooltip-btn:hover {
  background: #ecfeff;
  border-color: #67e8f9;
  color: #0f766e;
  transform: translateY(-1px);
}

.enlearn-tooltip-add {
  width: auto;
  min-width: 42px;
  padding: 0 12px;
  background: #0f172a;
  border-color: #0f172a;
  color: #ffffff;
}

.enlearn-tooltip-add:hover,
.enlearn-tooltip-btn.is-done {
  background: #16a34a;
  border-color: #16a34a;
  color: #ffffff;
}

@keyframes enlearn-source-pulse {
  0%, 100% { opacity: 0.55; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1.08); }
}

/* 手动触发按钮 — inline 显示，不会被 overflow:hidden 裁剪 */
.enlearn-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  vertical-align: middle;
  width: 18px;
  height: 18px;
  margin-left: 6px;
  border-radius: 4px;
  background: transparent;
  border: none;
  color: rgba(37, 99, 235, 0.35);
  cursor: pointer;
  opacity: 0.2;
  transition: all 0.2s;
  user-select: none;
  padding: 0;
  line-height: 1;
  pointer-events: auto !important;
}

.enlearn-trigger svg {
  width: 14px;
  height: 14px;
}

.enlearn-trigger.enlearn-trigger-visible {
  opacity: 0.6;
}

.enlearn-trigger:hover {
  opacity: 1 !important;
  background: rgba(37, 99, 235, 0.08);
  color: #2563eb;
}

.enlearn-trigger.enlearn-trigger-loading {
  opacity: 1;
  pointer-events: none;
  animation: enlearn-pulse 1s ease-in-out infinite;
}

@keyframes enlearn-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

/* 加载中状态 — shimmer 效果 */
.enlearn-loading {
  position: relative;
  overflow: hidden;
}

.enlearn-loading::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(37, 99, 235, 0.06) 50%,
    transparent 100%
  );
  animation: enlearn-shimmer 1.5s ease-in-out infinite;
}

@keyframes enlearn-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

/* 隐藏原始元素（兄弟插入策略：原始元素隐藏，分块作为兄弟显示） */
.enlearn-original-hidden {
  display: none !important;
}

/* 覆盖截断样式，使分块内容完全可见（Twitter line-clamp / Reddit -webkit-box 等）
   注意：不在 CSS 中设 display:block，只在 JS 中对 webkit-box 元素设（避免破坏 flex 布局） */
.enlearn-clamp-override {
  -webkit-line-clamp: unset !important;
  -webkit-box-orient: unset !important;
  max-height: none !important;
  overflow: visible !important;
  text-overflow: unset !important;
}

/* 暂停状态 — 显示原文、隐藏分块 */
body.enlearn-paused .enlearn-chunked { display: none !important; }
body.enlearn-paused .enlearn-trigger { display: none !important; }
body.enlearn-paused .enlearn-original-hidden { display: block !important; }

/* 暗色模式适配 */
@media (prefers-color-scheme: dark) {
  .enlearn-chunked:hover {
    background: rgba(96, 165, 250, 0.05);
  }

  .enlearn-word {
    border-bottom-color: rgba(96, 165, 250, 0.45);
  }

  .enlearn-word:hover {
    border-bottom-color: #60a5fa;
  }

  .enlearn-tooltip {
    background: rgba(15, 23, 42, 0.96);
    color: #e2e8f0;
    border-color: rgba(148, 163, 184, 0.20);
    box-shadow: 0 18px 44px rgba(0,0,0,0.38), 0 4px 12px rgba(0,0,0,0.28);
  }

  .enlearn-tooltip-word {
    color: #f8fafc;
  }

  .enlearn-tooltip-phonetic,
  .enlearn-tooltip-source {
    color: #94a3b8;
  }

  .enlearn-tooltip-def {
    color: #cbd5e1;
  }

  .enlearn-tooltip-btn {
    background: rgba(30, 41, 59, 0.95);
    border-color: rgba(148, 163, 184, 0.24);
    color: #cbd5e1;
  }

  .enlearn-tooltip-btn:hover {
    background: rgba(20, 184, 166, 0.16);
    border-color: rgba(45, 212, 191, 0.52);
    color: #5eead4;
  }

  .enlearn-tooltip-add {
    background: #e2e8f0;
    border-color: #e2e8f0;
    color: #0f172a;
  }

  .enlearn-tooltip-add:hover,
  .enlearn-tooltip-btn.is-done {
    background: #22c55e;
    border-color: #22c55e;
    color: #052e16;
  }

  .enlearn-trigger {
    color: rgba(96, 165, 250, 0.35);
  }

  .enlearn-trigger:hover {
    opacity: 1 !important;
    background: rgba(96, 165, 250, 0.12);
    color: #60a5fa;
  }

  .enlearn-separator {
    color: rgba(96, 165, 250, 0.35);
  }

  .enlearn-loading::after {
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(96, 165, 250, 0.08) 50%,
      transparent 100%
    );
  }

}
`;
