/**
 * Categories, so 116,000 skills can be browsed rather than only grep-ed.
 *
 * DETERMINISTIC AND EVIDENCE-BEARING, for the same reason the answer key is
 * (see extract.ts): a model guessing categories at this scale would be wrong
 * quietly and at volume, and nobody would ever check. Every assignment here
 * comes from a term that is literally present in the skill's own name,
 * description or body, and the matched term is kept so the reason for a
 * category can be shown rather than trusted.
 *
 * THREE RULES THAT KEEP THIS HONEST.
 *
 *   1. A skill may hold several categories. Forcing one label onto `pdf` —
 *      documents? data extraction? OCR? — would be a false precision.
 *   2. Evidence is weighted by how deliberate it is — see `categorise` below.
 *      A name or a description assigns on one hit; a body needs two distinct
 *      terms, because one passing mention of "browser" in a PDF skill is not a
 *      browser skill.
 *   3. `uncategorised` is a real, published answer. It is 15% of the top tier
 *      once descriptions are read, and inventing a bucket for those would hide
 *      exactly the skills we can say least about.
 */

export interface Category {
  id: string;
  label: string;
  /** Terms that count as strong evidence — a hit in the NAME assigns outright. */
  name: RegExp;
  /** Terms in the body. Two distinct hits assign. */
  body: RegExp[];
}

export const CATEGORIES: Category[] = [
  {
    id: "documents", label: "Documents & files",
    name: /\b(pdf|docx?|word|pptx?|powerpoint|slides?|markdown|latex|epub|ocr|document)\b/i,
    body: [/\bpdf\b/i, /\bdocx\b/i, /\bpptx\b/i, /\bpandoc\b/i, /\bocr\b/i, /\blatex\b/i, /\bepub\b/i],
  },
  {
    id: "data", label: "Data & spreadsheets",
    name: /\b(xlsx?|excel|csv|spreadsheet|sheets?|dataframe|pandas|sql|query|database|db)\b/i,
    body: [/\bopenpyxl\b/i, /\bpandas\b/i, /\bcsv\b/i, /\bxlsx\b/i, /\bsqlite\b/i, /\bpostgres\b/i, /\bselect .* from\b/i, /\bdataframe\b/i],
  },
  {
    id: "web", label: "Browser & web",
    name: /\b(browser|web|scrape|scraping|crawl|puppeteer|playwright|selenium|devtools|dom|html)\b/i,
    body: [/\bpuppeteer\b/i, /\bplaywright\b/i, /\bselenium\b/i, /\bdevtools\b/i, /\bquerySelector\b/i, /\buser-agent\b/i, /\bscrape\b/i],
  },
  {
    id: "cloud", label: "Deploy & infrastructure",
    name: /\b(deploy|vercel|netlify|aws|gcp|azure|docker|kubernetes|k8s|terraform|infra|ci|cd|cloudflare)\b/i,
    body: [/\bkubectl\b/i, /\bterraform\b/i, /\bdockerfile\b/i, /\bvercel\b/i, /\baws \w+\b/i, /\bhelm\b/i, /\bci\/cd\b/i],
  },
  {
    id: "dev", label: "Coding & repos",
    name: /\b(code|coding|git|github|review|refactor|debug|test|lint|typescript|python|rust|api|sdk|cli)\b/i,
    body: [/\bgit \w+\b/i, /\bpull request\b/i, /\bnpm \w+\b/i, /\bpytest\b/i, /\beslint\b/i, /\brefactor\b/i, /\bunit test\b/i],
  },
  {
    id: "comms", label: "Email & messaging",
    name: /\b(email|gmail|mail|slack|discord|calendar|invite|message|notification|sms)\b/i,
    body: [/\bgmail\b/i, /\bslack\b/i, /\bsmtp\b/i, /\bcalendar\b/i, /\brecipient\b/i, /\binbox\b/i],
  },
  {
    id: "design", label: "Design & diagrams",
    name: /\b(design|diagram|drawio|figma|canvas|chart|graph|svg|image|logo|brand|ui|ux|mockup)\b/i,
    body: [/\bdrawio\b/i, /\bfigma\b/i, /\bsvg\b/i, /\bmermaid\b/i, /\bwireframe\b/i, /\bcolou?r palette\b/i],
  },
  {
    id: "science", label: "Science & research",
    name: /\b(bio|biopython|chem|genom|protein|research|paper|arxiv|dataset|statistic|analysis|scientific)\b/i,
    body: [/\bbiopython\b/i, /\bpubmed\b/i, /\barxiv\b/i, /\bgenome\b/i, /\bfasta\b/i, /\bhypothesis\b/i, /\bp-value\b/i],
  },
  {
    id: "writing", label: "Writing & content",
    name: /\b(writ|content|blog|copy|edit|summar|translat|note|obsidian|journal|newsletter|seo)\b/i,
    body: [/\bobsidian\b/i, /\btone of voice\b/i, /\bdraft\b/i, /\bsummaris|summariz/i, /\bproofread\b/i],
  },
  {
    id: "agents", label: "Agents & prompting",
    name: /\b(agent|skill|prompt|mcp|tool|workflow|orchestrat|subagent|memory|context)\b/i,
    body: [/\bmcp server\b/i, /\bsystem prompt\b/i, /\bsubagent\b/i, /\btool call\b/i, /\bskill\.md\b/i],
  },
  {
    id: "business", label: "Business & product",
    name: /\b(product|prd|roadmap|spec|market|sales|finance|invoice|legal|contract|hr|recruit|pm)\b/i,
    body: [/\bstakeholder\b/i, /\broadmap\b/i, /\binvoice\b/i, /\bkpi\b/i, /\bquarterly\b/i, /\bcompliance\b/i],
  },
  {
    id: "media", label: "Audio, video & images",
    name: /\b(video|audio|image|photo|ffmpeg|transcri|podcast|youtube|gif|render|music|speech)\b/i,
    body: [/\bffmpeg\b/i, /\bwhisper\b/i, /\btranscript\b/i, /\bmp4\b/i, /\bwaveform\b/i, /\byoutube\b/i],
  },
];

