export type Confidence = 'confirmed' | 'probable' | 'informational' | 'likely_false_positive';

export interface Finding {
  message: string;
  confidence: Confidence;
}

export interface ContainerCleanResult {
  text: string;
  actions: string[];
}

export const AI_FRONTMATTER_KEYS: ReadonlySet<string> = new Set([
  'generator', 'ai', 'ai_generated', 'ai-generated',
  'claude', 'anthropic', 'openai', 'gemini', 'synthid',
  'c2pa', 'content_credentials', 'contentcredentials', 'provenance',
  'digital_source_type', 'digitalsourcetype',
  'created_with', 'createdwith', 'model', 'llm',
]);

const AI_META_NAME =
  /generator|ai[-_ ]?generated|claude|anthropic|openai|gemini|synthid|c2pa|content.?credential|provenance|digital.?source|aigc/i;

const GENERATOR_AI =
  /claude|anthropic|openai|chatgpt|gemini|synthid|copilot|midjourney|dall.?e|stable.?diffusion/i;

const PARSED_PROVENANCE = /digitalSourceType|trainedAlgorithmicMedia|SoftwareAgent/i;

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const TOP_LEVEL_KEY = /^([A-Za-z0-9_.-]+)\s*:/;

function isContinuationLine(line: string): boolean {
  return line[0] === ' ' || line[0] === '\t' || line[0] === '-';
}

export function inspectMarkdown(text: string): Finding[] {
  const match = FRONTMATTER.exec(text);
  if (!match) return [];

  const findings: Finding[] = [];

  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || isContinuationLine(line)) continue;

    const key = TOP_LEVEL_KEY.exec(line)?.[1];
    if (!key) continue;

    if (AI_FRONTMATTER_KEYS.has(key.toLowerCase()) || AI_META_NAME.test(key)) {
      findings.push({ message: `frontmatter key: ${key}`, confidence: 'probable' });
      continue;
    }
    if (AI_META_NAME.test(line.slice(line.indexOf(':') + 1))) {
      findings.push({ message: `frontmatter value hit on ${key}`, confidence: 'probable' });
    }
  }

  return findings;
}

export function cleanMarkdown(text: string): ContainerCleanResult {
  const match = FRONTMATTER.exec(text);
  if (!match) return { text, actions: [] };

  const actions: string[] = [];
  const kept: string[] = [];
  let dropping = false;

  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#') || isContinuationLine(line)) {
      if (!dropping) kept.push(line);
      continue;
    }

    const key = TOP_LEVEL_KEY.exec(line)?.[1];
    if (!key) {
      dropping = false;
      kept.push(line);
      continue;
    }

    if (AI_FRONTMATTER_KEYS.has(key.toLowerCase()) || AI_META_NAME.test(key)) {
      actions.push(`drop frontmatter key: ${key}`);
      dropping = true;
      continue;
    }
    if (AI_META_NAME.test(line.slice(line.indexOf(':') + 1))) {
      actions.push(`drop frontmatter key (value hit): ${key}`);
      dropping = true;
      continue;
    }

    dropping = false;
    kept.push(line);
  }

  if (actions.length === 0) return { text, actions };

  const body = text.slice(match[0].length);
  const block = kept.join('\n').replace(/^\n+|\n+$/g, '');

  if (block) return { text: `---\n${block}\n---\n${body}`, actions };

  actions.push('removed empty frontmatter block');
  return { text: body.replace(/^\n+/, ''), actions };
}

const META_TAG = /<meta\b[^>]*>/gi;
const META_ATTR = /(name|property|content|generator)\s*=\s*["']([^"']*)["']/gi;
const JSONLD =
  /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi;
const DATA_AI_ATTR = /\sdata-ai[\w-]*\s*=\s*["'][^"']*["']/gi;

function metaAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const [, key, value] of tag.matchAll(META_ATTR)) attributes[key.toLowerCase()] = value;
  return attributes;
}

function isCmsGeneratorMeta(tag: string): boolean {
  const attributes = metaAttributes(tag);
  const label = (attributes.name ?? attributes.property ?? attributes.generator ?? '').toLowerCase();
  if (label !== 'generator') return false;
  return !GENERATOR_AI.test(attributes.content ?? '') && !GENERATOR_AI.test(tag);
}

function isAiMeta(tag: string): boolean {
  return AI_META_NAME.test(tag) || GENERATOR_AI.test(tag);
}

