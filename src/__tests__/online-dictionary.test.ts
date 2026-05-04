import { describe, expect, it } from "vitest";
import { lookupOnlineDictionary, normalizeLookupWord, parseYoudaoDictionary } from "../shared/online-dictionary.ts";

describe("在线词典解析", () => {
  it("优先解析有道基础词典释义和音标", () => {
    const result = parseYoudaoDictionary({
      ec: {
        word: [
          {
            usphone: "ˌserənˈdɪpəti",
            "return-phrase": { l: { i: "serendipity" } },
            trs: [
              { tr: [{ l: { i: ["n. 意外发现美好事物的运气，机缘巧合"] } }] },
            ],
          },
        ],
      },
    }, "Serendipity");

    expect(result).toEqual({
      word: "serendipity",
      definition: "n. 意外发现美好事物的运气，机缘巧合",
      phonetic: "/ˌserənˈdɪpəti/",
      source: "online",
      provider: "有道词典",
    });
  });

  it("基础词典缺失时回退到网络释义", () => {
    const result = parseYoudaoDictionary({
      web_trans: {
        "web-translation": [
          {
            key: "agentic",
            trans: [
              { value: "智能体式的" },
              { value: "能动的" },
            ],
          },
        ],
      },
    }, "agentic");

    expect(result?.definition).toBe("智能体式的；能动的");
    expect(result?.provider).toBe("有道网络释义");
  });

  it("查询在线词典时会规范化单词并解析响应", async () => {
    const fetchImpl = async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("q=synonymous");
      return new Response(JSON.stringify({
        ec: {
          word: [
            {
              "return-phrase": { l: { i: "synonymous" } },
              trs: [{ tr: [{ l: { i: ["adj. 同义的"] } }] }],
            },
          ],
        },
      }));
    };

    const result = await lookupOnlineDictionary(" Synonymous ", fetchImpl);
    expect(result?.word).toBe("synonymous");
    expect(result?.definition).toBe("adj. 同义的");
    expect(result?.updated_at).toBeGreaterThan(0);
  });

  it("非法输入不发起查询", async () => {
    const result = await lookupOnlineDictionary("42", async () => {
      throw new Error("不应该被调用");
    });
    expect(result).toBeNull();
    expect(normalizeLookupWord(" Otherwise ")).toBe("otherwise");
  });
});
