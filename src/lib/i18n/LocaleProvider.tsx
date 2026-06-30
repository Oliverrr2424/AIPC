"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Locale = "en" | "zh";

const messages = {
  "nav.rag": ["RAG builder", "RAG 配置"],
  "nav.form": ["Form builder", "表单配置"],
  "nav.parts": ["Parts database", "配件数据库"],
  "nav.examples": ["Examples", "示例"],
  "nav.describe": ["Describe a build", "描述你的配置"],
  "nav.menu": ["Toggle menu", "展开菜单"],
  "theme.toggle": ["Toggle color theme", "切换明暗主题"],
  "language.toggle": ["Switch interface to Chinese", "将界面切换为英文"],
  "footer.description": ["RAG recommendations with deterministic compatibility checks. Prices are estimates, not live listings.", "基于 RAG 的装机推荐，并通过确定性规则检查兼容性。价格为估算值，并非实时挂牌价。"],
  "chat.eyebrow": ["RAG BUILDER", "RAG 装机助手"],
  "chat.title": ["Describe the work. Inspect the evidence.", "描述需求，检查依据。"],
  "chat.subtitle": ["Natural-language intent parsing, retrieved hardware knowledge, weighted scoring, and deterministic compatibility checks.", "自然语言意图解析、硬件知识检索、加权评分与确定性兼容检查。"],
  "chat.describe": ["Describe the machine you need", "描述你需要的电脑"],
  "chat.placeholder": ["Include budget, currency, workloads, preferences, and any parts you already own.", "请填写预算、币种、用途、偏好，以及已经拥有的配件。"],
  "chat.example": ["Example", "示例"],
  "chat.pipeline": ["RAG PIPELINE", "RAG 流程"],
  "chat.model": ["MODEL", "模型"],
  "chat.mode": ["MODE", "模式"],
  "chat.nonThinking": ["Fast", "快速"],
  "chat.thinking": ["Thinking", "思考"],
  "chat.modeHint": ["Mode switching applies to DeepSeek models.", "模式切换仅适用于 DeepSeek 模型。"],
  "chat.parse": ["Parse intent", "解析意图"],
  "chat.embed": ["Embed and retrieve", "向量化与检索"],
  "chat.score": ["Score candidates", "候选配件评分"],
  "chat.compatibility": ["Validate compatibility", "验证兼容性"],
  "chat.build": ["Build with RAG", "生成 RAG 配置"],
  "chat.retrieving": ["Retrieving evidence", "正在检索依据"],
  "chat.synthesizing": ["Synthesizing your build", "正在生成配置"],
  "conversation.eyebrow": ["ITERATE THE BASELINE", "继续调整当前配置"],
  "conversation.title": ["Refine it in plain language", "用自然语言继续修改"],
  "conversation.subtitle": ["Unmentioned parts stay locked unless compatibility requires a linked change.", "未提及的配件将保持不变，除非兼容性要求联动调整。"],
  "conversation.reset": ["New baseline", "新建配置"],
  "conversation.turn": ["turn", "轮对话"],
  "conversation.you": ["You", "你"],
  "conversation.agent": ["Build agent", "装机助手"],
  "conversation.thinking": ["Checking your request against the current build", "正在结合当前配置检查你的要求"],
  "conversation.placeholder": ["Try: 32GB RAM, a cheaper SSD, keep everything white", "例如：换成 32GB 内存，SSD 便宜一点，继续保持白色"],
  "conversation.update": ["Update build", "更新配置"],
  "conversation.updating": ["Updating", "正在更新"],
  "conversation.hint": ["Enter to send, Shift + Enter for a new line", "Enter 发送，Shift + Enter 换行"],
  "conversation.changed": ["changed", "已更改"],
  "conversation.linked": ["linked", "联动调整"],
  "conversation.suggestion.cheaper": ["Make it cheaper", "便宜一点"],
  "conversation.suggestion.quiet": ["Make it quieter", "更安静一点"],
  "conversation.suggestion.explain": ["Explain the GPU choice", "解释显卡选择"],
  "result.estimated": ["Estimated total", "预估总价"],
  "result.constraints": ["Interpreted constraints", "已解析约束"],
  "result.constraintsHint": ["Structured and validated before retrieval", "检索前完成结构化与校验"],
  "result.rules": ["rules", "条规则"],
  "result.reasoning": ["Retrieved reasoning", "检索与选择依据"],
  "result.reasoningHint": ["Why each winner survived scoring", "每个入选配件为何通过评分"],
  "result.candidates": ["Candidates considered", "已考虑候选"],
  "result.evidence": ["RAG evidence", "RAG 依据"],
  "result.evidenceHint": ["Knowledge chunks used by the explanation", "解释所引用的知识片段"],
  "result.chunks": ["chunks", "个片段"],
  "result.alternatives": ["Alternative builds", "备选配置"],
  "result.alternativesHint": ["Nearby paths from the same candidate pools", "来自同一候选池的相近方案"],
  "parts.title": ["Selected parts", "已选配件"],
  "parts.market": ["selections use current market quotes; fallbacks are marked low confidence.", "项使用当前市场报价，回退价格会标记为低置信度。"],
  "parts.catalog": ["Catalog estimates; live market data was unavailable.", "目录估价，实时市场数据暂不可用。"],
  "parts.components": ["components", "个配件"],
  "parts.category": ["Category", "类别"],
  "parts.product": ["Product", "产品"],
  "parts.specs": ["Key specs", "关键规格"],
  "parts.price": ["Price", "价格"],
  "parts.why": ["Why selected", "选择原因"],
  "compat.title": ["Compatibility checks", "兼容性检查"],
  "compat.subtitle": ["Deterministic rules, not AI judgment", "由确定性规则判断，而非 AI 猜测"],
  "performance.title": ["Performance profile", "性能概览"],
  "performance.subtitle": ["Internal relative scoring", "内部相对评分"],
  "benchmark.title": ["Benchmark estimates", "基准性能估算"],
  "benchmark.subtitle": ["From public reviews, not synthetic scores", "来自公开评测，而非合成分数"],
  "explanation.title": ["Build explanation", "配置说明"],
  "explanation.subtitle": ["Summary, trade-offs, and upgrade path", "总结、取舍与升级路径"],
} as const;

export type TranslationKey = keyof typeof messages;

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  toggleLocale: () => void;
  t: (key: TranslationKey) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
    localStorage.setItem("aipc:locale", next);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("aipc:locale");
    if (saved === "zh" || saved === "en") setLocale(saved);
  }, [setLocale]);

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    setLocale,
    toggleLocale: () => setLocale(locale === "en" ? "zh" : "en"),
    t: key => messages[key][locale === "en" ? 0 : 1],
  }), [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale must be used inside LocaleProvider");
  return value;
}
