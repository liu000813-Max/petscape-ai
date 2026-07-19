import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OrderIdParamSchema,
  OrderListResponseSchema,
  OrderResponseSchema,
  CancelOrderSchema,
} from '../src/contracts/orders.ts';
import { b7SandboxSceneConfirmationFixture } from '../src/application/commerce-sandbox-fixtures.ts';

const now = new Date().toISOString();

test('order boundary accepts server-owned sandbox snapshots and exposes no fulfillment state', () => {
  const order = OrderResponseSchema.parse({
    id: 'order-1',
    paymentIntentId: 'payment-1',
    quoteId: 'quote-1',
    requestId: 'request-1',
    status: 'paid',
    sandboxOnly: true,
    amountCent: 33000,
    currency: 'CNY',
    productCode: 'cheese-lounge-bed',
    materialName: 'PETG 奶酪黄（沙箱）',
    materialVersion: 'petg-cheese-yellow-sandbox-v0',
    pricingRuleVersion: 'v0-sandbox',
    purchaseSnapshot: {
      schemaVersion: 'order-purchase.v0',
      request: {
        sceneConfirmationId: b7SandboxSceneConfirmationFixture.sceneConfirmationId,
        sceneConfirmation: b7SandboxSceneConfirmationFixture, contactName: '沙箱用户',
        contactPhone: '13800138000', usageDescription: '沙箱用途', additionalRequirements: null,
      },
      review: {
        checkRunId: 'check-1', result: 'approved', issues: [],
        evidence: [{ kind: 'note', ref: 'manual://order-contract', summary: '已通过沙箱审核' }],
        adjustmentSuggestions: [], note: null, checklistVersion: 'fdm-manual-sandbox-v0',
        ruleVersion: 'b6-manual-review-v0-sandbox',
      },
      quoteInput: {
        schemaVersion: 'quote-input.v0',
        request: {
          id: 'request-1', sceneConfirmation: b7SandboxSceneConfirmationFixture,
          productCode: 'cheese-lounge-bed', materialName: 'PETG 奶酪黄（沙箱）',
          materialVersion: 'petg-cheese-yellow-sandbox-v0', submittedAt: now,
        },
        review: {
          id: 'check-1', result: 'approved', checklistVersion: 'fdm-manual-sandbox-v0',
          ruleVersion: 'b6-manual-review-v0-sandbox', completedAt: now,
          requestSnapshot: {
            customizationRequestId: 'request-1', contactName: '沙箱用户', contactPhone: '13800138000',
            usageDescription: '沙箱用途', additionalRequirements: null, productCode: 'cheese-lounge-bed',
            materialName: 'PETG 奶酪黄（沙箱）', materialVersion: 'petg-cheese-yellow-sandbox-v0',
            sandboxOnly: true, sceneConfirmation: b7SandboxSceneConfirmationFixture, submittedAt: now,
          },
        },
        b7: {
          estimateJobId: 'estimate-1',
          jobInput: {
            schemaVersion: 'mesh-analysis-job.v0', algorithmVersion: 'trimesh-volume.v0',
            geometryUnit: 'millimeter', sceneConfirmation: b7SandboxSceneConfirmationFixture,
          },
          analysis: {
            schemaVersion: 'mesh-analysis-result.v0', algorithmVersion: 'trimesh-volume.v0',
            geometryUnit: 'millimeter', assetChecksum: b7SandboxSceneConfirmationFixture.assetRef.sha256,
            dimensionsMm: b7SandboxSceneConfirmationFixture.dimensionsMm, volumeMm3: 240342.387,
            triangleCount: 103716, watertight: true,
          },
        },
      },
      priceBreakdown: {
        schemaVersion: 'quote-price.v0', materialCostCent: 1400, weightGrams: '400',
        baseFeeCent: 2500, multiplier: '2.5000', floorPriceCent: 12900,
        amountBeforeRoundingCent: '9750', amountCent: 33000,
        formulaVersion: 'material-cent-ceil-plus-base-times-multiplier-v0',
      },
      deliveryEstimate: { status: 'unverified_sandbox', label: '沙箱交期未验证，不构成履约承诺' },
    },
    deliveryAddressSnapshot: {
      schemaVersion: 'delivery-address.v0',
      addressId: 'address-1',
      quoteId: 'quote-1',
      version: 1,
      sandboxOnly: true,
      fields: {
        recipientName: '沙箱收件人', mobile: '13800138000', province: '浙江省', city: '杭州市',
        district: '余杭区', detail: '文一西路沙箱地址', postalCode: '311100',
      },
      confirmedAt: now,
    },
    paidAt: now,
    createdAt: now,
    history: [{ sequence: '1', fromStatus: null, toStatus: 'paid', reason: 'trusted_payment_succeeded', source: 'system', actorUserId: null, createdAt: now }],
    label: '沙箱订单（不会进入真实生产或物流）',
  });
  assert.equal(order.status, 'paid');
  assert.equal(order.sandboxOnly, true);
  assert.equal('productionStatus' in order, false);
  assert.equal('shippingStatus' in order, false);
  assert.deepEqual(OrderListResponseSchema.parse({ orders: [order] }), { orders: [order] });
});

test('order routes accept only an id and reject client-owned money or snapshots', () => {
  assert.deepEqual(OrderIdParamSchema.parse({ id: 'order-1' }), { id: 'order-1' });
  assert.throws(() => OrderIdParamSchema.parse({ id: 'order-1', amountCent: 1 }));
  assert.throws(() => OrderIdParamSchema.parse({ id: '' }));
  assert.deepEqual(CancelOrderSchema.parse({ expectedStatus: 'paid' }), { expectedStatus: 'paid' });
  assert.throws(() => CancelOrderSchema.parse({ expectedStatus: 'paid', amountCent: 1 }));
});
