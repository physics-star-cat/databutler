// tests/vehicles-uk.test.js — UK DVSA recalls: dataset shape, matching, search, near-misses, builder.
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../api/_vehicles');
const { ukMakeSlug, norm } = require('../api/_vehicles_text');
const { freshnessFor } = require('../api/_freshness');
const { parseCsv, ukDate, buildUkFrom, UK_YEARS_BACK } = require('../scripts/vehicles');

const UK = V.UK;
const SERVICE = 'https://www.check-vehicle-recalls.service.gov.uk/';

test('uk dataset: shape, provenance, window and compact model tuples', () => {
  assert.equal(UK.count, UK.records.length);
  assert.ok(UK.count >= 4000, `recalls ${UK.count}`);
  assert.equal(UK.source, SERVICE);
  assert.equal(UK.datasetUrl, `${SERVICE}documents/RecallsFile.csv`);
  assert.match(UK.licence, /Open Government Licence v3\.0/);
  assert.match(UK.verifiedDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(UK.nextScheduledRefresh > UK.verifiedDate);
  assert.equal(UK.filter.launchDateFrom, `${Number(UK.verifiedDate.slice(0, 4)) - UK_YEARS_BACK}-01-01`);
  assert.deepEqual(UK.modelFields, ['model', 'buildStart', 'buildEnd', 'vehiclesAffected']);
  assert.equal(UK.modelRows, UK.records.reduce((n, r) => n + r.models.length, 0));
  assert.ok(UK.sourceCounts.recalls > UK.count, 'older recalls stay in the source');
  const seen = new Set();
  for (const r of UK.records) {
    assert.ok(!seen.has(r.no), `duplicate ${r.no}`); seen.add(r.no);
    assert.match(r.no, /^R(M|COMP|CT|PT|SPV|TW|PC)?\/\d{4}\/\d+$/, r.no);
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/, r.no);
    assert.ok(r.date >= UK.filter.launchDateFrom, r.no);
    assert.ok(r.make && r.makeSlug === ukMakeSlug(r.make), r.no);
    assert.ok(typeof r.defect === 'string' && typeof r.remedy === 'string' && typeof r.concern === 'string', r.no);
    assert.ok(r.models.length >= 1, r.no);
    for (const m of r.models) {
      assert.equal(m.length, 4, r.no);
      for (const d of [m[1], m[2]]) assert.ok(d === null || /^\d{4}-\d{2}-\d{2}$/.test(d), `${r.no} build date ${d}`);
      assert.ok(m[3] === null || Number.isInteger(m[3]), `${r.no} vehicles ${m[3]}`);
    }
  }
  const fresh = freshnessFor('uk-recalls', new Date(`${UK.verifiedDate}T12:00:00Z`));
  assert.equal(fresh.verifiedDate, UK.verifiedDate);
  assert.equal(fresh.staleness, 'fresh');
  assert.equal(freshnessFor('uk-recalls', new Date('2030-01-01T00:00:00Z')).staleness, 'overdue');
});

test('ukMakeSlug: importer suffixes drop, brand aliases merge, product lines keep a brand prefix', () => {
  assert.equal(ukMakeSlug('MERCEDES-BENZ CARS UK LTD'), 'mercedes');
  assert.equal(ukMakeSlug('MERCEDES BENZ UK LIMITED'), 'mercedes');
  assert.equal(ukMakeSlug('Mercedes-Benz'), 'mercedes');
  assert.equal(ukMakeSlug('MERCEDES-BENZ VANS UK LTD'), 'mercedes-vans');
  assert.equal(ukMakeSlug('TOYOTA (GB) PLC'), 'toyota');
  assert.equal(ukMakeSlug('Nissan Motor (GB) Limited'), 'nissan');
  assert.equal(ukMakeSlug('VW'), 'volkswagen');
  assert.equal(ukMakeSlug('Volkswagen'), 'volkswagen');
  assert.equal(ukMakeSlug('Land Rover'), ukMakeSlug('LAND ROVER'));
  assert.equal(ukMakeSlug('VOLVO CAR'), 'volvo');
  assert.equal(ukMakeSlug('VOLVO TRUCKS'), 'volvo-trucks');
  assert.equal(ukMakeSlug('BMW MOTORRAD UK'), 'bmw-motorrad');
  assert.equal(ukMakeSlug('GENERAL MOTORS CO LLC'), 'general-motors');
  assert.equal(ukMakeSlug(''), '');
  assert.equal(ukMakeSlug(undefined), '');
});

