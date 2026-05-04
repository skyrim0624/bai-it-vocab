const NATURAL_VOICE_NAMES = [
  "Samantha",
  "Ava",
  "Allison",
  "Susan",
  "Victoria",
  "Alex",
  "Google US English",
  "Microsoft Jenny Online",
  "Microsoft Aria Online",
  "Daniel",
  "Serena",
  "Karen",
  "Moira",
  "Tessa",
];

const REJECT_VOICE_PATTERNS = [
  /whisper/i,
  /bells/i,
  /bubbles/i,
  /cellos/i,
  /zarvox/i,
  /trinoids/i,
  /bad news/i,
  /good news/i,
  /pipe organ/i,
  /superstar/i,
  /boing/i,
  /bahh/i,
  /jester/i,
];

function isWordLike(text: string): boolean {
  return /^[a-z][a-z'-]*$/i.test(text.trim());
}

function getVoiceScore(voice: SpeechSynthesisVoice, preferredLang: string): number {
  const name = voice.name;
  const lang = voice.lang.toLowerCase();

  if (REJECT_VOICE_PATTERNS.some((pattern) => pattern.test(name))) return -100;

  let score = 0;
  const exactNameIndex = NATURAL_VOICE_NAMES.findIndex(
    (preferred) => name.toLowerCase().includes(preferred.toLowerCase())
  );
  if (exactNameIndex >= 0) score += 100 - exactNameIndex * 4;

  if (lang === preferredLang.toLowerCase()) score += 35;
  else if (lang.startsWith("en-us")) score += 30;
  else if (lang.startsWith("en-gb")) score += 22;
  else if (lang.startsWith("en-")) score += 16;
  else score -= 30;

  if (voice.localService) score += 8;
  if (/natural|premium|enhanced|neural/i.test(name)) score += 18;
  if (/compact/i.test(name)) score -= 18;

  return score;
}

export function selectBestEnglishVoice(
  voices: SpeechSynthesisVoice[],
  preferredLang = "en-US"
): SpeechSynthesisVoice | null {
  const englishVoices = voices.filter((voice) => voice.lang.toLowerCase().startsWith("en"));
  if (englishVoices.length === 0) return null;

  return englishVoices
    .map((voice) => ({ voice, score: getVoiceScore(voice, preferredLang) }))
    .sort((a, b) => b.score - a.score)[0]?.voice ?? null;
}

async function getVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  const readyVoices = synth.getVoices();
  if (readyVoices.length > 0) return readyVoices;

  return new Promise((resolve) => {
    const handleVoicesChanged = () => {
      window.clearTimeout(timer);
      synth.removeEventListener("voiceschanged", handleVoicesChanged);
      resolve(synth.getVoices());
    };
    const timer = window.setTimeout(() => {
      synth.removeEventListener("voiceschanged", handleVoicesChanged);
      resolve(synth.getVoices());
    }, 350);

    synth.addEventListener("voiceschanged", handleVoicesChanged);
  });
}

function buildDictionaryAudioUrl(word: string): string {
  return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=2`;
}

async function playDictionaryAudio(word: string): Promise<boolean> {
  if (navigator.onLine === false || !isWordLike(word)) return false;

  try {
    const audio = new Audio(buildDictionaryAudioUrl(word.trim().toLowerCase()));
    audio.preload = "auto";
    audio.volume = 1;
    await audio.play();
    return true;
  } catch {
    return false;
  }
}

export async function speakEnglish(
  text: string,
  options: { lang?: string; rate?: number; pitch?: number } = {}
): Promise<void> {
  if (!("speechSynthesis" in window)) return;

  const cleanText = text.trim();
  if (!cleanText) return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(cleanText);
  const voices = await getVoices();
  const voice = selectBestEnglishVoice(voices, options.lang ?? "en-US");

  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    utterance.lang = options.lang ?? "en-US";
  }

  utterance.rate = options.rate ?? (isWordLike(cleanText) ? 0.78 : 0.84);
  utterance.pitch = options.pitch ?? 1.04;
  utterance.volume = 1;
  window.speechSynthesis.speak(utterance);
}

export async function speakWordNaturally(word: string): Promise<void> {
  const playedOnlineAudio = await playDictionaryAudio(word);
  if (playedOnlineAudio) return;
  await speakEnglish(word, { lang: "en-US", rate: 0.76, pitch: 1.04 });
}
