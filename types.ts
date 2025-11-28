
export interface CharacterData {
  name: string;
  pose: string;
  expression: string;
  actions: string[];
}

export type TransitionType = 'none' | 'fade' | 'wipe_left' | 'wipe_right' | 'slide_left' | 'slide_right';

export interface Scene {
  scene_number: number;
  duration_seconds: number;
  description: string;
  character: CharacterData;
  background: string;
  audio: string;
  dialogue: string;
  // App state fields
  id: string; // unique internal ID
  status: 'pending' | 'generating' | 'completed' | 'error';
  videoUrl?: string;
  errorMsg?: string;
  // Video Editing fields
  trimStart?: number; // Seconds to skip at start
  trimEnd?: number;   // Seconds to cut from end
  overlayText?: string; // Text to display on top of video
  transition?: {
    type: TransitionType;
    duration: number; // Duration of the transition INTO this scene (or from previous)
  };
}

export interface BackgroundMusic {
  url: string;
  name: string;
  volume: number; // 0.0 to 1.0
  type: 'preset' | 'upload';
}

export type AspectRatio = '16:9' | '9:16';

export interface Project {
  id: string;
  name: string;
  topic: string;
  characterDescription: string;
  characterImageBase64: string | null; // The reference image for consistency
  scenes: Scene[];
  backgroundMusic?: BackgroundMusic;
  aspectRatio: AspectRatio;
  createdAt: number;
}

export enum AppStep {
  DASHBOARD = 'DASHBOARD',
  CREATE_IDEA = 'CREATE_IDEA',
  CHARACTER_DESIGN = 'CHARACTER_DESIGN',
  SCRIPT_EDITOR = 'SCRIPT_EDITOR',
  VIDEO_GENERATION = 'VIDEO_GENERATION',
}

export type ExportResolution = '720p' | '1080p';
export type ExportFormat = 'mp4' | 'mov';
