
export interface Hint {
  id: string;
  text: string;
  timestamp: number;
  type: 'hint' | 'transcription';
}

export enum AppMode {
  DASHBOARD = 'dashboard',
  OVERLAY = 'overlay'
}

export interface GeminiConfig {
  systemInstruction: string;
  voiceName: string;
}
