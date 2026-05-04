import { useState, useMemo, useCallback } from "react";

interface BreakPointSentenceProps {
  sentence: string;
  onBreakCountChange?: (count: number) => void;
}

/**
 * 裸句中可点击位置插入/移除竖线断点
 * 断点位置：每个单词之间（空格处）
 */
export function BreakPointSentence({ sentence, onBreakCountChange }: BreakPointSentenceProps) {
  const words = useMemo(() => sentence.split(/\s+/), [sentence]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const toggleBreak = useCallback((index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      onBreakCountChange?.(next.size);
      return next;
    });
  }, [onBreakCountChange]);

  return (
    <span>
      {words.map((word, i) => (
        <span key={i}>
          {word}
          {i < words.length - 1 && (
            <>
              {" "}
              <button
                type="button"
                className={`break-point ${selected.has(i) ? "selected" : ""}`}
                aria-pressed={selected.has(i)}
                aria-label={`在第 ${i + 1} 个单词后断句`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleBreak(i);
                }}
              />
              {" "}
            </>
          )}
        </span>
      ))}
    </span>
  );
}
