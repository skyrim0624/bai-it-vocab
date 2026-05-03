import { useCallback, useEffect, useMemo, useState } from "react";
import type { VocabRecord, VocabStatus } from "../../shared/types.ts";
import { vocabContextDAO, vocabDAO } from "../../shared/db.ts";
import {
  buildVocabEntries,
  exportVocabToCsv,
  exportVocabToMarkdown,
  type VocabWithContexts,
} from "../../shared/vocab-export.ts";
import { EmptyState } from "../components/EmptyState.tsx";
import { GlassCard } from "../components/GlassCard.tsx";
import { FilterChip } from "../components/FilterChip.tsx";

type StatusFilter = VocabStatus | "all";
type SortKey = "recent" | "count" | "word";

interface VocabBookProps {
  db: IDBDatabase | null;
}

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "全部",
  new: "新词",
  learning: "学习中",
  mastered: "已掌握",
};

const SORT_LABELS: Record<SortKey, string> = {
  recent: "最近遇到",
  count: "高频优先",
  word: "A-Z",
};

function formatDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function extractDomain(url?: string): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

async function syncKnownWord(word: string, mastered: boolean): Promise<void> {
  const stored = await chrome.storage.local.get({ knownWords: [] });
  const words = Array.isArray(stored.knownWords) ? stored.knownWords as string[] : [];
  const next = new Set(words.map((w) => w.toLowerCase()));

  if (mastered) {
    next.add(word.toLowerCase());
  } else {
    next.delete(word.toLowerCase());
  }

  await chrome.storage.local.set({ knownWords: [...next] });
}

