import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ConfirmDeliveryAddressSchema,
  ConfirmedDeliveryAddressSnapshotSchema,
  DeliveryAddressResponseSchema,
  SaveDeliveryAddressSchema,
} from '../src/contracts/delivery-addresses.ts';
import {
  DeliveryAddressConflictError,
  saveDeliveryAddress,
} from '../src/application/delivery-addresses.ts';

const fields = {
  recipientName: '顾客甲', mobile: '13800138000', province: '浙江省', city: '杭州市',
  district: '余杭区', detail: '文一西路 1 号', postalCode: '311100',
};

test('save boundary accepts only the frozen C5 fields and CAS version', () => {
  assert.deepEqual(SaveDeliveryAddressSchema.parse({ quoteId: 'quote-1', ...fields }), {
    quoteId: 'quote-1', ...fields,
  });
  assert.throws(() => SaveDeliveryAddressSchema.parse({
    quoteId: 'quote-1', ...fields, confirmedAt: new Date().toISOString(),
  }));
  assert.throws(() => SaveDeliveryAddressSchema.parse({ quoteId: 'quote-1', ...fields, expectedVersion: 0 }));
  assert.throws(() => SaveDeliveryAddressSchema.parse({ quoteId: 'quote-1', ...fields, mobile: '<script>' }));
});

test('confirmation boundary accepts only a positive expectedVersion', () => {
  assert.deepEqual(ConfirmDeliveryAddressSchema.parse({ expectedVersion: 2 }), { expectedVersion: 2 });
  assert.throws(() => ConfirmDeliveryAddressSchema.parse({ expectedVersion: 2, confirmed: true }));
});

test('response and C3 snapshot preserve sandbox and confirmation semantics', () => {
  const now = new Date().toISOString();
  assert.equal(DeliveryAddressResponseSchema.parse({
    id: 'address-1', quoteId: 'quote-1', version: 2, confirmed: true, confirmedAt: now,
    sandboxOnly: true, label: '沙箱配送地址（仅用于测试，不会发起真实支付）', ...fields,
    createdAt: now, updatedAt: now,
  }).confirmed, true);
  assert.equal(ConfirmedDeliveryAddressSnapshotSchema.parse({
    schemaVersion: 'delivery-address.v0', addressId: 'address-1', quoteId: 'quote-1',
    version: 2, sandboxOnly: true, fields, confirmedAt: now,
  }).fields.detail, fields.detail);
  assert.throws(() => ConfirmedDeliveryAddressSnapshotSchema.parse({
    schemaVersion: 'delivery-address.v0', addressId: 'address-1', quoteId: 'quote-1',
    version: 2, sandboxOnly: true, fields,
  }));
});

test('serialization retry exhaustion becomes a domain conflict instead of a raw 500', async () => {
  let attempts = 0;
  const prisma = {
    $transaction: async () => {
      attempts += 1;
      throw Object.assign(new Error('could not serialize access'), { code: 'P2034' });
    },
  };
  await assert.rejects(
    () => saveDeliveryAddress({ prisma, ownerUserId: 'owner-1', input: { quoteId: 'quote-1', ...fields } }),
    (error) => error instanceof DeliveryAddressConflictError,
  );
  assert.equal(attempts, 3);
});
