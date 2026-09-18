import { describe, it, expect } from 'vitest';
import { parseTableQrPayload } from '../src/utils/qrGenerator';

// Pure unit tests — no DOM, no camera, no server.
//
// This is the function that decides whether a scanned QR is allowed to move a
// guest to a table, and its failure mode is nasty in a way that is invisible in
// review: a QR code is just printed text, so a code belonging to another
// restaurant — or to a table this restaurant deleted last month — would
// otherwise be accepted, and the guest's order would land in the wrong kitchen
// or against a table that doesn't exist. The rejections are the point here.

const CURRENT = {
  currentRestaurantId: 'rest-osh',
  currentSlug: 'osh-markazi',
  knownTableNumbers: [1, 2, 3, 7, 12]
};

describe('parseTableQrPayload: accepts this restaurant\'s own table codes', () => {
  it('reads the slug form the admin QR generator prints', () => {
    expect(parseTableQrPayload('https://clients.qulaycafe.uz/order/osh-markazi?table=7', CURRENT)).toEqual({
      ok: true,
      tableNumber: 7
    });
  });

  it('reads the legacy ?r=<id> form printed by older QR codes', () => {
    expect(
      parseTableQrPayload('https://clients.qulaycafe.uz/?table=12&r=rest-osh', CURRENT)
    ).toEqual({ ok: true, tableNumber: 12 });
  });

  it('tolerates a trailing slash and surrounding whitespace', () => {
    expect(parseTableQrPayload('  https://clients.qulaycafe.uz/order/osh-markazi/?table=3  ', CURRENT)).toEqual({
      ok: true,
      tableNumber: 3
    });
  });

  it('accepts a bare query string with no host', () => {
    expect(parseTableQrPayload('?table=2', CURRENT)).toEqual({ ok: true, tableNumber: 2 });
  });

  it('accepts any table number when the restaurant\'s table list is unknown', () => {
    // An empty list means "we never loaded the tables", not "there are none" —
    // a guest must not be blocked by a failed /api/tables request.
    expect(parseTableQrPayload('https://clients.qulaycafe.uz/order/osh-markazi?table=99', {
      currentRestaurantId: 'rest-osh',
      currentSlug: 'osh-markazi',
      knownTableNumbers: []
    })).toEqual({ ok: true, tableNumber: 99 });
  });
});

describe('parseTableQrPayload: rejects anything that is not a table code', () => {
  it('rejects a plain string with no table in it', () => {
    expect(parseTableQrPayload('https://instagram.com/oshmarkazi', CURRENT)).toEqual({
      ok: false,
      reason: 'not_table_qr'
    });
  });

  it('rejects an empty payload', () => {
    expect(parseTableQrPayload('', CURRENT)).toEqual({ ok: false, reason: 'not_table_qr' });
  });

  it('rejects a non-numeric or zero table', () => {
    for (const bad of ['?table=abc', '?table=0', '?table=-4']) {
      expect(parseTableQrPayload(`https://clients.qulaycafe.uz/order/osh-markazi${bad}`, CURRENT)).toEqual({
        ok: false,
        reason: 'not_table_qr'
      });
    }
  });
});

describe('parseTableQrPayload: a code from somewhere else must not move the guest', () => {
  it('rejects a different restaurant id', () => {
    expect(
      parseTableQrPayload('https://clients.qulaycafe.uz/?table=2&r=rest-other', CURRENT)
    ).toEqual({ ok: false, reason: 'other_restaurant', tableNumber: 2 });
  });

  it('rejects a different restaurant slug', () => {
    expect(
      parseTableQrPayload('https://clients.qulaycafe.uz/order/boshqa-kafe?table=2', CURRENT)
    ).toEqual({ ok: false, reason: 'other_restaurant', tableNumber: 2 });
  });

  it('rejects a table this restaurant does not have', () => {
    // Deleted tables and reprints leave old codes stuck to real tables, so the
    // number has to be checked against the list rather than merely parsed.
    expect(
      parseTableQrPayload('https://clients.qulaycafe.uz/order/osh-markazi?table=5', CURRENT)
    ).toEqual({ ok: false, reason: 'unknown_table', tableNumber: 5 });
  });

  it('still reports the too-high table number so the guest can be told which one', () => {
    expect(
      parseTableQrPayload('https://clients.qulaycafe.uz/order/osh-markazi?table=40', CURRENT)
    ).toEqual({ ok: false, reason: 'unknown_table', tableNumber: 40 });
  });
});
