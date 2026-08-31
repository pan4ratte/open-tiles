/**
 * Guards the seam where text from Google Fonts becomes CSS on the page.
 *
 * A family that is not Inter arrives as a stylesheet fetched from
 * fonts.googleapis.com. That reply is not markup this extension wrote, so
 * nothing in it is trusted: `inlineBlock` reads the descriptors it knows out
 * of each @font-face block, checks each value against the shape it has to
 * have, downloads the font file, and writes a fresh rule from those parts. The
 * reply itself never reaches a <style>.
 *
 * What can go quietly wrong here:
 *
 *   - a descriptor is copied across verbatim, and a reply that carried
 *     `background: url(...)` turns the new tab page into something that phones
 *     a third party every time it opens.
 *   - a `}` slips through the block matcher, and what follows the block is no
 *     longer inside the @font-face rule - it is a rule of its own.
 *   - the gstatic URL survives into the sheet, so the font is fetched from the
 *     network on every new tab rather than read out of the cached data: URI -
 *     which is the whole point of caching it.
 *   - `unicode-range` is dropped, and every subset claims every codepoint: the
 *     browser downloads one face and draws the rest of the page in it.
 *   - the specimen path renames the family before inlining, and the validator
 *     does not recognise the renamed value - so the font picker draws every
 *     family in the fallback.
 *
 * Runs the real fonts.js against a stand-in network.
 *
 *   node test/fonts.test.js [path/to/src]
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = process.argv[2] || path.join(__dirname, '..', 'src');

// ---------------------------------------------------------- fake surroundings

/** The three bytes every font file in this test is made of. */
const FONT_BYTES = new Uint8Array([1, 2, 3]);
const FONT_B64 = 'AQID';

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  AbortController,
  btoa: text => Buffer.from(text, 'binary').toString('base64'),
  fetch: async () => ({ ok: true, arrayBuffer: async () => FONT_BYTES.buffer }),
  document: {
    documentElement: { style: { setProperty() {} } },
    head: { append() {} },
    getElementById: () => null,
    createElement: () => ({ dataset: {}, style: {}, replaceWith() {} }),
    querySelectorAll: () => []
  },
  Store: { getFontCss: async () => null, putFontCss: async () => {} }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// parseFaces and inlineBlock are private to the module, which is where they
// belong - the test reaches them by adding one key to what it already returns.
const source = fs.readFileSync(path.join(SRC, 'fonts.js'), 'utf8').replace(/\r\n/g, '\n');
if (!source.includes('return {')) {
  throw new Error('fonts.js no longer ends in a returned object - update this test');
}
vm.runInContext(
  fs.readFileSync(path.join(SRC, 'i18n.js'), 'utf8'), sandbox, { filename: 'i18n.js' });
vm.runInContext(
  source.replace('return {', 'return { __test: { parseFaces, inlineBlock },'),
  sandbox,
  { filename: 'fonts.js' }
);
const { parseFaces, inlineBlock } = vm.runInContext('Fonts.__test', sandbox);

/** A css2 reply, copied from what Google actually serves for a variable face. */
const REPLY = `/* cyrillic-ext */
@font-face {
  font-family: 'Montserrat';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/montserrat/v29/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCtr6Hw0aXpsog.woff2) format('woff2');
  unicode-range: U+0460-052F, U+1C80-1C88, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F;
}
/* latin */
@font-face {
  font-family: 'Montserrat';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/montserrat/v29/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCtr6Hw9aXo.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+2000-206F, U+20AC, U+FEFF, U+FFFD;
}`;

/** One @font-face block carrying whatever declarations are named. */
const blockOf = decls => `@font-face { ${decls} }`;

/** The src every block needs to get as far as being rewritten. */
const GOOD_SRC = 'src: url(https://fonts.gstatic.com/s/x/a.woff2) format(\'woff2\');';

const results = [];
const check = (name, pass, detail) => results.push({ name, pass, detail: detail || '' });