test('uk_recalls_for_model: case-insensitive make/model, exact + whole-word matches, newest first, official links', () => {
  const a = V.ukRecallsForModel({ make: 'Vauxhall', model: 'Corsa' });
  const b = V.ukRecallsForModel({ make: 'vauxhall', model: 'corsa' });
  const c = V.ukRecallsForModel({ make: 'VAUXHALL', model: 'CORSA' });
  assert.ok(a.count > 10, `count ${a.count}`);
  assert.equal(a.count, b.count);
  assert.equal(a.count, c.count);
  assert.deepEqual(a.recalls.map((r) => r.recallNumber), b.recalls.map((r) => r.recallNumber));
  assert.equal(a.make, 'vauxhall');
  assert.equal(a.model, 'corsa');
  assert.deepEqual(a.makeNamesInSource, ['VAUXHALL']);
  assert.ok(a.recalls.some((r) => r.matchedBy === 'exact') && a.recalls.some((r) => r.matchedBy === 'text'));
  for (const r of a.recalls) {
    assert.ok(['exact', 'text'].includes(r.matchedBy));
    assert.ok(/corsa/i.test(r.model), r.model);
    assert.ok(!/^CORSAVAN$/i.test(r.model), 'whole-word: CORSAVAN is not CORSA');
    assert.ok(r.recallNumber && r.launchDate && r.defect && r.remedy && r.concern, r.recallNumber);
    assert.equal(r.make, 'VAUXHALL');
    assert.equal(r.category, 'cars, HGVs and PSVs');
    assert.match(r.link, /^https:\/\/www\.check-vehicle-recalls\.service\.gov\.uk\/recall-type\/vehicle\/make\/VAUXHALL\/model\/CORSA[^/]*\/year\/\d{4}\/recalls$/, r.link);
    assert.ok(r.buildStart === null || r.buildStart <= (r.buildEnd || '9999'), r.recallNumber);
    assert.ok(Array.isArray(r.models) && r.models.length >= 1);
  }
  for (let i = 1; i < a.recalls.length; i++) assert.ok(a.recalls[i - 1].launchDate >= a.recalls[i].launchDate, 'sorted desc');
  assert.equal(a.source, SERVICE);
  assert.match(a.attributionNote, /Open Government Licence/);
  assert.match(a.matching, /CORSAVAN/);
});

test('uk_recalls_for_model: make aliases and product lines, since filter, make-only listing with model names', () => {
  const merc = V.ukRecallsForModel({ make: 'Mercedes-Benz', model: 'Sprinter' });
  assert.ok(merc.count > 0);
  assert.ok(merc.makeNamesInSource.some((n) => /VANS/.test(n)), 'mercedes query reaches MERCEDES-BENZ VANS UK LTD');
  const vw = V.ukRecallsForModel({ make: 'Volkswagen', model: 'golf' });
  assert.equal(vw.make, 'volkswagen');
  assert.deepEqual(vw.makeNamesInSource, ['VW']);
  assert.ok(vw.count > 0);
  const since = V.ukRecallsForModel({ make: 'ford', model: 'focus', since: '2024-01-01' });
  assert.equal(since.since, '2024-01-01');
  assert.ok(since.recalls.every((r) => r.launchDate >= '2024-01-01'));
  assert.ok(since.count < V.ukRecallsForModel({ make: 'ford', model: 'focus' }).count);
  const all = V.ukRecallsForModel({ make: 'Land Rover' });
  assert.equal(all.model, null);
  assert.ok(all.count > 50 && all.recalls.length <= V.MAX_RESULTS && all.truncated);
  assert.ok(all.modelsInSource.includes('DEFENDER') && all.modelsInSource.includes('RANGE ROVER EVOQUE'));
  assert.ok(all.recalls.every((r) => r.matchedBy === undefined));
});

test('uk_recalls_for_model: unknown make → near-miss; unknown model → count 0 with nearest models; bad since', () => {
  const miss = V.ukRecallsForModel({ make: 'Vauxhal', model: 'corsa' });
  assert.equal(miss.covered, false);
  assert.equal(miss.nearest[0], 'vauxhall');
  assert.ok(miss.coverage.makes.includes('ford'));
  assert.equal(miss.coverage.recalls, UK.count);
  const none = V.ukRecallsForModel({ make: 'vauxhall', model: 'corsaa' });
  assert.equal(none.count, 0);
  assert.deepEqual(none.recalls, []);
  assert.ok(none.makeRecallCount > 100);
  assert.ok(none.nearestModels.includes('corsa'));
  assert.match(none.hint, /uk_recalls_search/);
  assert.equal(V.ukRecallsForModel({ make: 'vauxhall', model: 'corsa', since: 'last year' }).covered, false);
  assert.equal(V.ukRecallsForModel({}).covered, false);
  assert.equal(V.ukRecallsForModel({ model: 'corsa' }).covered, false);
});

