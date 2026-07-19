// WP-C5-1 — owner-scoped current checkout address and explicit pre-payment confirmation.
import {
  ConfirmDeliveryAddressSchema,
  ConfirmedDeliveryAddressSnapshotSchema,
  DELIVERY_ADDRESS_SCHEMA_VERSION,
  DeliveryAddressResponseSchema,
  SaveDeliveryAddressSchema,
  type ConfirmDeliveryAddress,
  type ConfirmedDeliveryAddressSnapshot,
  type DeliveryAddressResponse,
  type SaveDeliveryAddress,
} from '../contracts/delivery-addresses.ts';
import { NotFoundError } from '../domain/index.ts';
import type { PrismaClient } from '../infra/db/index.ts';

const LABEL = '沙箱配送地址（仅用于测试，不会发起真实支付）' as const;

export class DeliveryAddressConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeliveryAddressConflictError';
  }
}

export class DeliveryAddressEligibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeliveryAddressEligibilityError';
  }
}

function errorCode(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: unknown }).code === code;
}

function isSerializationFailure(error: unknown) {
  if (errorCode(error, 'P2034') || errorCode(error, '40001')) return true;
  return error instanceof Error && /(?:SQLSTATE\s*)?40001|could not serialize|write conflict/i.test(error.message);
}

type AddressRow = {
  id: string; quoteId: string; recipientName: string; mobile: string;
  province: string; city: string; district: string; detail: string;
  postalCode: string | null; sandboxOnly: boolean; version: number;
  confirmedAt: Date | null; createdAt: Date; updatedAt: Date;
};