function downloadText(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function VocabBook({ db }: VocabBookProps) {
  const [entries, setEntries] = useState<VocabWithContexts[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("recent");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!db) return;

    const [vocab, contexts] = await Promise.all([
      vocabDAO.getAll(db),
      vocabContextDAO.getAll(db),
    ]);
    setEntries(buildVocabEntries(vocab, contexts));
    setLoading(false);
  }, [db]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredEntries = useMemo(() => {
    const keyword = query.trim().toLowerCase();

    return entries
      .filter(({ vocab, contexts }) => {
        if (statusFilter !== "all" && vocab.status !== statusFilter) return false;
        if (!keyword) return true;

        return (
          vocab.word.toLowerCase().includes(keyword) ||
          (vocab.definition ?? "").toLowerCase().includes(keyword) ||
          contexts.some((ctx) =>
            `${ctx.sentence} ${ctx.context_definition} ${ctx.source_url}`.toLowerCase().includes(keyword)
          )
        );
      })
      .sort((a, b) => {
        if (sortKey === "word") return a.vocab.word.localeCompare(b.vocab.word);
        if (sortKey === "count") return b.vocab.encounter_count - a.vocab.encounter_count;

        const aTime = a.contexts[0]?.created_at ?? a.vocab.first_seen_at;
        const bTime = b.contexts[0]?.created_at ?? b.vocab.first_seen_at;
        return bTime - aTime;
      });
  }, [entries, query, sortKey, statusFilter]);

  const updateStatus = async (vocab: VocabRecord, status: VocabStatus) => {
    if (!db) return;

    const updated = await vocabDAO.update(db, vocab.id, {
      status,
      mastered_at: status === "mastered" ? Date.now() : undefined,
    });
    if (!updated) return;

    await syncKnownWord(updated.word, status === "mastered");
    setEntries((current) =>
      current.map((entry) =>
        entry.vocab.id === updated.id ? { ...entry, vocab: updated } : entry
      )
    );
  };

  const exportMarkdown = () => {
    downloadText(
      `bai-it-vocab-${formatDate(Date.now())}.md`,
      exportVocabToMarkdown(filteredEntries),
      "text/markdown;charset=utf-8"
    );
  };

  const exportCsv = () => {
    downloadText(
      `bai-it-vocab-${formatDate(Date.now())}.csv`,
      exportVocabToCsv(filteredEntries),
      "text/csv;charset=utf-8"
    );
  };

  if (loading) return null;

  if (entries.length === 0) {
    return <EmptyState text="还没有生词，去浏览英文网页，标出来的词会自动攒在这" />;
  }

  return (
    <>
      <div className="vocab-book-head rv">
        <div>
          <div className="section-head" style={{ marginBottom: 4 }}>生词本</div>
          <div className="vocab-book-sub">
            {entries.length} 个词 · {entries.reduce((sum, entry) => sum + entry.contexts.length, 0)} 条语境
          </div>
        </div>
        <div className="vocab-export-actions">
          <button className="vocab-export-btn" onClick={exportMarkdown} type="button">导出 Markdown</button>
          <button className="vocab-export-btn" onClick={exportCsv} type="button">导出 CSV</button>
        </div>
      </div>

      <div className="vocab-toolbar rv">
        <input
          className="vocab-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索单词、释义、原句或来源"
        />
        <select
          className="vocab-sort"
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
        >
          {Object.entries(SORT_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      <div className="filter-bar rv">
        {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((status) => (
          <FilterChip
            key={status}
            label={STATUS_LABELS[status]}
            active={statusFilter === status}
            onClick={() => setStatusFilter(status)}
          />
        ))}
      </div>

      {filteredEntries.length === 0 ? (
        <EmptyState text="没有符合筛选条件的生词" />
      ) : (
        <div className="vocab-list">
          {filteredEntries.map(({ vocab, contexts }) => {
            const expanded = expandedId === vocab.id;
            const latestContext = contexts[0];

            return (
              <GlassCard
                key={vocab.id}
                className={`vocab-card ${expanded ? "expanded" : ""}`}
                onClick={() => setExpandedId(expanded ? null : vocab.id)}
              >
                <div className="vocab-card-main">
                  <div>
                    <div className="vocab-card-word">{vocab.word}</div>
                    <div className="vocab-card-def">{vocab.definition || latestContext?.context_definition || ""}</div>
                  </div>
                  <div className="vocab-card-meta">
                    <span className={`vocab-status ${vocab.status}`}>{STATUS_LABELS[vocab.status]}</span>
                    <span>×{vocab.encounter_count}</span>
                    <span>{formatDate(vocab.first_seen_at)}</span>
                  </div>
                </div>

                {latestContext && !expanded && (
                  <div className="vocab-card-sample">
                    {latestContext.sentence}
                    {latestContext.source_url && (
                      <span> · {extractDomain(latestContext.source_url)}</span>
                    )}
                  </div>
                )}

                {expanded && (
                  <>
                    <div className="vocab-status-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        className={vocab.status === "new" ? "active" : ""}
                        onClick={() => updateStatus(vocab, "new")}
                        type="button"
                      >
                        新词
                      </button>
                      <button
                        className={vocab.status === "learning" ? "active" : ""}
                        onClick={() => updateStatus(vocab, "learning")}
                        type="button"
                      >
                        学习中
                      </button>
                      <button
                        className={vocab.status === "mastered" ? "active" : ""}
                        onClick={() => updateStatus(vocab, "mastered")}
                        type="button"
                      >
                        已掌握
                      </button>
                    </div>

                    <div className="vocab-context-list">
                      {contexts.length === 0 ? (
                        <div className="vocab-context-empty">暂无语境</div>
                      ) : contexts.map((ctx) => (
                        <div key={ctx.id} className="vocab-context">
                          <div className="vocab-context-sentence">{ctx.sentence}</div>
                          {ctx.context_definition && (
                            <div className="vocab-context-def">{ctx.context_definition}</div>
                          )}
                          <div className="vocab-context-source">
                            {extractDomain(ctx.source_url)} · {formatDate(ctx.created_at)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </GlassCard>
            );
          })}
        </div>
      )}
    </>
  );
}
