import { randomUUID } from 'crypto';
import type { ChatMessage, Session } from '../types/session';

declare global {
  // eslint-disable-next-line no-var
  var __petscapeSessions: Map<string, Session> | undefined;
}

export const sessions = globalThis.__petscapeSessions ?? new Map<string, Session>();
globalThis.__petscapeSessions = sessions;

export function nowIso() {
  return new Date().toISOString();
}

export function makeMessage(role: ChatMessage['role'], text?: string, imagePath?: string, modelPath?: string, sliceResult?: boolean): ChatMessage {
  return { id: randomUUID(), role, text, imagePath, modelPath, sliceResult, createdAt: nowIso() };
}

export function createSession(): Session {
  const id = randomUUID();
  const session: Session = {
    id,
    stage: 'collecting',
    messages: [
      makeMessage(
        'assistant',
        '你好，我是 PetScape 助手。请告诉我你的宠物种类、体型/尺寸、想要的造景物品和风格；也可以上传宠物照片，我会识别物种和外观，但尺寸必须由你确认。'
      ),
    ],
    brief: { species: '' },
    constraints: [],
    renderRounds: 0,
    sceneImages: [],
  };
  sessions.set(id, session);
  return session;
}

export function getSession(id: string) {
  return sessions.get(id);
}
