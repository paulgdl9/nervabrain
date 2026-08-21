export function verticalBlockNavigation({
  key,
  selectionStart,
  selectionEnd,
  textLength,
  isComposing = false,
  hasModifier = false,
}: {
  key: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  textLength: number;
  isComposing?: boolean;
  hasModifier?: boolean;
}): "previous" | "next" | null {
  if (isComposing || hasModifier || selectionStart === null || selectionStart !== selectionEnd) return null;
  if (key === "ArrowUp" && selectionStart === 0) return "previous";
  if (key === "ArrowDown" && selectionEnd === textLength) return "next";
  return null;
}