export interface Categorisation {
  ids: string[];
  /** category id -> the term that assigned it, so a label can show its reason. */
  evidence: Record<string, string>;
}

/**
 * Three tiers of evidence, weighted by how deliberate each one is.
 *
 *   name         strongest. The author named the thing. One hit assigns.
 *   description  strong. The spec requires it to state what the skill does and
 *                when to use it, and it is the ONLY text a client reads to
 *                decide whether a skill applies. It is one or two dense
 *                sentences, so one hit assigns — the original rule demanded two
 *                distinct terms and left 66% of the corpus uncategorised even
 *                after every description had been fetched. That was the rule
 *                being wrong, not the corpus being unlabelable.
 *   body         weakest. Long, and full of incidental mentions: a PDF skill
 *                that says "open a browser" once is not a browser skill. Still
 *                needs two distinct terms.
 *
 * @param name         directory or frontmatter name
 * @param text         body text (may be empty for catalogue rows)
 * @param description  the skill's own description, when we have it
 */
export function categorise(name: string, text: string, description = ""): Categorisation {
  const ids: string[] = [];
  const evidence: Record<string, string> = {};

  for (const c of CATEGORIES) {
    const inName = c.name.exec(name);
    if (inName) {
      ids.push(c.id);
      evidence[c.id] = `name contains "${inName[0]}"`;
      continue;
    }
    // The description is the author's own statement of purpose: one hit is enough.
    if (description) {
      const inDesc = c.name.exec(description) ?? c.body.map((re) => re.exec(description)).find(Boolean);
      if (inDesc) {
        ids.push(c.id);
        evidence[c.id] = `description mentions "${inDesc[0]}"`;
        continue;
      }
    }

    // Two DISTINCT body terms. One passing mention is not a category.
    const hits: string[] = [];
    for (const re of c.body) {
      const m = re.exec(text);
      if (m && !hits.includes(m[0].toLowerCase())) hits.push(m[0].toLowerCase());
      if (hits.length >= 2) break;
    }
    if (hits.length >= 2) {
      ids.push(c.id);
      evidence[c.id] = `body mentions ${hits.map((h) => `"${h}"`).join(" and ")}`;
    }
  }

  return { ids, evidence };
}

export const CATEGORY_LABEL: Record<string, string> =
  Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));