test('uk_recalls_search: every token must match, since filters, newest first, no-hit hint, bad input near-misses', () => {
  const out = V.ukRecallsSearch({ text: 'airbag takata', since: '2024-01-01' });
  assert.ok(out.count > 0);
  assert.equal(out.since, '2024-01-01');
  for (const r of out.recalls) {
    assert.ok(r.launchDate >= '2024-01-01');
    const hay = norm(`${r.make} ${r.model} ${r.concern} ${r.defect} ${r.remedy}`);
    assert.ok(hay.includes('airbag') && hay.includes('takata'), r.recallNumber);
  }
  for (let i = 1; i < out.recalls.length; i++) assert.ok(out.recalls[i - 1].launchDate >= out.recalls[i].launchDate);
  assert.ok(V.ukRecallsSearch({ text: 'Fire' }).count > V.ukRecallsSearch({ text: 'fire high voltage battery' }).count);
  const none = V.ukRecallsSearch({ text: 'qwertyuiop' });
  assert.equal(none.count, 0);
  assert.ok(none.hint);
  assert.equal(V.ukRecallsSearch({ text: 'airbag', since: 'yesterday' }).covered, false);
  assert.equal(V.ukRecallsSearch({}).covered, false);
  assert.equal(none.source, SERVICE);
});

test('multi-model recalls: one record per recall, matched models narrowed, others listed, totals explained', () => {
  const multi = UK.records.find((r) => r.models.length > 3 && new Set(r.models.map((m) => m[0])).size > 3);
  assert.ok(multi, 'a multi-model recall exists');
  const [model] = multi.models.find((m) => m[0]);
  const out = V.ukRecallsForModel({ make: multi.make, model });
  const rec = out.recalls.find((r) => r.recallNumber === multi.no);
  assert.ok(rec, `${multi.no} found via ${multi.make} ${model}`);
  assert.equal(out.recalls.filter((r) => r.recallNumber === multi.no).length, 1, 'no duplicate per model row');
  assert.ok(rec.otherModelsOnRecall.length >= 1);
  assert.equal(new Set(rec.otherModelsOnRecall).size, rec.otherModelsOnRecall.length, 'other models deduplicated');
  assert.match(out.notes.vehiclesAffected, /largest figure/);
});

test('builder: CSV parsing, dd/mm/yyyy dates, grouping by recall number and the rolling window', () => {
  assert.deepEqual(parseCsv('a,b\n1,"x, ""y""\nz"\r\n2,\n'), [['a', 'b'], ['1', 'x, "y"\nz'], ['2', '']]);
  assert.equal(ukDate('13/02/2017'), '2017-02-13');
  assert.equal(ukDate(''), null);
  assert.equal(ukDate('2017-02-13'), null);
  const header = 'Launch Date,Recalls Number,Make,Recalls Model Information,Concern,Defect,Remedy,Vehicle Numbers,Manufacturer Ref,Model,VIN Start,Vin End,Build Start,Build End';
  const csv = [
    header,
    '13/02/2017,R/2016/292,VAUXHALL,CORSA D,STEERING RACK MAY FRACTURE,"The toothed rack, might break.",Replace it.,3333,16-C-001,CORSA D,,,01/01/2014,31/12/2015',
    '13/02/2017,R/2016/292,VAUXHALL,ADAM,STEERING RACK MAY FRACTURE,"The toothed rack, might break.",Replace it.,3333,16-C-001,ADAM,,,01/06/2014,,',
    '10/03/2008,R/2008/016,IVECO,TRAKKER,RISK OF INSTABILITY,Old.,Old.,32,,TRAKKER,,,01/12/2006,31/01/2007',
    '01/02/2026,RM/2026/001,HONDA MOTORCYCLES,CBR,BRAKE,Brake.,Fix.,,,CBR,,,,',
  ].join('\r\n');
  const d = buildUkFrom(csv, { fetched: '2026-10-03T09:00:00.000Z', sourceLastModified: 'Sat, 03 Oct 2026 03:02:52 GMT', via: 'test' });
  assert.equal(d.filter.launchDateFrom, '2016-01-01');
  assert.equal(d.count, 2, 'the 2008 recall falls outside the window');
  assert.deepEqual(d.sourceCounts, { rows: 4, recalls: 3 });
  assert.equal(d.verifiedDate, '2026-10-03');
  assert.equal(d.nextScheduledRefresh, '2026-11-03');
  const corsa = d.records.find((r) => r.no === 'R/2016/292');
  assert.equal(corsa.date, '2017-02-13');
  assert.equal(corsa.makeSlug, 'vauxhall');
  assert.equal(corsa.defect, 'The toothed rack, might break.');
  assert.deepEqual(corsa.models, [['CORSA D', '2014-01-01', '2015-12-31', 3333], ['ADAM', '2014-06-01', null, 3333]]);
  const cbr = d.records.find((r) => r.no === 'RM/2026/001');
  assert.equal(cbr.makeSlug, 'honda-motorcycles');
  assert.deepEqual(cbr.models, [['CBR', null, null, null]]);
  assert.equal(d.records[0].no, 'RM/2026/001', 'newest first');
  assert.throws(() => buildUkFrom('Nope,Header\n1,2', { fetched: '2026-10-03T09:00:00.000Z' }), /column "Launch Date" missing/);
});
