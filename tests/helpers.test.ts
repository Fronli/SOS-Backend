import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, toCsv } from '../src/utils/csv.util';
import { parsePagination, parseCursor } from '../src/utils/pagination.util';
import { parseId } from '../src/utils/id.util';
import { platformFee } from '../src/services/wallet.service';
import { isMimeAllowed, purposeRule, extensionFor, isValidKey } from '../src/services/storage.service';
import { hashToken, createRefreshToken } from '../src/utils/token.util';

test('csvCell escapes separators and quotes', () => {
    assert.equal(csvCell('plain'), 'plain');
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
    assert.equal(csvCell(null), '');
    assert.equal(csvCell(undefined), '');
    assert.equal(csvCell(42), '42');
});

test('toCsv writes header and rows', () => {
    const csv = toCsv([{ a: 1, b: 'x,y' }, { a: 2, b: 'z' }]);
    assert.equal(csv, 'a,b\r\n1,"x,y"\r\n2,z\r\n');
});

test('toCsv returns empty string for no rows and no headers', () => {
    assert.equal(toCsv([]), '');
});

test('parsePagination applies defaults and clamps limit', () => {
    assert.deepEqual(parsePagination({}), { page: 1, limit: 20, offset: 0 });
    assert.deepEqual(parsePagination({ page: '3', limit: '10' }), { page: 3, limit: 10, offset: 20 });
    assert.deepEqual(parsePagination({ page: '-1', limit: '999' }), { page: 1, limit: 50, offset: 0 });
    assert.deepEqual(parsePagination({ page: 'abc', limit: 'abc' }), { page: 1, limit: 20, offset: 0 });
});

test('parseCursor accepts only positive integers', () => {
    assert.equal(parseCursor('12'), 12);
    assert.equal(parseCursor('0'), null);
    assert.equal(parseCursor('x'), null);
    assert.equal(parseCursor(undefined), null);
});

test('parseId rejects non-positive and non-integer values', () => {
    assert.equal(parseId('7'), 7);
    assert.equal(parseId(7), 7);
    assert.equal(parseId(['9']), 9);
    assert.equal(parseId('0'), null);
    assert.equal(parseId('1.5'), null);
    assert.equal(parseId('abc'), null);
    assert.equal(parseId(undefined), null);
});

test('platformFee follows PLATFORM_FEE_PERCENT', () => {
    const original = process.env.PLATFORM_FEE_PERCENT;
    try {
        delete process.env.PLATFORM_FEE_PERCENT;
        assert.equal(platformFee(100000), 0);

        process.env.PLATFORM_FEE_PERCENT = '5';
        assert.equal(platformFee(100000), 5000);

        process.env.PLATFORM_FEE_PERCENT = '0';
        assert.equal(platformFee(100000), 0);
    } finally {
        if (original === undefined) delete process.env.PLATFORM_FEE_PERCENT;
        else process.env.PLATFORM_FEE_PERCENT = original;
    }
});

test('file purpose rules limit mime and size', () => {
    assert.equal(isMimeAllowed('AVATAR', 'image/png'), true);
    assert.equal(isMimeAllowed('AVATAR', 'application/pdf'), false);
    assert.equal(isMimeAllowed('STUDENT_ID', 'application/pdf'), true);
    assert.equal(purposeRule('AVATAR').private, false);
    assert.equal(purposeRule('STUDENT_ID').private, true);
    assert.ok(purposeRule('CHAT_ATTACHMENT').maxBytes > purposeRule('AVATAR').maxBytes);
});

test('extensionFor maps known mime types', () => {
    assert.equal(extensionFor('image/jpeg'), 'jpg');
    assert.equal(extensionFor('image/png'), 'png');
    assert.equal(extensionFor('application/pdf'), 'pdf');
    assert.equal(extensionFor('application/unknown'), 'bin');
});

test('isValidKey only accepts uuid-style keys', () => {
    assert.equal(isValidKey('123e4567-e89b-12d3-a456-426614174000.png'), true);
    assert.equal(isValidKey('../etc/passwd'), false);
    assert.equal(isValidKey('abc.png'), false);
    assert.equal(isValidKey(null), false);
});

test('refresh tokens are random and stored hashed', () => {
    const first = createRefreshToken();
    const second = createRefreshToken();
    assert.notEqual(first.token, second.token);
    assert.notEqual(first.hash, second.hash);
    assert.equal(first.hash.length, 64);
    assert.equal(hashToken(first.token), first.hash);
    assert.notEqual(first.hash, first.token);
});
