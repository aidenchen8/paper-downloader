import { normalizeDoi } from "./doi.mjs";

export const PUBLISHER_MAP = {
  "10.1038": "nature",
  "10.1021": "acs",
  "10.1126": "science",
  "10.1016": "elsevier",
  "10.1002": "wiley",
  "10.1039": "rsc",
  "10.1007": "springer",
  "10.1073": "pnas",
  "10.1149": "ecs",
  "10.1088": "iop",
  "10.1103": "aps",
  "10.1146": "annualreviews",
  "10.1080": "tandfonline",
  "10.1063": "aip",
  "10.1116": "avs",
  "10.1109": "ieee",
  "10.1143": "iop",
  "10.1147": "springer",
  "10.1364": "osa",
  "10.3938": "kps",
  "10.3762": "beilstein"
};

export const JOURNAL_PUBLISHER_MAP = {
  "nature": "nature",
  "nat ": "nature",
  "science": "science",
  "sci adv": "science",
  "sci. adv": "science",
  "acs ": "acs",
  "j. am. chem. soc": "acs",
  "nano lett": "acs",
  "j. phys. chem": "acs",
  "angew": "wiley",
  "adv. mater": "wiley",
  "adv mater": "wiley",
  "advanced materials": "wiley",
  "chemsuschem": "wiley",
  "pnas": "pnas",
  "proc. natl. acad": "pnas",
  "electrochem": "ecs",
  "j. membr": "elsevier",
  "j. power sources": "elsevier",
  "matter": "elsevier",
  "iop": "iop",
  "beilstein": "beilstein"
};

export const JOURNAL_SHORT = {
  "nature": "Nature",
  "nature energy": "NatEnergy",
  "nature catalysis": "NatCatal",
  "nature communications": "NatCommun",
  "nature materials": "NatMater",
  "nature biotechnology": "NatBiotechnol",
  "nature chemistry": "NatChem",
  "nature nanotechnology": "NatNano",
  "science": "Science",
  "science advances": "SciAdv",
  "journal of the american chemical society": "JACS",
  "acs catalysis": "ACSCatal",
  "acs nano": "ACSNano",
  "nano letters": "NanoLett",
  "the journal of physical chemistry b": "JPhysChemB",
  "the journal of physical chemistry c": "JPhysChemC",
  "the journal of physical chemistry letters": "JPhysChemLett",
  "acs applied energy materials": "ACSApplEnergy",
  "acs applied materials & interfaces": "ACSApplMater",
  "advanced materials": "AdvMater",
  "angewandte chemie": "AngewChem",
  "angewandte chemie international edition": "AngewChem",
  "chemsuschem": "ChemSusChem",
  "journal of membrane science": "JMembrSci",
  "journal of power sources": "JPowerSources",
  "journal of the electrochemical society": "JElectrochemSoc",
  "proceedings of the national academy of sciences": "PNAS",
  "journal of materials chemistry a": "JMaterChemA",
  "journal of applied electrochemistry": "JApplElectrochem",
  "matter": "Matter",
  "beilstein journal of nanotechnology": "BJON"
};

export const PUBLISHER_STRATEGIES = {
  acs: { family: "generic_fallback", support: "stable" },
  nature: { family: "generic_fallback", support: "stable" },
  science: { family: "generic_fallback", support: "stable" },
  elsevier: { family: "generic_fallback", support: "stable" },
  wiley: { family: "specialized_direct_pdf", support: "specialized" },
  rsc: { family: "generic_fallback", support: "stable" },
  springer: { family: "generic_fallback", support: "stable" },
  pnas: { family: "generic_fallback", support: "stable" },
  ecs: { family: "generic_fallback", support: "weak" },
  iop: { family: "generic_fallback", support: "weak" },
  aps: { family: "generic_fallback", support: "weak" },
  annualreviews: { family: "generic_fallback", support: "weak" },
  tandfonline: { family: "generic_fallback", support: "weak" },
  aip: { family: "generic_fallback", support: "specialized" },
  avs: { family: "generic_fallback", support: "specialized" },
  ieee: { family: "generic_fallback", support: "stable" },
  osa: { family: "generic_fallback", support: "stable" },
  kps: { family: "generic_fallback", support: "stable" },
  beilstein: { family: "generic_fallback", support: "weak" },
  unknown: { family: "generic_fallback", support: "unknown" }
};

