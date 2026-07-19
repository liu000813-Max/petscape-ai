// WP-C5-1 — 当前结算地址与付款前确认的进程边界。
import { z } from 'zod';

export const DELIVERY_ADDRESS_SCHEMA_VERSION = 'delivery-address.v0' as const;

const idSchema = z.string().trim().min(1).max(191);
const shortText = (field: string, max: number) => z.string().trim().min(1, `${field} 不能为空`).max(max);
const mobileSchema = z.string().trim().min(6).max(32).regex(/^[0-9+() -]+$/, 'mobile 格式无效');
const postalCodeSchema = z.string().trim().min(3).max(16).regex(/^[A-Za-z0-9 -]+$/, 'postalCode 格式无效');

export const DeliveryAddressFieldsSchema = z.strictObject({
  recipientName: shortText('recipientName', 80),
  mobile: mobileSchema,
  province: shortText('province', 80),
  city: shortText('city', 80),
  district: shortText('district', 80),
  detail: shortText('detail', 500),
  postalCode: postalCodeSchema.nullable(),
});

export const SaveDeliveryAddressSchema = z.strictObject({
  quoteId: idSchema,
  expectedVersion: z.number().int().positive().optional(),
  recipientName: DeliveryAddressFieldsSchema.shape.recipientName,
  mobile: DeliveryAddressFieldsSchema.shape.mobile,
  province: DeliveryAddressFieldsSchema.shape.province,
  city: DeliveryAddressFieldsSchema.shape.city,
  district: DeliveryAddressFieldsSchema.shape.district,
  detail: DeliveryAddressFieldsSchema.shape.detail,
  postalCode: DeliveryAddressFieldsSchema.shape.postalCode.optional(),
});

export const ConfirmDeliveryAddressSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
});

export const DeliveryAddressIdParamSchema = z.strictObject({ id: idSchema });

export const DeliveryAddressResponseSchema = z.strictObject({
  id: idSchema,
  quoteId: idSchema,
  version: z.number().int().positive(),
  confirmed: z.boolean(),
  confirmedAt: z.iso.datetime().nullable(),
  sandboxOnly: z.boolean(),
  label: z.literal('沙箱配送地址（仅用于测试，不会发起真实支付）'),
  recipientName: DeliveryAddressFieldsSchema.shape.recipientName,
  mobile: DeliveryAddressFieldsSchema.shape.mobile,
  province: DeliveryAddressFieldsSchema.shape.province,
  city: DeliveryAddressFieldsSchema.shape.city,
  district: DeliveryAddressFieldsSchema.shape.district,
  detail: DeliveryAddressFieldsSchema.shape.detail,
  postalCode: DeliveryAddressFieldsSchema.shape.postalCode,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const DeliveryAddressListResponseSchema = z.strictObject({
  deliveryAddresses: z.array(DeliveryAddressResponseSchema),
});

export const ConfirmedDeliveryAddressSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(DELIVERY_ADDRESS_SCHEMA_VERSION),
  addressId: idSchema,
  quoteId: idSchema,
  version: z.number().int().positive(),
  sandboxOnly: z.boolean(),
  fields: DeliveryAddressFieldsSchema,
  confirmedAt: z.iso.datetime(),
});

export const DeliveryAddressApiErrorSchema = z.strictObject({
  error: z.enum(['unauthorized', 'invalid_json', 'invalid_request', 'not_found', 'conflict']),
  detail: z.string().optional(),
  issues: z.array(z.strictObject({
    path: z.array(z.union([z.string(), z.number()])),
    message: z.string(),
  })).optional(),
});

export type SaveDeliveryAddress = z.infer<typeof SaveDeliveryAddressSchema>;
export type ConfirmDeliveryAddress = z.infer<typeof ConfirmDeliveryAddressSchema>;
export type DeliveryAddressResponse = z.infer<typeof DeliveryAddressResponseSchema>;
export type ConfirmedDeliveryAddressSnapshot = z.infer<typeof ConfirmedDeliveryAddressSnapshotSchema>;
