const DOI_REGEX = /10\.\d{4,9}\/[^\s"'<>]+/i;

export function normalizeDoi(rawValue = "") {
  let value = String(rawValue).trim();
  value = value.replace(/^doi:\s*/i, "");
  value = value.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  value = value.replace(/[)\].,;]+$/g, "");
  return value.toLowerCase();
}

export function looksLikeDoi(rawValue = "") {
  return DOI_REGEX.test(normalizeDoi(rawValue));
}

export function extractDoiFromText(text = "") {
  const match = String(text).match(DOI_REGEX);
  return match ? normalizeDoi(match[0]) : "";
}