export const PDF_SELECTORS = {
  acs: ['a[href*="/doi/pdf/"]', 'a[title*="PDF"]', 'a:has-text("Download PDF")', 'a[href*="epdf"]'],
  nature: ['a.c-pdf-download__link', 'a[data-track-action="download pdf"]', 'a[href*=".pdf"]', 'a:has-text("Download PDF")', 'a:has-text("PDF")'],
  science: ['a[href*="/doi/pdf/"]', 'a[href*="epdf"]', 'a:has-text("PDF")'],
  elsevier: ['a[href*="pdfft"]', 'a[href*="/pdf"]', 'a:has-text("Download PDF")', 'a:has-text("View PDF")', 'a:has-text("PDF")'],
  wiley: ['a[href*="pdfdirect"]', 'a[href*="/doi/pdf/"]', 'a[href*="/doi/epdf/"]', 'a:has-text("Download PDF")', 'a:has-text("PDF")'],
  rsc: ['a[href*="articlepdf"]', 'a.btn--pdf', 'a:has-text("Article PDF")'],
  springer: ['a[data-track-action*="pdf"]', 'a[href*="content/pdf"]', 'a:has-text("Download PDF")'],
  pnas: ['a[href*="/doi/pdf/"]', 'a:has-text("PDF")'],
  ecs: ['a[href$="/pdf"]', 'a[href*="/article/"][href*="/pdf"]', 'a:has-text("Full Text PDF")', 'a:has-text("PDF")'],
  iop: ['a[href$="/pdf"]', 'a[href*="/article/"][href*="/pdf"]', 'a:has-text("Full Text PDF")', 'a:has-text("PDF")'],
  aip: ['a[href*="/pdf/"]', 'a[data-article-url*="pdf"]', 'a:has-text("PDF")', 'button:has-text("PDF")', 'a[href*=".pdf"]'],
  avs: ['a[href*="/pdf/"]', 'a:has-text("PDF")', 'button:has-text("PDF")'],
  ieee: ['a[href*="/stamp/"]', 'a:has-text("PDF")', 'button:has-text("PDF")'],
  aps: ['a[href*="/pdf/"]', 'a:has-text("PDF")'],
  annualreviews: ['a[href*="/doi/pdf/"]', 'a:has-text("PDF")'],
  tandfonline: ['a[href*="/doi/pdf/"]', 'a[href*="download?"]', 'a:has-text("PDF")'],
  osa: ['a[href*="viewmedia"]', 'a[href*="/pdf"]', 'a:has-text("PDF")'],
  kps: ['a[href*=".pdf"]', 'a:has-text("PDF")'],
  beilstein: ['a[href*="/downloads/pdf/"]', 'a[href*=".pdf"]', 'a:has-text("PDF")']
};

export const VIEWER_DOWNLOAD_SELECTORS = [
  "#download",
  "#downloadButton",
  "button#download",
  "a#download",
  'button[aria-label*="download" i]',
  'a[aria-label*="download" i]',
  'button[title*="download" i]',
  'a[title*="download" i]',
  'button[data-l10n-id="download"]',
  'a[data-l10n-id="download"]',
  "cr-icon-button#download",
  'button:has-text("Download")',
  'a:has-text("Download")'
];

export function detectPublisher(rawDoi, journal = "") {
  const doi = normalizeDoi(rawDoi);
  const prefix = doi.includes("/") ? doi.split("/")[0] : "";
  const mapped = PUBLISHER_MAP[prefix];
  if (mapped) {
    return mapped;
  }
  const loweredJournal = journal.toLowerCase();
  for (const [fragment, publisher] of Object.entries(JOURNAL_PUBLISHER_MAP)) {
    if (loweredJournal.includes(fragment)) {
      return publisher;
    }
  }
  return "unknown";
}

