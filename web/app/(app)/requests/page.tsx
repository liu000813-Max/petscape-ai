import type { Metadata } from 'next';
import { B7_SANDBOX_SCENE_CONFIRMATION_ID } from '@petscape/server/application';
import { CustomizationRequestsClient } from './CustomizationRequestsClient';

export const metadata: Metadata = {
  title: '定制申请 · PetScape',
  description: '提交并追踪 PetScape 沙箱定制申请。',
};

export default function CustomizationRequestsPage() {
  return (
    <CustomizationRequestsClient
      sandboxSceneConfirmationId={B7_SANDBOX_SCENE_CONFIRMATION_ID}
    />
  );
}
