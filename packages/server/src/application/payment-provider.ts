import type { ProviderEvent } from '../contracts/payments.ts';

export type CreateProviderPaymentInput = {
  merchantPaymentId: string;
  amountCent: number;
  currency: 'CNY';
};

export type ProviderPayment = {
  providerPaymentId: string;
  status: ProviderEvent['status'];
  amountCent: number;
  currency: 'CNY';
  updatedAt: string;
};

export type VerifiedProviderEvent = {
  event: ProviderEvent;
  persistenceProof: string;
};

export type VerifiedProviderPayment = {
  payment: ProviderPayment;
  persistenceProof: string;
};

export interface PaymentProviderPort {
  readonly name: string;
  readonly verificationKeyHash: string;
  createPayment(input: CreateProviderPaymentInput): Promise<VerifiedProviderPayment>;
  verifyEvent(rawBody: string, signature: string | null): Promise<VerifiedProviderEvent>;
  queryPayment(providerPaymentId: string): Promise<VerifiedProviderPayment>;
}

export class PaymentProviderDisabledError extends Error {}
export class PaymentProviderSignatureError extends Error {}
