import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CreateQuoteSchema,
  QuoteResponseSchema,
  QuoteTransitionSchema,
} from '../src/contracts/quotes.ts';

test('quote creation boundary never accepts client money or snapshots', () => {
  const input = {
    requestId: 'request-1',
    estimateJobId: 'job-1',
    idempotencyKey: 'quote-contract-1',
    quoteMode: 'sandbox_test',
  };
  assert.equal(CreateQuoteSchema.parse(input).quoteMode, 'sandbox_test');
  assert.equal(CreateQuoteSchema.safeParse({ ...input, amountCent: 1 }).success, false);
  assert.equal(CreateQuoteSchema.safeParse({ ...input, inputSnapshot: {} }).success, false);
});

test('quote response distinguishes sandbox test quotes and validates lifecycle', () => {
  const now = new Date('2026-07-19T00:00:00.000Z');
  const response = {
    id: 'quote-1',
    requestId: 'request-1',
    checkRunId: 'check-1',
    estimateJobId: 'job-1',
    quoteMode: 'sandbox_test',
    label: '沙箱测试报价（不可用于真实交易）',
    sandboxOnly: true,
    status: 'active',
    productCode: 'cheese-lounge-bed',
    materialName: 'PETG 奶酪黄（沙箱）',
    materialVersion: 'petg-cheese-yellow-sandbox-v0',
    pricingRuleVersion: 'v0-sandbox',
    amountCent: 12900,
    currency: 'CNY',
    taxMode: 'tax_inclusive',
    roundingMode: 'ceil_whole_yuan',
    deliveryEstimate: {
      status: 'unverified_sandbox',
      label: '沙箱交期未验证，不构成履约承诺',
    },
    validFrom: now.toISOString(),
    expiresAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
    acceptedAt: null,
    expiredAt: null,
    supersededAt: null,
    canceledAt: null,
    supersedesQuoteId: null,
    createdAt: now.toISOString(),
  };
  assert.equal(QuoteResponseSchema.parse(response).status, 'active');
  assert.equal(QuoteResponseSchema.safeParse({ ...response, amountCent: 12.5 }).success, false);
  assert.equal(QuoteTransitionSchema.safeParse({ expectedStatus: 'active' }).success, true);
  assert.equal(QuoteTransitionSchema.safeParse({ expectedStatus: 'accepted' }).success, false);
});
