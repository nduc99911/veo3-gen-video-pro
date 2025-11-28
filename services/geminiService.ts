
import { GoogleGenAI, Type, Schema, FunctionDeclaration } from "@google/genai";
import { Scene, AspectRatio } from "../types";

// Helper to get API Key (Custom or Env)
const getApiKey = (): string => {
  if (typeof window !== 'undefined') {
    const custom = localStorage.getItem('veo3_api_key');
    if (custom) return custom;
  }
  return process.env.API_KEY || '';
};

// Helper to check for API Key and handle the Billing selection flow for Veo
export const ensureApiKey = async (): Promise<boolean> => {
  // If user has manually entered a key, we assume they have access
  if (getApiKey() && getApiKey() !== process.env.API_KEY) {
    return true;
  }

  if (typeof window !== 'undefined' && (window as any).aistudio) {
    const aistudio = (window as any).aistudio;
    const hasKey = await aistudio.hasSelectedApiKey();
    if (!hasKey) {
      const selected = await aistudio.openSelectKey();
      return selected;
    }
    return true;
  }
  return !!process.env.API_KEY;
};

// Initialize Gemini Client
const getAiClient = () => {
  return new GoogleGenAI({ apiKey: getApiKey() });
};

// 1. Generate Script Scenes from Topic
export const generateScriptFromIdea = async (topic: string, videoLength: number = 3): Promise<Scene[]> => {
  const ai = getAiClient();
  
  const sceneSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      scene_number: { type: Type.INTEGER },
      duration_seconds: { type: Type.INTEGER, description: "Duration in seconds, default 5-8s" },
      description: { type: Type.STRING, description: "Detailed visual description for video generation" },
      character: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          pose: { type: Type.STRING },
          expression: { type: Type.STRING },
          actions: { 
            type: Type.ARRAY,
            items: { type: Type.STRING }
          }
        },
        required: ["name", "pose", "expression", "actions"]
      },
      background: { type: Type.STRING, description: "Visual description of the background" },
      audio: { type: Type.STRING, description: "Sound effects or ambient noise description" },
      dialogue: { type: Type.STRING, description: "Character dialogue if any" }
    },
    required: ["scene_number", "duration_seconds", "description", "character", "background", "audio", "dialogue"]
  };

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: `Create a detailed animation script for a video about: "${topic}". 
    Generate exactly ${videoLength} distinct scenes. 
    Make sure the character is consistent in name.
    The output must be a valid JSON array of scenes.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: sceneSchema
      }
    }
  });

  if (response.text) {
    try {
      const rawScenes = JSON.parse(response.text);
      // Add internal IDs and status
      return rawScenes.map((s: any) => ({
        ...s,
        id: crypto.randomUUID(),
        status: 'pending'
      }));
    } catch (e) {
      console.error("Failed to parse script JSON", e);
      throw new Error("Failed to generate valid script format.");
    }
  }
  throw new Error("No script generated.");
};

// 2. Generate Character Reference Image
export const generateCharacterReference = async (description: string): Promise<string> => {
  const ai = getAiClient();
  // Using gemini-3-pro-image-preview for high quality character sheet
  const response = await ai.models.generateContent({
    model: "gemini-3-pro-image-preview",
    contents: {
      parts: [
        { text: `Character Design Sheet. Full body shot, front view, neutral lighting. High quality 3D animated style. Description: ${description}` }
      ]
    },
    config: {
      imageConfig: {
        aspectRatio: "1:1",
        imageSize: "1K"
      }
    }
  });

  // Extract image
  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return part.inlineData.data;
    }
  }
  throw new Error("Failed to generate character image.");
};

// 3. Generate Video for a Scene using Veo 3.1
export const generateSceneVideo = async (
    scene: Scene, 
    characterRefImageBase64: string | null,
    aspectRatio: AspectRatio = '16:9'
): Promise<string> => {
  const ai = getAiClient();
  
  // Construct a rich prompt combining description, character action, and background
  const prompt = `Cinematic animated shot. 
  Character: ${scene.character.name} is ${scene.character.pose} with expression ${scene.character.expression}. 
  Action: ${scene.character.actions.join(", ")}. 
  Setting: ${scene.background}. 
  Atmosphere: ${scene.description}.`;

  const config: any = {
    numberOfVideos: 1,
    resolution: '720p',
    aspectRatio: aspectRatio, // '16:9' or '9:16'
  };

  // Add reference image for consistency if available
  if (characterRefImageBase64) {
    config.referenceImages = [
      {
        image: {
          imageBytes: characterRefImageBase64,
          mimeType: 'image/png'
        },
        referenceType: 'ASSET' // Use ASSET for character consistency
      }
    ];
  }

  // Initial request
  let operation = await ai.models.generateVideos({
    model: 'veo-3.1-generate-preview',
    prompt: prompt,
    config: config
  });

  // Polling loop
  while (!operation.done) {
    await new Promise(resolve => setTimeout(resolve, 5000)); // Poll every 5s
    operation = await ai.operations.getVideosOperation({ operation: operation });
  }

  const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!videoUri) {
    throw new Error("Video generation completed but no URI returned.");
  }

  // Fetch the actual video blob url (needs API key appended)
  const videoUrlWithKey = `${videoUri}&key=${getApiKey()}`;
  
  // We fetch it to a blob to ensure it persists in the browser memory for the session
  try {
      const res = await fetch(videoUrlWithKey);
      const blob = await res.blob();
      return URL.createObjectURL(blob);
  } catch (e) {
      console.error("Error fetching video blob", e);
      return videoUrlWithKey; // Fallback
  }
};
