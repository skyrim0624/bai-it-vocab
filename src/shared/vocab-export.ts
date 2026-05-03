import type { VocabContextRecord, VocabRecord } from "./types.ts";

export interface VocabWithContexts {
  vocab: VocabRecord;
  contexts: VocabContextRecord[];
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function csvCell(value: string | number | undefined): string {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildVocabEntries(
  vocab: VocabRecord[],
  contexts: VocabContextRecord[]
): VocabWithContexts[] {
  const contextMap = new Map<string, VocabContextRecord[]>();
  for (const ctx of contexts) {
    const list = contextMap.get(ctx.vocab_id) ?? [];
    list.push(ctx);
    contextMap.set(ctx.vocab_id, list);
  }

  return vocab.map((item) => ({
    vocab: item,
    contexts: (contextMap.get(item.id) ?? []).sort((a, b) => b.created_at - a.created_at),
  }));
}

export function exportVocabToMarkdown(entries: VocabWithContexts[]): string {
  const lines = ["# 掰 it 生词本", ""];

  for (const { vocab, contexts } of entries) {
    lines.push(`## ${vocab.word}`);
    lines.push("");
    lines.push(`- 状态：${vocab.status}`);
    lines.push(`- 释义：${vocab.definition || ""}`);
    lines.push(`- 遇到次数：${vocab.encounter_count}`);
    lines.push(`- 首次遇到：${formatDate(vocab.first_seen_at)}`);

    if (contexts.length > 0) {
      lines.push("- 语境：");
      for (const ctx of contexts) {
        lines.push(`  - ${ctx.sentence}`);
        if (ctx.context_definition) lines.push(`    - 语境释义：${ctx.context_definition}`);
        if (ctx.source_url) lines.push(`    - 来源：${ctx.source_url}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}

export function exportVocabToCsv(entries: VocabWithContexts[]): string {
  const rows = [
    ["word", "status", "definition", "encounter_count", "first_seen_at", "sentence", "context_definition", "source_url"],
  ];

  for (const { vocab, contexts } of entries) {
    if (contexts.length === 0) {
      rows.push([
        vocab.word,
        vocab.status,
        vocab.definition ?? "",
        String(vocab.encounter_count),
        formatDate(vocab.first_seen_at),
        "",
        "",
        "",
      ]);
      continue;
    }

    for (const ctx of contexts) {
      rows.push([
        vocab.word,
        vocab.status,
        vocab.definition ?? "",
        String(vocab.encounter_count),
        formatDate(vocab.first_seen_at),
        ctx.sentence,
        ctx.context_definition,
        ctx.source_url,
      ]);
    }
  }

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}