export function shortenJournal(journal = "") {
  const lowered = journal.toLowerCase().trim();
  if (!lowered) {
    return "UnknownJournal";
  }
  if (JOURNAL_SHORT[lowered]) {
    return JOURNAL_SHORT[lowered];
  }
  for (const [full, short] of Object.entries(JOURNAL_SHORT)) {
    if (lowered.includes(full) || full.includes(lowered)) {
      return short;
    }
  }
  const words = journal.split(/\s+/).filter(Boolean);
  if (words.length <= 2) {
    return journal.replaceAll(" ", "").replaceAll(".", "").slice(0, 15) || "Journal";
  }
  return words.map((word) => word[0]?.toUpperCase() || "").join("").slice(0, 10) || "Journal";
}

export function makeLabel(firstAuthor = "Unknown", year = 0, journal = "") {
  const author = String(firstAuthor)
    .trim()
    .split(",")[0]
    .split(/\s+/)
    .pop()
    ?.replaceAll("-", "")
    .replaceAll("'", "") || "Unknown";
  return `${author || "Unknown"}${year || 0}_${shortenJournal(journal)}`;
}

export function buildDirectPdfUrl(rawDoi, publisher) {
  const doi = normalizeDoi(rawDoi);
  const natureSlug = doi.split("/").pop()?.replaceAll(".", "") || doi;
  const urls = {
    acs: `https://pubs.acs.org/doi/pdf/${doi}`,
    nature: `https://www.nature.com/articles/${natureSlug}.pdf`,
    science: `https://www.science.org/doi/pdf/${doi}`,
    wiley: `https://onlinelibrary.wiley.com/doi/pdfdirect/${doi}`,
    pnas: `https://www.pnas.org/doi/pdf/${doi}`,
    springer: `https://link.springer.com/content/pdf/${doi}.pdf`,
    ecs: `https://iopscience.iop.org/article/${doi}/pdf`,
    iop: `https://iopscience.iop.org/article/${doi}/pdf`,
    avs: `https://doi.org/${doi}`
  };
  return urls[publisher] || null;
}

export function buildArticleUrl(rawDoi, publisher) {
  const doi = normalizeDoi(rawDoi);
  const natureSlug = doi.split("/").pop()?.replaceAll(".", "") || doi;
  const urls = {
    nature: `https://www.nature.com/articles/${natureSlug}`,
    acs: `https://pubs.acs.org/doi/${doi}`,
    science: `https://www.science.org/doi/${doi}`,
    elsevier: `https://doi.org/${doi}`,
    wiley: `https://doi.org/${doi}`,
    rsc: `https://doi.org/${doi}`,
    springer: `https://link.springer.com/article/${doi}`,
    pnas: `https://www.pnas.org/doi/${doi}`,
    ecs: `https://iopscience.iop.org/article/${doi}`,
    iop: `https://iopscience.iop.org/article/${doi}`,
    aip: `https://doi.org/${doi}`,
    ieee: `https://doi.org/${doi}`,
    aps: `https://doi.org/${doi}`,
    annualreviews: `https://www.annualreviews.org/content/journals/${doi}`,
    tandfonline: `https://doi.org/${doi}`,
    osa: `https://doi.org/${doi}`,
    kps: `https://doi.org/${doi}`,
    avs: `https://doi.org/${doi}`,
    beilstein: `https://doi.org/${doi}`
  };
  return urls[publisher] || `https://doi.org/${doi}`;
}

export function getPdfSelectors(publisher) {
  return PDF_SELECTORS[publisher] || ['a[href*=".pdf"]', 'a:has-text("PDF")', 'a:has-text("Download PDF")'];
}

export function getPublisherStrategy(publisher) {
  return PUBLISHER_STRATEGIES[publisher] || PUBLISHER_STRATEGIES.unknown;
}