export function inspectHtml(text: string): Finding[] {
  const findings: Finding[] = [];

  for (const [tag] of text.matchAll(META_TAG)) {
    if (isCmsGeneratorMeta(tag)) {
      findings.push({ message: `cms generator: ${tag.slice(0, 120)}`, confidence: 'informational' });
      continue;
    }
    if (isAiMeta(tag)) {
      findings.push({
        message: `meta: ${tag.slice(0, 120)}`,
        confidence: PARSED_PROVENANCE.test(tag) ? 'confirmed' : 'probable',
      });
    }
  }

  for (const [block] of text.matchAll(JSONLD)) {
    if (AI_META_NAME.test(block) || PARSED_PROVENANCE.test(block)) {
      findings.push({
        message: 'json-ld provenance-like block',
        confidence: PARSED_PROVENANCE.test(block) ? 'confirmed' : 'probable',
      });
    }
  }

  for (const [attribute] of text.matchAll(DATA_AI_ATTR)) {
    findings.push({ message: `attr: ${attribute.trim().slice(0, 80)}`, confidence: 'probable' });
  }

  return findings;
}

export function cleanHtml(text: string): ContainerCleanResult {
  const actions: string[] = [];

  let out = text.replace(META_TAG, (tag) => {
    if (isCmsGeneratorMeta(tag) || !isAiMeta(tag)) return tag;
    actions.push(`drop meta: ${tag.slice(0, 80)}`);
    return '';
  });

  out = out.replace(JSONLD, (block) => {
    if (!AI_META_NAME.test(block) && !PARSED_PROVENANCE.test(block)) return block;
    actions.push('drop json-ld provenance-like script');
    return '';
  });

  let attributeCount = 0;
  out = out.replace(DATA_AI_ATTR, () => {
    attributeCount++;
    return '';
  });
  if (attributeCount > 0) actions.push(`drop data-ai* attributes x${attributeCount}`);

  return { text: out, actions };
}

const SVG_METADATA = /<metadata\b[^>]*>[\s\S]*?<\/metadata\s*>/gi;
const SVG_XMPMETA = /<x:xmpmeta\b[^>]*>[\s\S]*?<\/x:xmpmeta\s*>/gi;
const SVG_COMMENT = /<!--[\s\S]*?-->/g;
const SVG_GENERATOR_ATTR = /\s(inkscape:version|sodipodi:docname|generator)\s*=\s*"[^"]*"/gi;

export function inspectSvg(text: string): Finding[] {
  const findings: Finding[] = [];

  if (/<metadata[\s>]/i.test(text)) {
    findings.push({ message: 'svg <metadata> present', confidence: 'informational' });
  }
  if (/xmpmeta|rdf:RDF|contentcredentials/i.test(text)) {
    findings.push({ message: 'XMP/RDF-like content in SVG', confidence: 'probable' });
  }
  if (/c2pa|jumbf/i.test(text)) {
    findings.push({ message: 'marker: c2pa/jumbf in SVG', confidence: 'probable' });
  }
  for (const [comment] of text.matchAll(SVG_COMMENT)) {
    if (AI_META_NAME.test(comment)) {
      findings.push({ message: 'SVG comment with AI markers', confidence: 'probable' });
    }
  }

  return findings;
}

export function cleanSvg(text: string): ContainerCleanResult {
  const actions: string[] = [];
  let out = text;

  let metadataCount = 0;
  out = out.replace(SVG_METADATA, () => {
    metadataCount++;
    return '';
  });
  if (metadataCount > 0) actions.push(`drop <metadata> x${metadataCount}`);

  let xmpCount = 0;
  out = out.replace(SVG_XMPMETA, () => {
    xmpCount++;
    return '';
  });
  if (xmpCount > 0) actions.push(`drop xmpmeta x${xmpCount}`);

  out = out.replace(SVG_COMMENT, (comment) => {
    if (!AI_META_NAME.test(comment)) return comment;
    actions.push('drop SVG comment with AI markers');
    return '';
  });

  if (actions.length === 0) {
    let attributeCount = 0;
    out = out.replace(SVG_GENERATOR_ATTR, () => {
      attributeCount++;
      return '';
    });
    if (attributeCount > 0) actions.push(`drop generator-like attrs x${attributeCount}`);
  }

  return { text: out, actions };
}