function toResponse(row: AddressRow): DeliveryAddressResponse {
  return DeliveryAddressResponseSchema.parse({
    id: row.id,
    quoteId: row.quoteId,
    version: row.version,
    confirmed: row.confirmedAt !== null,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    sandboxOnly: row.sandboxOnly,
    label: LABEL,
    recipientName: row.recipientName,
    mobile: row.mobile,
    province: row.province,
    city: row.city,
    district: row.district,
    detail: row.detail,
    postalCode: row.postalCode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function normalizedFields(input: SaveDeliveryAddress) {
  return {
    recipientName: input.recipientName,
    mobile: input.mobile,
    province: input.province,
    city: input.city,
    district: input.district,
    detail: input.detail,
    postalCode: input.postalCode ?? null,
  };
}

function sameFields(row: AddressRow, input: SaveDeliveryAddress) {
  const fields = normalizedFields(input);
  return row.recipientName === fields.recipientName && row.mobile === fields.mobile &&
    row.province === fields.province && row.city === fields.city &&
    row.district === fields.district && row.detail === fields.detail &&
    row.postalCode === fields.postalCode;
}

async function withSerializableRetry<T>(prisma: PrismaClient, work: (tx: PrismaClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(
        (tx) => work(tx as PrismaClient),
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (!isSerializationFailure(error)) throw error;
      if (attempt === 2) throw new DeliveryAddressConflictError('地址并发写入失败，请重试');
    }
  }
  throw new DeliveryAddressConflictError('地址并发写入失败，请重试');
}

export async function saveDeliveryAddress({ prisma, ownerUserId, input: untrusted }: {
  prisma: PrismaClient; ownerUserId: string; input: SaveDeliveryAddress;
}): Promise<{ deliveryAddress: DeliveryAddressResponse; created: boolean }> {
  const input = SaveDeliveryAddressSchema.parse(untrusted);
  try {
    return await withSerializableRetry(prisma, async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "quote"
        WHERE "id" = ${input.quoteId} AND "ownerUserId" = ${ownerUserId}
        FOR UPDATE
      `;
      if (locked.length !== 1) throw new NotFoundError('Quote');
      const quote = await tx.quote.findUnique({ where: { id: input.quoteId } });
      if (!quote || quote.status !== 'accepted' || !quote.acceptedAt) {
        throw new DeliveryAddressEligibilityError('只有已接受的 Quote 才能填写本次结算地址');
      }

      const existing = await tx.deliveryAddress.findUnique({ where: { quoteId: input.quoteId } });
      if (!existing) {
        if (input.expectedVersion !== undefined) {
          throw new DeliveryAddressConflictError('地址尚不存在，首次保存不得携带 expectedVersion');
        }
        const created = await tx.deliveryAddress.create({ data: {
          ownerUserId,
          quoteId: quote.id,
          sandboxOnly: quote.sandboxOnly,
          ...normalizedFields(input),
        } });
        return { deliveryAddress: toResponse(created), created: true as const };
      }
      if (sameFields(existing, input) && input.expectedVersion === undefined) {
        return { deliveryAddress: toResponse(existing), created: false as const };
      }
      if (input.expectedVersion === undefined || existing.version !== input.expectedVersion) {
        throw new DeliveryAddressConflictError('地址版本已变化，请刷新后重试');
      }
      if (sameFields(existing, input)) {
        return { deliveryAddress: toResponse(existing), created: false as const };
      }
      const updated = await tx.deliveryAddress.updateMany({
        where: { id: existing.id, ownerUserId, version: input.expectedVersion },
        data: {
          ...normalizedFields(input),
          confirmedAt: null,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new DeliveryAddressConflictError('地址版本已变化，请刷新后重试');
      const row = await tx.deliveryAddress.findUniqueOrThrow({ where: { id: existing.id } });
      return { deliveryAddress: toResponse(row), created: false as const };
    });
  } catch (error) {
    if (errorCode(error, 'P2002')) {
      const existing = await prisma.deliveryAddress.findFirst({ where: { quoteId: input.quoteId, ownerUserId } });
      if (existing && sameFields(existing, input) && input.expectedVersion === undefined) {
        return { deliveryAddress: toResponse(existing), created: false };
      }
      throw new DeliveryAddressConflictError('该 Quote 的地址已被并发创建');
    }
    throw error;
  }
}

export async function listDeliveryAddresses({ prisma, ownerUserId }: {
  prisma: PrismaClient; ownerUserId: string;
}): Promise<DeliveryAddressResponse[]> {
  const rows = await prisma.deliveryAddress.findMany({
    where: { ownerUserId },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
  });
  return rows.map(toResponse);
}

export async function confirmDeliveryAddress({ prisma, ownerUserId, addressId, input: untrusted, now = new Date() }: {
  prisma: PrismaClient; ownerUserId: string; addressId: string; input: ConfirmDeliveryAddress; now?: Date;
}): Promise<DeliveryAddressResponse> {
  const input = ConfirmDeliveryAddressSchema.parse(untrusted);
  return withSerializableRetry(prisma, async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "delivery_address"
      WHERE "id" = ${addressId} AND "ownerUserId" = ${ownerUserId}
      FOR UPDATE
    `;
    if (locked.length !== 1) throw new NotFoundError('DeliveryAddress');
    const row = await tx.deliveryAddress.findUnique({ where: { id: addressId } });
    if (!row) throw new NotFoundError('DeliveryAddress');
    if (row.confirmedAt && row.version === input.expectedVersion + 1) return toResponse(row);
    if (row.version !== input.expectedVersion) {
      throw new DeliveryAddressConflictError('地址版本已变化，请刷新后重试');
    }
    if (row.confirmedAt) return toResponse(row);
    const quote = await tx.quote.findFirst({ where: { id: row.quoteId, ownerUserId } });
    if (!quote || quote.status !== 'accepted' || !quote.acceptedAt) {
      throw new DeliveryAddressEligibilityError('只有已接受的 Quote 地址可以确认');
    }
    const updated = await tx.deliveryAddress.updateMany({
      where: { id: row.id, ownerUserId, version: input.expectedVersion, confirmedAt: null },
      data: { confirmedAt: now, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new DeliveryAddressConflictError('地址确认发生并发冲突');
    return toResponse(await tx.deliveryAddress.findUniqueOrThrow({ where: { id: row.id } }));
  });
}

export async function getConfirmedDeliveryAddressInput({ prisma, ownerUserId, quoteId }: {
  prisma: PrismaClient; ownerUserId: string; quoteId: string;
}): Promise<ConfirmedDeliveryAddressSnapshot> {
  const quote = await prisma.quote.findFirst({ where: { id: quoteId, ownerUserId }, select: { id: true, status: true } });
  if (!quote) throw new NotFoundError('Quote');
  if (quote.status !== 'accepted') throw new DeliveryAddressEligibilityError('Quote 尚未接受');
  const row = await prisma.deliveryAddress.findFirst({ where: { quoteId, ownerUserId } });
  if (!row || !row.confirmedAt) {
    throw new DeliveryAddressEligibilityError('付款前必须确认配送地址');
  }
  return ConfirmedDeliveryAddressSnapshotSchema.parse({
    schemaVersion: DELIVERY_ADDRESS_SCHEMA_VERSION,
    addressId: row.id,
    quoteId: row.quoteId,
    version: row.version,
    sandboxOnly: row.sandboxOnly,
    fields: {
      recipientName: row.recipientName,
      mobile: row.mobile,
      province: row.province,
      city: row.city,
      district: row.district,
      detail: row.detail,
      postalCode: row.postalCode,
    },
    confirmedAt: row.confirmedAt.toISOString(),
  });
}
