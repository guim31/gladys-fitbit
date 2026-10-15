// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the message tables of the
// code, the feature names and the documentation. German says "du", never the
// polite "Sie"; the four docs have the same sections.
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { MESSAGES, NAMES, STATUS } from '../src/i18n.js';
import { TEXT as WIDGET_TEXT } from '../src/widgets.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)(?!\p{L})/u;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 300,
  section: 1000,
  message: 200,
  short: 40,
  tile: 24,
  featureName: 40,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    const rendered = typeof text === 'function' ? text('X', 'Y') : text;
    found.push(...textProblems(rendered, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key, parent) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key, parent));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : parent?.type === 'section' && key === 'description'
              ? MAX.section
              : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child, value);
    }
  };
  walk(root, 'manifest', null, null);
  return texts;
}

test('the configuration offers the four languages, French by default', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  assert.deepEqual(Object.keys(NAMES), LANGS);
  const field = manifest.config_schema.find((entry) => entry.key === 'language');
  assert.equal(field.default, 'fr');
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 35, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the name is the brand, the same in every language', () => {
  assert.equal(typeof manifest.name, 'string');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
});

test('every message table of the code has the four languages', () => {
  const tiles = new Set(['steps', 'sleep', 'heart']);
  const found = [
    ...Object.entries(STATUS).flatMap(([key, value]) =>
      problems(value, `STATUS.${key}`, MAX.message),
    ),
    ...Object.entries(MESSAGES).flatMap(([key, value]) =>
      problems(value, `MESSAGES.${key}`, MAX.message),
    ),
    ...Object.entries(WIDGET_TEXT).flatMap(([key, value]) =>
      problems(
        value,
        `WIDGET_TEXT.${key}`,
        key === 'waiting' ? MAX.message : tiles.has(key) ? MAX.tile : MAX.short,
      ),
    ),
  ];
  assert.deepEqual(found, []);
});

test('the feature names exist in every language, and differ within a language', () => {
  const found = [];
  for (const lang of LANGS) {
    const names = NAMES[lang];
    if (
      JSON.stringify(sorted(Object.keys(names))) !== JSON.stringify(sorted(Object.keys(NAMES.en)))
    ) {
      found.push(`NAMES.${lang} does not have the keys of NAMES.en`);
    }
    for (const [key, name] of Object.entries(names)) {
      found.push(...textProblems(name, `NAMES.${lang}.${key}`, lang, MAX.featureName));
    }
    const values = Object.entries(names).filter(([key]) => key !== 'device');
    assert.equal(
      new Set(values.map(([, name]) => name)).size,
      values.length,
      `${lang}: duplicates`,
    );
  }
  assert.deepEqual(found, []);
});

test('the guard catches a missing language, an empty text and the polite German form', () => {
  assert.equal(problems({ en: 'Steps', fr: 'Pas', de: 'Schritte' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: '', es: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of ['Wählen Sie', 'Ihr Konto', 'Ihre Uhr', 'mit Ihrem', 'Ihren', 'Ihrer']) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  const forgotten = structuredClone(manifest);
  delete forgotten.scene_triggers[0].variables[0].label.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.scene_triggers[0].variables[0].label has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
});

// --- Documentation ------------------------------------------------------------

const docs = Object.fromEntries(
  await Promise.all(
    LANGS.map(async (lang) => [
      lang,
      await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8'),
    ]),
  ),
);

/** The outline of a doc: the level of each heading, in order. */
const outline = (markdown) =>
  markdown
    .split('\n')
    .filter((line) => /^#{1,4} /.test(line))
    .map((line) => line.match(/^#+/)[0].length);

test('the four docs exist and have the same sections, in the same order', () => {
  const reference = outline(docs.en);
  assert.ok(reference.filter((level) => level === 2).length >= 8, 'the doc has its sections');
  for (const lang of LANGS) {
    assert.ok(docs[lang].length >= 300, `docs/${lang}.md is too short for the store`);
    assert.deepEqual(outline(docs[lang]), reference, `docs/${lang}.md: not the outline of en.md`);
  }
});

test('the docs carry the same facts: redirect URI, retired API, no hardware', () => {
  for (const lang of LANGS) {
    const doc = docs[lang];
    assert.ok(doc.includes('https://my.gladysassistant.com/redirect/oauth'), `${lang}: redirect`);
    assert.ok(doc.includes('Google Health API'), `${lang}: API name`);
    assert.ok(doc.includes('Fitbit Web API'), `${lang}: the retired API is named`);
  }
  assert.match(docs.en, /Developed without the hardware/);
  assert.match(docs.fr, /Développée sans le matériel/);
  assert.match(docs.de, /Ohne die Hardware entwickelt/);
  assert.match(docs.es, /Desarrollada sin el hardware/);
  assert.ok(!POLITE_GERMAN.test(docs.de.replace(/`[^`]*`/g, '')), 'docs/de.md says "du"');
});
