import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AdminPaymentAttentionListResponseSchema,
  CreatePaymentIntentSchema,
  PaymentIntentResponseSchema,
  ProviderEventSchema,
  RetryPaymentIntentSchema,
  SandboxPaymentActionSchema,
} from '../src/contracts/payments.ts';
import { createSandboxPaymentProvider, PaymentProviderDisabledError } from '../src/application/index.ts';

test('client can reference only a Quote and idempotency key, never money or address snapshots', () => {
  assert.deepEqual(CreatePaymentIntentSchema.parse({ quoteId: 'quote-1', idempotencyKey: 'payment-key-1' }), {
    quoteId: 'quote-1', idempotencyKey: 'payment-key-1',
  });
  for (const injected of [{ amountCent: 1 }, { currency: 'USD' }, { deliveryAddressId: 'forged' }, { sandboxOnly: false }]) {
    assert.throws(() => CreatePaymentIntentSchema.parse({ quoteId: 'quote-1', idempotencyKey: 'payment-key-1', ...injected }));
  }
});

test('retry contract accepts only explicit failed or canceled expectations', () => {
  assert.deepEqual(RetryPaymentIntentSchema.parse({ expectedStatus: 'failed' }), { expectedStatus: 'failed' });
  assert.deepEqual(RetryPaymentIntentSchema.parse({ expectedStatus: 'canceled' }), { expectedStatus: 'canceled' });
  for (const expectedStatus of ['processing', 'succeeded', 'requires_action', 'needs_attention']) {
    assert.throws(() => RetryPaymentIntentSchema.parse({ expectedStatus }));
  }
});

test('provider event and sandbox action boundaries are strict', () => {
  const event = {
    provider: 'sandbox', providerEventId: 'event-1', providerPaymentId: 'payment-1',
    status: 'succeeded', amountCent: 33000, currency: 'CNY', occurredAt: new Date().toISOString(),
    failureCode: null, failureMessage: null,
  };
  assert.equal(ProviderEventSchema.parse(event).status, 'succeeded');
  assert.equal(ProviderEventSchema.parse({ ...event, provider: 'future-replaceable-adapter' }).provider, 'future-replaceable-adapter');
  assert.throws(() => ProviderEventSchema.parse({ ...event, amountCent: 0 }));
  assert.throws(() => ProviderEventSchema.parse({ ...event, ownerUserId: 'attacker' }));
  assert.deepEqual(SandboxPaymentActionSchema.parse({ result: 'failed' }), { result: 'failed' });
  assert.deepEqual(SandboxPaymentActionSchema.parse({ result: 'canceled' }), { result: 'canceled' });
});

test('payment response stays visibly sandbox and never calls itself an order', () => {
  const now = new Date().toISOString();
  const value = PaymentIntentResponseSchema.parse({
    id: 'pi-1', quoteId: 'quote-1', deliveryAddressId: 'address-1', deliveryAddressVersion: 2,
    amountCent: 33000, currency: 'CNY', mode: 'sandbox_test', provider: 'sandbox', sandboxOnly: true,
    status: 'requires_action', attentionCode: null, label: '沙箱支付（不会发生真实扣款或成交）',
    attempts: [{ id: 'attempt-1', attemptNo: 1, provider: 'sandbox', providerPaymentId: 'sandbox-pi-1-1',
      status: 'requires_action', actionUrl: '/sandbox-pay/attempt-1', failureCode: null, failureMessage: null,
      createdAt: now, resolvedAt: null }],
    succeededAt: null, failedAt: null, canceledAt: null, needsAttentionAt: null, createdAt: now, updatedAt: now,
  });
  assert.equal(value.sandboxOnly, true);
  assert.equal(value.attentionCode, null);
  assert.equal('orderId' in value, false);
});

test('payment response exposes stable machine-readable attention reasons', () => {
  const now = new Date().toISOString();
  const base = {
    id: 'pi-attention', quoteId: 'quote-1', deliveryAddressId: 'address-1', deliveryAddressVersion: 1,
    amountCent: 33000, currency: 'CNY', mode: 'sandbox_test', provider: 'sandbox', sandboxOnly: true,
    status: 'needs_attention', label: '沙箱支付（不会发生真实扣款或成交）', attempts: [],
    succeededAt: null, failedAt: null, canceledAt: null, needsAttentionAt: now, createdAt: now, updatedAt: now,
  };
  for (const attentionCode of ['amount_mismatch', 'stale_succeeded_attempt', 'provider_state_conflict', 'unspecified']) {
    assert.equal(PaymentIntentResponseSchema.parse({ ...base, attentionCode }).attentionCode, attentionCode);
  }
  assert.throws(() => PaymentIntentResponseSchema.parse({ ...base, attentionCode: 'free-form-message' }));
});

test('admin attention queue is read-only response data with the same payment contract', () => {
  const now = new Date().toISOString();
  const paymentIntent = {
    id: 'pi-attention', quoteId: 'quote-1', deliveryAddressId: 'address-1', deliveryAddressVersion: 1,
    amountCent: 33000, currency: 'CNY', mode: 'sandbox_test', provider: 'sandbox', sandboxOnly: true,
    status: 'needs_attention', attentionCode: 'amount_mismatch', label: '沙箱支付（不会发生真实扣款或成交）', attempts: [],
    succeededAt: null, failedAt: null, canceledAt: null, needsAttentionAt: now, createdAt: now, updatedAt: now,
  };
  const value = AdminPaymentAttentionListResponseSchema.parse({ items: [{ ownerUserId: 'user-1', paymentIntent }] });
  assert.equal(value.items[0].paymentIntent.attentionCode, 'amount_mismatch');
});

test('sandbox provider is fail-closed in production', () => {
  assert.throws(
    () => createSandboxPaymentProvider({ secret: 'test-secret-at-least-32-characters', environment: 'production' }),
    (error) => error instanceof PaymentProviderDisabledError,
  );
  assert.throws(() => createSandboxPaymentProvider({ secret: 'too-short', environment: 'test' }),
    (error) => error instanceof PaymentProviderDisabledError && /长度不足/.test(error.message));
});
