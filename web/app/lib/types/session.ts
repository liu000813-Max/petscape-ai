export type Stage =
  | 'collecting'
  | 'rendering'
  | 'selecting'
  | 'cleaningItem'
  | 'generating3d'
  | 'preview'
  | 'slicing'
  | 'done';

export type JobType = 'agentReply' | 'renderImage' | 'cleanItem' | 'meshy' | 'slice';
export type JobStatus = 'queued' | 'running' | 'failed';

export interface PendingJob {
  type: JobType;
  status: JobStatus;
  error?: string;
  progress?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text?: string;
  imagePath?: string;
  modelPath?: string;
  sliceResult?: boolean;
  createdAt: string;
}

export interface Session {
  id: string;
  stage: Stage;
  pendingJob?: PendingJob;
  messages: ChatMessage[];
  brief: {
    species: string;
    petSize?: string;
    style?: string;
    item?: string;
    photoPath?: string;
  };
  constraints: string[];
  renderRounds: number;
  currentImagePrompt?: string;
  sceneImages: string[];
  cleanItemImage?: string;
  selection?: { selectedItem: string; itemDescription: string };
  meshy?: {
    taskId: string;
    glbPath?: string;
    repairedGlbPath?: string;
    printability?: { issues: string[]; repaired: boolean };
  };
  slice?: {
    stlPath?: string;
    gcodePath?: string;
    warnings: string[];
    estimatedTime?: string;
    filament?: string;
    normalize?: { actualExtentsMm?: number[]; boundsMm?: number[][]; transform?: Record<string, unknown> };
  };
}

export interface CollectingAgentResult {
  brief: Session['brief'];
  readyToRender: boolean;
  newConstraints: string[];
  replyToUser: string;
}

export interface RenderingAgentResult {
  action: 'regenerate' | 'proceed';
  revisedPrompt?: string;
  newConstraints: string[];
  replyToUser: string;
  parseFailed?: boolean;
}

export interface SelectingAgentResult {
  selectedItem: string;
  itemDescription: string;
  replyToUser: string;
  parseFailed?: boolean;
}

export interface PreviewAgentResult {
  action: 'confirm' | 'retry3d' | 'modifyAppearance' | 'reselect';
  replyToUser: string;
  parseFailed?: boolean;
}
