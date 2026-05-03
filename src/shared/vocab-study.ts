import type {
  StudyAdviceResult,
  VocabContextRecord,
  VocabPracticeSentence,
  VocabRecord,
} from "./types.ts";
import type { VocabWithContexts } from "./vocab-export.ts";

const LOCAL_TEMPLATES = [
  "The word {word} becomes easier to remember when you connect it to a real situation.",
  "A clear example of {word} can help you read similar sentences faster next time.",
  "When you see {word} in a paragraph, pause and ask what role it plays in the sentence.",
  "The author used {word} to make the idea more precise instead of using a simple common word.",
  "Try to say one sentence with {word} before you mark it as familiar.",
];

function normalizeDefinition(definition?: string): string {
  return definition?.trim() || "暂无释义";
}

function latestContext(contexts: VocabContextRecord[]): VocabContextRecord | undefined {
  return [...contexts].sort((a, b) => b.created_at - a.created_at)[0];
}

function statusScore(status: VocabRecord["status"]): number {
  if (status === "new") return 3;
  if (status === "learning") return 2;
  return 1;
}

function pickEntries(entries: VocabWithContexts[]): VocabWithContexts[] {
  return [...entries].sort((a, b) => {
    const statusDiff = statusScore(b.vocab.status) - statusScore(a.vocab.status);
    if (statusDiff !== 0) return statusDiff;
    return b.vocab.encounter_count - a.vocab.encounter_count;
  });
}

export function generateLocalPracticeSentence(
  entries: VocabWithContexts[],
  requestedWord?: string
): VocabPracticeSentence | null {
  const picked = requestedWord
    ? entries.find((entry) => entry.vocab.word.toLowerCase() === requestedWord.toLowerCase())
    : pickEntries(entries)[Math.floor(Math.random() * Math.max(1, entries.length))];

  if (!picked) return null;

  const context = latestContext(picked.contexts);
  if (context?.sentence) {
    return {
      word: picked.vocab.word,
      definition: normalizeDefinition(picked.vocab.definition || context.context_definition),
      sentence: context.sentence,
      chinese_hint: context.context_definition || picked.vocab.definition || "读完后复述这句话的意思。",
      source: "context",
    };
  }

  const template = LOCAL_TEMPLATES[Math.floor(Math.random() * LOCAL_TEMPLATES.length)];
  return {
    word: picked.vocab.word,
    definition: normalizeDefinition(picked.vocab.definition),
    sentence: template.replace("{word}", picked.vocab.word),
    chinese_hint: `先读句子，再用中文说出 ${picked.vocab.word} 在句中的作用。`,
    source: "local",
  };
}

export function buildCodexStudyPrompt(entries: VocabWithContexts[]): string {
  const picked = pickEntries(entries).slice(0, 30);
  const lines = [
    "请基于下面的掰 it 生词数据，评估我的英语阅读水平，并给出下一步学习建议。",
    "",
    "要求：",
    "- 用简体中文回答",
    "- 帮我挑需要优先复习的词",
    "- 帮我引申每个词的常见搭配和近义词辨析",
    "- 给我 7 天学习安排",
    "",
    "生词数据：",
  ];

  for (const entry of picked) {
    const context = latestContext(entry.contexts);
    lines.push(`- ${entry.vocab.word} | ${entry.vocab.status} | ${entry.vocab.definition || ""} | 遇到 ${entry.vocab.encounter_count} 次`);
    if (context) lines.push(`  语境：${context.sentence}`);
  }

  return lines.join("\n");
}

export function buildLocalStudyAdvice(entries: VocabWithContexts[]): StudyAdviceResult {
  const total = entries.length;
  const mastered = entries.filter((entry) => entry.vocab.status === "mastered").length;
  const learning = entries.filter((entry) => entry.vocab.status === "learning").length;
  const newWords = entries.filter((entry) => entry.vocab.status === "new").length;
  const masteredRate = total === 0 ? 0 : mastered / total;
  const averageContexts = total === 0
    ? 0
    : entries.reduce((sum, entry) => sum + entry.contexts.length, 0) / total;

  let level = "B1-B2";
  if (total >= 80 && averageContexts >= 1.5 && masteredRate >= 0.45) {
    level = "B2-C1";
  } else if (total >= 30 && masteredRate >= 0.25) {
    level = "B2";
  } else if (total < 12) {
    level = "A2-B1";
  }

  const priority = pickEntries(entries).slice(0, 12).map((entry) => entry.vocab.word);
  const expansion = entries
    .filter((entry) => entry.vocab.encounter_count >= 2)
    .slice(0, 8)
    .map((entry) => entry.vocab.word);

  return {
    level,
    summary: `当前生词本有 ${total} 个词，其中新词 ${newWords} 个、学习中 ${learning} 个、已掌握 ${mastered} 个。估计阅读水平约为 ${level}，这个判断主要基于生词规模、重复语境和掌握比例。`,
    next_steps: [
      "先把高频新词放进学习中，不急着一次性标记掌握。",
      "每天用 10 个生词做朗读句子，读完后用中文复述句意。",
      "对出现两次以上的词做搭配扩展，而不是只背中文释义。",
      "每周把已掌握词回看一次，确认在原句里仍然能秒懂。",
    ],
    review_words: priority,
    expansion_words: expansion,
    codex_prompt: buildCodexStudyPrompt(entries),
    source: "local",
  };
}
