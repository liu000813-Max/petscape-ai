import {
  createPrismaSandboxPaymentStateStore,
  createSandboxPaymentProvider,
  PaymentProviderDisabledError,
  type SandboxPaymentProvider,
} from '@petscape/server/application';
import { loadWebConfig } from '@petscape/server/infra/config';
import { getWebServerContext } from './server-context';

let cached: SandboxPaymentProvider | undefined;

export function getWebPaymentProvider(): SandboxPaymentProvider {
  if (cached) return cached;
  const config = loadWebConfig();
  if (config.PAYMENT_PROVIDER_MODE !== 'sandbox' || !config.SANDBOX_PAYMENT_SECRET) {
    throw new PaymentProviderDisabledError('沙箱支付 provider 未启用');
  }
  cached = createSandboxPaymentProvider({
    secret: config.SANDBOX_PAYMENT_SECRET,
    environment: config.NODE_ENV,
    stateStore: createPrismaSandboxPaymentStateStore(getWebServerContext().prisma),
  });
  return cached;
}
