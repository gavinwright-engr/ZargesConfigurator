// A clipboard contains a case description, never its identity or coordinates.
// Pasting always creates a new instance in an available workspace position.
const TYPE = "zarges-case";

export function encodeCaseClipboard(box) {
  return JSON.stringify({
    type: TYPE,
    version: 1,
    modelId: box.modelId,
    rotated: !!box.rotated,
  });
}

export function parseCaseClipboard(text, catalog) {
  if (typeof text !== "string" || text.length > 2000) return null;
  try {
    const data = JSON.parse(text);
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      data.type !== TYPE ||
      data.version !== 1 ||
      typeof data.modelId !== "string" ||
      typeof data.rotated !== "boolean" ||
      !catalog.some((model) => model.id === data.modelId)
    )
      return null;
    return { modelId: data.modelId, rotated: data.rotated };
  } catch {
    return null;
  }
}
