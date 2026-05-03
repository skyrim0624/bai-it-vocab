import { useState, useEffect } from "react";
import type { LearningRecord, VocabRecord } from "../../shared/types.ts";
import { learningRecordDAO, vocabContextDAO, vocabDAO } from "../../shared/db.ts";
import { EXAMPLE_REVIEW } from "../exampleData.ts";

export interface ReviewData {
  /** Today's sentence for break-point practice (prioritize "valuable" ones) */
  practiseSentence: LearningRecord | null;
  /** Today's vocab words (from learning records) */
  todayVocab: (VocabRecord & { encounterToday: number })[];
  /** This week's sentence count */
  weekSentenceCount: number;
  loading: boolean;
}

export function useReviewData(db: IDBDatabase | null, isExample?: boolean): ReviewData {
  const [data, setData] = useState<ReviewData>({
    practiseSentence: null,
    todayVocab: [],
    weekSentenceCount: 0,
    loading: true,
  });

  useEffect(() => {
    if (isExample) {
      setData(EXAMPLE_REVIEW);
      return;
    }

    if (!db) return;

    async function load() {
      const now = Date.now();
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayMs = todayStart.getTime();

      // Week start (Monday)
      const weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
      const weekStartMs = weekStart.getTime();

      const [allRecords, allVocab, allContexts] = await Promise.all([
        learningRecordDAO.getAll(db!),
        vocabDAO.getAll(db!),
        vocabContextDAO.getAll(db!),
      ]);

      // This week's records
      const weekRecords = allRecords.filter((r) => r.created_at >= weekStartMs);
      const weekSentenceCount = weekRecords.length;

      // Today's records
      const todayRecords = allRecords.filter((r) => r.created_at >= todayMs);

      // Pick practice sentence: prefer today's "valuable" ones (has pattern_key + sentence_analysis)
      // Then fall back to recent ones
      const valuable = todayRecords.filter((r) => r.pattern_key && r.sentence_analysis);
      const practiseSentence =
        valuable.length > 0
          ? valuable[Math.floor(Math.random() * valuable.length)]
          : todayRecords.length > 0
            ? todayRecords[Math.floor(Math.random() * todayRecords.length)]
            : allRecords.length > 0
              ? allRecords[Math.floor(Math.random() * allRecords.length)]
              : null;

      // Collect vocab from today's real encounter contexts
      const vocabIdToWord = new Map(allVocab.map((v) => [v.id, v.word.toLowerCase()]));
      const todayWordSet = new Map<string, number>();
      for (const ctx of allContexts.filter((c) => c.created_at >= todayMs)) {
        const key = vocabIdToWord.get(ctx.vocab_id);
        if (!key) continue;
        todayWordSet.set(key, (todayWordSet.get(key) ?? 0) + 1);
      }

      // Match with vocab records for status info
      const todayVocab = allVocab
        .filter((v) => todayWordSet.has(v.word.toLowerCase()))
        .map((v) => ({
          ...v,
          encounterToday: todayWordSet.get(v.word.toLowerCase()) ?? 0,
        }));

      setData({ practiseSentence, todayVocab, weekSentenceCount, loading: false });
    }

    load();
  }, [db, isExample]);

  return data;
}
