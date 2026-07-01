type LookupContext = {
  query: string;
  sentence: string | null;
};

const MAX_LOOKUP_LENGTH = 48;
const SENTENCE_BOUNDARIES = new Set(["。", "．", ".", "！", "!", "？", "?", "\n", "\r"]);

export function isKanji(character: string) {
  const codePoint = character.codePointAt(0) ?? 0;

  return (codePoint >= 0x3400 && codePoint <= 0x9fff) || (codePoint >= 0xf900 && codePoint <= 0xfaff) || character === "々";
}

function isJapaneseLookupChar(character: string) {
  const codePoint = character.codePointAt(0) ?? 0;

  return (
    (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
    (codePoint >= 0x3400 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    character === "々" ||
    character === "〆" ||
    character === "ヵ" ||
    character === "ヶ" ||
    character === "ー"
  );
}

function caretRangeFromPoint(documentRef: Document, clientX: number, clientY: number) {
  const legacyDocument = documentRef as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };

  if (legacyDocument.caretRangeFromPoint) {
    return legacyDocument.caretRangeFromPoint(clientX, clientY);
  }

  const position = legacyDocument.caretPositionFromPoint?.(clientX, clientY);
  if (!position) {
    return null;
  }

  const range = documentRef.createRange();
  range.setStart(position.offsetNode, position.offset);
  range.collapse(true);

  return range;
}

function firstJapaneseSequence(text: string) {
  let output = "";
  let started = false;

  for (const character of text) {
    if (isJapaneseLookupChar(character)) {
      output += character;
      started = true;
      continue;
    }

    if (started) {
      break;
    }
  }

  return output;
}

function lookupWindowAroundOffset(text: string, offset: number) {
  const characters = Array.from(text);
  const safeOffset = Math.max(0, Math.min(characters.length, offset));
  let start = safeOffset;
  let end = safeOffset;

  if (start >= characters.length && start > 0) {
    start -= 1;
  }

  if (!isJapaneseLookupChar(characters[start] ?? "") && start > 0 && isJapaneseLookupChar(characters[start - 1])) {
    start -= 1;
  }

  while (start > 0 && start > safeOffset - 4 && isJapaneseLookupChar(characters[start - 1])) {
    start -= 1;
  }

  end = Math.max(end, start);
  while (end < characters.length && isJapaneseLookupChar(characters[end])) {
    end += 1;
  }

  return characters.slice(start, end).join("").slice(0, MAX_LOOKUP_LENGTH);
}

function sentenceAroundOffset(text: string, offset: number) {
  const characters = Array.from(text);
  const safeOffset = Math.max(0, Math.min(characters.length, offset));
  let start = safeOffset;
  let end = safeOffset;

  while (start > 0 && !SENTENCE_BOUNDARIES.has(characters[start - 1])) {
    start -= 1;
  }

  while (end < characters.length && !SENTENCE_BOUNDARIES.has(characters[end])) {
    end += 1;
  }

  const sentence = characters.slice(start, end).join("").replace(/\s+/g, " ").trim();

  return sentence || null;
}

export function extractLookupContext(
  documentRef: Document,
  clientX: number,
  clientY: number,
  fallbackText = "",
): LookupContext | null {
  const range = caretRangeFromPoint(documentRef, clientX, clientY);
  const container = range?.startContainer;
  const rawText = container?.textContent || fallbackText;

  if (!rawText.trim()) {
    return null;
  }

  const offset = container?.nodeType === Node.TEXT_NODE ? range?.startOffset ?? 0 : 0;
  const query = lookupWindowAroundOffset(rawText, offset) || firstJapaneseSequence(rawText);

  if (!query) {
    return null;
  }

  return {
    query,
    sentence: sentenceAroundOffset(rawText, offset),
  };
}
