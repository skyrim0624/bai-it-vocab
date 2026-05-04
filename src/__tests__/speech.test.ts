import { describe, expect, it } from "vitest";
import { selectBestEnglishVoice } from "../shared/speech.ts";

function voice(name: string, lang: string, localService = true): SpeechSynthesisVoice {
  return {
    name,
    lang,
    localService,
    default: false,
    voiceURI: name,
  };
}

describe("英文发音声音选择", () => {
  it("优先选择自然的美式英文声音", () => {
    const selected = selectBestEnglishVoice([
      voice("Bells", "en-US"),
      voice("Daniel", "en-GB"),
      voice("Samantha", "en-US"),
    ]);

    expect(selected?.name).toBe("Samantha");
  });

  it("没有美式声音时选择可用的自然英文声音", () => {
    const selected = selectBestEnglishVoice([
      voice("Tessa", "en-ZA"),
      voice("Moira", "en-IE"),
      voice("Mei-Jia", "zh-TW"),
    ]);

    expect(selected?.name).toBe("Moira");
  });

  it("避开系统里的特效声音", () => {
    const selected = selectBestEnglishVoice([
      voice("Whisper", "en-US"),
      voice("Zarvox", "en-US"),
      voice("Google US English", "en-US", false),
    ]);

    expect(selected?.name).toBe("Google US English");
  });
});