(async () => {
  // ------------------------------------------------- reading the reply apart

  const faces = parseFaces(REPLY);
  check('both faces are found in a css2 reply', faces.length === 2, `${faces.length} found`);
  check('each face keeps the subset it was labelled with',
    faces[0].subset === 'cyrillic-ext' && faces[1].subset === 'latin',
    faces.map(f => f.subset).join(', '));

  // ------------------------------------------------------- the rewritten rule

  const rule = await inlineBlock(faces[0].block);
  if (typeof rule !== 'string') throw new Error('a real block produced no rule at all');
  console.log('the rule a real block is rewritten into:\n' + rule + '\n');

  check('a real block is rewritten into a rule', rule.startsWith('@font-face {'));
  check('the family is carried across',
    /\n {2}font-family: 'Montserrat';/.test(rule));
  check('the weight range is carried across',
    /\n {2}font-weight: 100 900;/.test(rule));
  check('the style is carried across',
    /\n {2}font-style: normal;/.test(rule));
  check('font-display is carried across',
    /\n {2}font-display: swap;/.test(rule));
  check('unicode-range is carried across whole',
    rule.includes('unicode-range: U+0460-052F, U+1C80-1C88, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F;'));
  check('the font file is in the rule as a data: URI',
    rule.includes(`src: url(data:font/woff2;base64,${FONT_B64}) format('woff2');`));
  check('nothing remote survives into the rule', !/https?:|gstatic/.test(rule));

  // ---------------------------------------------------------- the specimen path

  // The picker renames every family before inlining so a cut-down specimen can
  // never stand in for the real font; the renamed value still has to validate.
  const renamed = REPLY.replace(
    /font-family:\s*(['"])([^'"]+)\1/g,
    (whole, mark, name) => `font-family:${mark}Tiles Specimen ${name}${mark}`
  );
  const specimen = await inlineBlock(parseFaces(renamed)[0].block);
  check('a renamed specimen family is still recognised',
    specimen !== null && specimen.includes("font-family: 'Tiles Specimen Montserrat';"));

  // --------------------------------------------- what must not reach the page

  const refuses = [
    ['a descriptor that is not a font descriptor is dropped',
     blockOf(`font-family: 'X'; background: url(https://evil.test/p); ${GOOD_SRC}`),
     'evil.test'],
    ['a second, non-Google src is dropped with the first',
     blockOf(`font-family: 'X'; src: url(https://fonts.gstatic.com/a.woff2), url(https://evil.test/b.woff2);`),
     'evil.test'],
    ['a vendor property is dropped',
     blockOf(`font-family: 'X'; -moz-binding: url(https://evil.test/x); ${GOOD_SRC}`),
     'binding'],
    ['a unicode-range that is not one is dropped',
     blockOf(`font-family: 'X'; unicode-range: expression(alert(1)); ${GOOD_SRC}`),
     'expression'],
    ['a value carrying its own closing brace cannot start a new rule',
     blockOf(`font-family: 'X'; font-weight: 400 } body { display: none; ${GOOD_SRC}`),
     'display: none'],
    ['a family name that is not a name is dropped',
     blockOf(`font-family: 'X'; font-style: italic; url(https://evil.test/y); ${GOOD_SRC}`),
     'evil.test']
  ];

  for (const [name, block, forbidden] of refuses) {
    const out = await inlineBlock(block);
    check(name, out === null || !out.includes(forbidden),
      String(out).replace(/\s+/g, ' '));
  }

  check('a block naming no family is refused outright',
    (await inlineBlock(blockOf(`font-weight: 400; ${GOOD_SRC}`))) === null);
  check('a block with no font file to fetch is refused outright',
    (await inlineBlock(blockOf(`font-family: 'X'; font-weight: 400;`))) === null);

  // Every descriptor that survives is one of the six that may.
  // Read off the start of each line rather than by splitting on ';': the data:
  // URI carries a semicolon of its own, inside url(), where CSS does not treat
  // it as the end of anything.
  const named = rule.split('\n')
    .map(line => (line.match(/^ {2}([a-z-]+):/) || [])[1])
    .filter(Boolean);
  const allowed = ['font-family', 'font-style', 'font-weight', 'font-stretch',
                   'font-display', 'unicode-range', 'src'];
  check('the rule names nothing outside the allowed descriptors',
    named.every(d => allowed.includes(d)), named.join(', '));

  // ----------------------------------------------------------------- report

  let failed = 0;
  for (const result of results) {
    if (!result.pass) failed++;
    console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.name}  (${result.detail})`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
