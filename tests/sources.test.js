const test = require('node:test');
const assert = require('node:assert/strict');
const { govukContentUrl, govukBodyText, stripHtml, compareSource, sourceUrls } = require('../api/_sources');

test('govukContentUrl maps gov.uk pages to the content API, others to null', () => {
  assert.equal(govukContentUrl('https://www.gov.uk/income-tax-rates'), 'https://www.gov.uk/api/content/income-tax-rates');
  assert.equal(govukContentUrl('https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027'),
    'https://www.gov.uk/api/content/guidance/rates-and-thresholds-for-employers-2026-to-2027');
  assert.equal(govukContentUrl('https://www.aqa.org.uk/x'), null);
});

test('govukBodyText joins body + parts and strips tags', () => {
  const j = { details: { body: '<p>Hello <b>there</b></p>', parts: [{ body: '<ul><li>one</li></ul>' }] } };
  assert.equal(govukBodyText(j), 'Hello there one');
});

test('govukBodyText includes a transaction start page\'s fields (an edit there changes the hash)', () => {
  const j = { details: { introductory_paragraph: '<p>An ETA costs £20.</p>', more_information: '<p>More</p>', start_button_text: 'Start now' } };
  assert.equal(govukBodyText(j), 'An ETA costs £20. More');
  assert.equal(govukBodyText({ details: {} }), '', 'a page with none of the fields still hashes as empty, as before');
});

test('stripHtml removes script/style/nav/header/footer and collapses whitespace', () => {
  const html = '<html><head><style>a{}</style><script>x()</script></head><body><nav>menu</nav><header>h</header><main>Rate  is <b>20%</b></main><footer>f</footer></body></html>';
  assert.equal(stripHtml(html), 'Rate is 20%');
});

test('compareSource: new, same, changed via updatedAt or bodyHash', () => {
  const cur = { url: 'u', updatedAt: '2026-01-01', bodyHash: 'abc' };
  assert.deepEqual(compareSource(undefined, cur), { status: 'new' });
  assert.equal(compareSource({ updatedAt: '2026-01-01', bodyHash: 'abc' }, cur).status, 'same');
  const c1 = compareSource({ updatedAt: '2025-01-01', bodyHash: 'abc' }, cur);
  assert.deepEqual(c1, { status: 'changed', field: 'updatedAt', from: '2025-01-01', to: '2026-01-01' });
  const c2 = compareSource({ updatedAt: '2026-01-01', bodyHash: 'zzz' }, cur);
  assert.deepEqual(c2, { status: 'changed', field: 'bodyHash', from: 'zzz', to: 'abc' });
  assert.equal(compareSource({ updatedAt: null, bodyHash: 'abc' }, { updatedAt: null, bodyHash: 'abc' }).status, 'same');
});

test('sourceUrls collects rates category sources and exam specUrls, deduped', () => {
  const rates = { categories: { a: { source: 'https://g/1' }, b: { source: 'https://g/1' } } };
  const exams = { specs: [{ specUrl: 'https://aqa/1' }] };
  assert.deepEqual(sourceUrls({ rates: [rates], exams: [exams] }), ['https://g/1', 'https://aqa/1']);
});
