
import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, Plus, Video, Film, Edit3, Image as ImageIcon, 
  Download, ChevronRight, Save, Trash2, RefreshCw, Wand2,
  Scissors, Layers, Music, Volume2, Upload, Settings, Type,
  MoveRight, Sparkles, Smartphone, Monitor, X, Terminal
} from 'lucide-react';
import { ensureApiKey, generateScriptFromIdea, generateCharacterReference, generateSceneVideo } from './services/geminiService';
import { stitchVideos } from './services/videoProcessor';
import { Project, Scene, AppStep, BackgroundMusic, ExportResolution, ExportFormat, TransitionType, AspectRatio } from './types';

// --- Sub-components ---

const StepIndicator = ({ step, currentStep }: { step: AppStep, currentStep: AppStep }) => {
  const steps = [
    AppStep.DASHBOARD, 
    AppStep.CREATE_IDEA, 
    AppStep.CHARACTER_DESIGN, 
    AppStep.SCRIPT_EDITOR, 
    AppStep.VIDEO_GENERATION
  ];
  
  const idx = steps.indexOf(step);
  const currentIdx = steps.indexOf(currentStep);
  const isCompleted = idx < currentIdx;
  const isCurrent = idx === currentIdx;

  let label = "";
  switch(step) {
    case AppStep.DASHBOARD: label = "Home"; break;
    case AppStep.CREATE_IDEA: label = "Idea"; break;
    case AppStep.CHARACTER_DESIGN: label = "Character"; break;
    case AppStep.SCRIPT_EDITOR: label = "Script"; break;
    case AppStep.VIDEO_GENERATION: label = "Render"; break;
  }

  return (
    <div className={`flex items-center space-x-2 ${isCurrent ? 'text-indigo-400' : isCompleted ? 'text-green-400' : 'text-gray-600'}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 
        ${isCurrent ? 'border-indigo-400 bg-indigo-400/10' : isCompleted ? 'border-green-400 bg-green-400/10' : 'border-gray-700 bg-gray-800'}`}>
        <span className="text-xs font-bold">{idx}</span>
      </div>
      <span className="hidden md:inline text-sm font-medium">{label}</span>
      {idx < steps.length - 1 && <div className="w-8 h-px bg-gray-700 mx-2 hidden md:block" />}
    </div>
  );
};

const LoadingOverlay = ({ message, progress }: { message: string, progress?: number }) => (
  <div className="absolute inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center z-50 transition-opacity duration-300">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500 mb-6 shadow-lg shadow-indigo-500/50"></div>
    <p className="text-white text-xl font-bold animate-pulse mb-6 tracking-wide">{message}</p>
    {progress !== undefined && (
      <div className="w-96 max-w-[90%]">
        <div className="flex justify-between text-xs font-mono text-indigo-300 mb-2">
            <span>RENDERING...</span>
            <span>{Math.round(progress)}%</span>
        </div>
        <div className="w-full h-4 bg-gray-800 rounded-full overflow-hidden border border-gray-700 shadow-inner">
          <div 
            className="h-full bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-500 transition-all duration-200 ease-linear shadow-[0_0_15px_rgba(99,102,241,0.5)]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    )}
  </div>
);

// --- Sample Music ---
const PRESET_MUSIC = [
  { name: "Cheerful", url: "https://actions.google.com/sounds/v1/cartoon/cartoon_boing.ogg" }, 
  { name: "Ambient", url: "https://actions.google.com/sounds/v1/water/air_woosh_underwater.ogg" },
  { name: "Nature", url: "https://actions.google.com/sounds/v1/ambiences/forest_morning.ogg" }
];

// --- Types & Interfaces ---
interface LogEntry {
    time: string;
    level: 'info' | 'warn' | 'error';
    message: string;
}

// --- Main App Component ---

export default function App() {
  const [currentStep, setCurrentStep] = useState<AppStep>(AppStep.DASHBOARD);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [progress, setProgress] = useState<number | undefined>(undefined);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  
  // Settings & Debug
  const [showSettings, setShowSettings] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Inputs
  const [ideaInput, setIdeaInput] = useState("");
  const [aspectRatioInput, setAspectRatioInput] = useState<AspectRatio>('16:9');
  const [charDescInput, setCharDescInput] = useState("");
  
  // Export Settings
  const [exportRes, setExportRes] = useState<ExportResolution>('720p');
  const [exportFmt, setExportFmt] = useState<ExportFormat>('mp4');
  
  // File Input Ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Console Interception
  useEffect(() => {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    const addLog = (level: 'info'|'warn'|'error', ...args: any[]) => {
        const time = new Date().toLocaleTimeString('en-US', { hour12: false });
        const message = args.map(arg => {
            try {
                return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
            } catch {
                return '[Unserializable]';
            }
        }).join(' ');
        
        setLogs(prev => [...prev.slice(-199), { time, level, message }]); // Keep last 200 logs
    };

    console.log = (...args) => {
        originalLog(...args);
        addLog('info', ...args);
    };

    console.warn = (...args) => {
        originalWarn(...args);
        addLog('warn', ...args);
    };

    console.error = (...args) => {
        originalError(...args);
        addLog('error', ...args);
    };

    return () => {
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
    };
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    if (showDebug && logContainerRef.current) {
        logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, showDebug]);

  // Check API key on mount and load projects from local storage
  useEffect(() => {
    const saved = localStorage.getItem('veo3_projects');
    if (saved) {
      try {
        const parsedProjects = JSON.parse(saved);
        setProjects(parsedProjects);
      } catch (e) {
        console.error("Failed to load projects from local storage", e);
      }
    }
    
    // Load stored key
    const storedKey = localStorage.getItem('veo3_api_key');
    if (storedKey) setApiKeyInput(storedKey);
    
    console.log("App initialized. Ready to create magic.");
  }, []);

  const handleSaveSettings = () => {
    localStorage.setItem('veo3_api_key', apiKeyInput);
    setShowSettings(false);
    console.log("Settings saved.");
  };

  const handleSaveProjects = () => {
    setSaveState('saving');
    // small delay to show spinner if it's too fast, improves UX
    setTimeout(() => {
        try {
            localStorage.setItem('veo3_projects', JSON.stringify(projects));
            setSaveState('saved');
            console.log("Project saved to local storage.");
            setTimeout(() => setSaveState('idle'), 2000);
        } catch (e) {
            console.error("Save failed", e);
            alert("Failed to save project. Storage quota might be exceeded.");
            setSaveState('idle');
        }
    }, 400); 
  };

  const updateProject = (updated: Project) => {
    setCurrentProject(updated);
    setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
  };

  const handleCreateProject = async () => {
    if (!ideaInput) return;
    try {
      setLoading(true);
      console.log(`Starting new project creation for topic: ${ideaInput.substring(0,20)}...`);
      setLoadingMsg("Please select a billing project if prompted...");
      const hasKey = await ensureApiKey();
      if (!hasKey) {
        setLoading(false);
        console.warn("API Key selection cancelled or failed.");
        return;
      }

      setLoadingMsg("Generating script from idea...");
      const scenes = await generateScriptFromIdea(ideaInput, 4);
      console.log(`Generated ${scenes.length} scenes.`);

      const newProject: Project = {
        id: crypto.randomUUID(),
        name: ideaInput.slice(0, 30) + (ideaInput.length > 30 ? "..." : ""),
        topic: ideaInput,
        characterDescription: "A friendly character", 
        characterImageBase64: null,
        scenes,
        aspectRatio: aspectRatioInput,
        createdAt: Date.now()
      };

      const updatedProjects = [...projects, newProject];
      setProjects(updatedProjects);
      setCurrentProject(newProject);
      setCharDescInput(newProject.scenes[0]?.character?.name || "Main Character");
      setCurrentStep(AppStep.CHARACTER_DESIGN);
      
      localStorage.setItem('veo3_projects', JSON.stringify(updatedProjects));
    } catch (e: any) {
      console.error("Project creation error:", e);
      alert(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateCharacter = async () => {
    if (!currentProject) return;
    try {
      setLoading(true);
      setLoadingMsg("Designing your character...");
      console.log("Generating character reference image...");
      const base64 = await generateCharacterReference(charDescInput);
      console.log("Character image generated successfully.");
      
      const updated = { ...currentProject, characterDescription: charDescInput, characterImageBase64: base64 };
      updateProject(updated);
    } catch (e: any) {
      console.error("Character generation error:", e);
      alert(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmCharacter = () => {
    setCurrentStep(AppStep.SCRIPT_EDITOR);
  };

  const handleUpdateScene = (sceneId: string, updates: Partial<Scene>) => {
    if (!currentProject) return;
    const updatedScenes = currentProject.scenes.map(s => 
      s.id === sceneId ? { ...s, ...updates } : s
    );
    const updated = { ...currentProject, scenes: updatedScenes };
    updateProject(updated);
  };

  const handleGenerateVideoForScene = async (sceneId: string) => {
    if (!currentProject) return;
    const sceneIndex = currentProject.scenes.findIndex(s => s.id === sceneId);
    if (sceneIndex === -1) return;

    const scene = currentProject.scenes[sceneIndex];
    console.log(`Generating video for Scene ${scene.scene_number}...`);
    
    handleUpdateScene(sceneId, { status: 'generating', errorMsg: undefined });

    try {
      const videoUrl = await generateSceneVideo(scene, currentProject.characterImageBase64, currentProject.aspectRatio);
      console.log(`Video generated for Scene ${scene.scene_number}`);
      handleUpdateScene(sceneId, { status: 'completed', videoUrl });
    } catch (e: any) {
      console.error(`Error generating Scene ${scene.scene_number}:`, e);
      handleUpdateScene(sceneId, { status: 'error', errorMsg: e.message });
    }
  };

  const handleGenerateAllVideos = async () => {
    if (!currentProject) return;
    console.log("Starting batch generation for all pending scenes...");
    for (const scene of currentProject.scenes) {
      if (scene.status !== 'completed' && scene.status !== 'generating') {
        await handleGenerateVideoForScene(scene.id); 
      }
    }
    console.log("Batch generation process finished.");
  };

  // Music Handling
  const handleMusicUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!currentProject || !event.target.files?.[0]) return;
    const file = event.target.files[0];
    const url = URL.createObjectURL(file);
    console.log("Music uploaded:", file.name);
    
    const newMusic: BackgroundMusic = {
        url,
        name: file.name,
        volume: currentProject.backgroundMusic?.volume || 0.3,
        type: 'upload'
    };
    updateProject({ ...currentProject, backgroundMusic: newMusic });
  };

  const handleSelectPresetMusic = (preset: {name: string, url: string}) => {
    if (!currentProject) return;
    console.log("Preset music selected:", preset.name);
    const newMusic: BackgroundMusic = {
        url: preset.url,
        name: preset.name,
        volume: currentProject.backgroundMusic?.volume || 0.3,
        type: 'preset'
    };
    updateProject({ ...currentProject, backgroundMusic: newMusic });
  };

  const handleMusicVolumeChange = (vol: number) => {
    if (!currentProject?.backgroundMusic) return;
    const updated = {
        ...currentProject,
        backgroundMusic: { ...currentProject.backgroundMusic, volume: vol }
    };
    updateProject(updated);
  };

  const handleRemoveMusic = () => {
    if (!currentProject) return;
    updateProject({ ...currentProject, backgroundMusic: undefined });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleStitchVideos = async () => {
    if (!currentProject) return;
    try {
      setLoading(true);
      setLoadingMsg("Starting video engine...");
      console.log("Starting video stitching process...");
      setProgress(0);
      
      const finalUrl = await stitchVideos(
          currentProject.scenes, 
          currentProject.backgroundMusic,
          exportRes,
          exportFmt,
          currentProject.aspectRatio,
          (prog, msg) => {
            setProgress(prog);
            setLoadingMsg(msg);
            // We don't log every progress tick to console to avoid spam, but we could
          }
      );

      console.log("Video stitching completed successfully. Downloading...");
      const a = document.createElement('a');
      a.href = finalUrl;
      a.download = `${currentProject.name.replace(/\s+/g, '_')}_${exportRes}.${exportFmt}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

    } catch (e: any) {
      console.error("Stitching failed:", e);
      alert(`Stitching failed: ${e.message}`);
    } finally {
      setLoading(false);
      setProgress(undefined);
    }
  };

  // --- Views ---

  const renderSettingsModal = () => {
    if (!showSettings) return null;
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-md shadow-2xl overflow-hidden animate-fade-in">
          <div className="p-4 border-b border-gray-700 flex justify-between items-center bg-gray-900/50">
            <h3 className="text-lg font-bold text-white flex items-center">
              <Settings className="mr-2 text-indigo-400" size={20} /> Settings
            </h3>
            <button onClick={() => setShowSettings(false)} className="text-gray-500 hover:text-white transition-colors">
              <X size={20} />
            </button>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Google Gemini API Key
              </label>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="Enter your API Key here..."
                className="w-full bg-gray-900 border border-gray-600 rounded-lg p-3 text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
              />
              <p className="text-xs text-gray-500 mt-2">
                Leave empty to use the default environment key (if provided).
                This key is stored locally in your browser.
              </p>
            </div>
          </div>
          <div className="p-4 border-t border-gray-700 bg-gray-900/50 flex justify-end">
            <button
              onClick={handleSaveSettings}
              className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-bold transition-colors"
            >
              Save Changes
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderDebugConsole = () => {
      if (!showDebug) return null;
      return (
        <div className="fixed bottom-4 right-4 w-full max-w-lg h-64 bg-gray-950 border border-gray-700 rounded-xl shadow-2xl z-40 flex flex-col overflow-hidden animate-slide-up">
            <div className="flex justify-between items-center px-4 py-2 bg-gray-900 border-b border-gray-800">
                <span className="text-xs font-bold text-gray-400 flex items-center">
                    <Terminal size={12} className="mr-2" /> DEBUG CONSOLE
                </span>
                <div className="flex space-x-2">
                    <button onClick={() => setLogs([])} className="text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-400 px-2 py-0.5 rounded transition-colors">
                        Clear
                    </button>
                    <button onClick={() => setShowDebug(false)} className="text-gray-500 hover:text-white">
                        <X size={14} />
                    </button>
                </div>
            </div>
            <div ref={logContainerRef} className="flex-1 overflow-y-auto p-4 space-y-1 font-mono text-[10px] md:text-xs">
                {logs.length === 0 && <span className="text-gray-600 italic">No logs yet...</span>}
                {logs.map((log, i) => (
                    <div key={i} className="flex items-start space-x-2 break-all">
                        <span className="text-gray-600 flex-shrink-0">[{log.time}]</span>
                        <span className={`${
                            log.level === 'error' ? 'text-red-400' : 
                            log.level === 'warn' ? 'text-yellow-400' : 'text-blue-300'
                        } flex-shrink-0 uppercase w-10`}>{log.level}</span>
                        <span className="text-gray-300">{log.message}</span>
                    </div>
                ))}
            </div>
        </div>
      );
  };

  const renderDashboard = () => (
    <div className="flex flex-col items-center justify-center h-full space-y-8 p-8">
      <div className="text-center space-y-4 max-w-2xl">
        <h1 className="text-5xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-500">
          Veo3 Story Animator
        </h1>
        <p className="text-xl text-gray-400">
          Turn your ideas into animated stories with consistent characters and AI-directed scenes.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-4xl">
        <button 
          onClick={() => setCurrentStep(AppStep.CREATE_IDEA)}
          className="group relative p-8 bg-gray-800 rounded-2xl border border-gray-700 hover:border-indigo-500 transition-all text-left"
        >
          <div className="absolute top-6 right-6 p-3 bg-indigo-500/20 rounded-full text-indigo-400 group-hover:bg-indigo-500 group-hover:text-white transition-colors">
            <Plus size={24} />
          </div>
          <h3 className="text-2xl font-bold text-white mb-2">New Project</h3>
          <p className="text-gray-400">Start from a text idea or topic.</p>
        </button>

        <div className="p-8 bg-gray-800/50 rounded-2xl border border-gray-800 text-left overflow-y-auto max-h-64">
          <h3 className="text-xl font-bold text-gray-300 mb-4">Recent Projects</h3>
          {projects.length === 0 ? (
            <p className="text-gray-500 text-sm">No projects yet.</p>
          ) : (
            <ul className="space-y-2">
              {projects.map(p => (
                <li key={p.id} 
                    onClick={() => { setCurrentProject(p); setCurrentStep(AppStep.VIDEO_GENERATION); }}
                    className="flex items-center justify-between p-3 hover:bg-gray-700 rounded-lg cursor-pointer group">
                  <span className="text-gray-300 font-medium truncate">{p.name}</span>
                  <ChevronRight size={16} className="text-gray-500 group-hover:text-white" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );

  const renderCreateIdea = () => (
    <div className="max-w-3xl mx-auto w-full p-8 flex flex-col h-full justify-center">
      <h2 className="text-3xl font-bold text-white mb-6">What's your story about?</h2>
      <textarea
        value={ideaInput}
        onChange={(e) => setIdeaInput(e.target.value)}
        placeholder="e.g., A brave cat exploring a cyber city to find the legendary golden mouse."
        className="w-full h-40 bg-gray-800 border-2 border-gray-700 rounded-xl p-6 text-xl text-white placeholder-gray-500 focus:border-indigo-500 focus:outline-none resize-none mb-8"
      />

      <div className="mb-8">
         <label className="text-gray-400 text-sm font-bold uppercase mb-3 block">Video Format</label>
         <div className="grid grid-cols-2 gap-4">
             <button
                onClick={() => setAspectRatioInput('16:9')}
                className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${aspectRatioInput === '16:9' ? 'bg-indigo-900/30 border-indigo-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'}`}
             >
                 <Monitor size={32} className="mb-2" />
                 <span className="font-bold">Landscape (16:9)</span>
                 <span className="text-xs opacity-70">YouTube, TV</span>
             </button>
             <button
                onClick={() => setAspectRatioInput('9:16')}
                className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all ${aspectRatioInput === '9:16' ? 'bg-indigo-900/30 border-indigo-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'}`}
             >
                 <Smartphone size={32} className="mb-2" />
                 <span className="font-bold">Portrait (9:16)</span>
                 <span className="text-xs opacity-70">TikTok, Reels, Shorts</span>
             </button>
         </div>
      </div>

      <button
        onClick={handleCreateProject}
        disabled={!ideaInput.trim()}
        className="self-end bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-4 rounded-xl font-bold text-lg flex items-center shadow-lg shadow-indigo-900/50 transition-all"
      >
        <Wand2 className="mr-3" />
        Generate Script
      </button>
    </div>
  );

  const renderCharacterDesign = () => (
    <div className="max-w-5xl mx-auto w-full p-6 flex flex-col h-full">
      <h2 className="text-2xl font-bold text-white mb-6 flex items-center">
        <ImageIcon className="mr-3 text-indigo-400" />
        Character Design
      </h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 flex-1">
        <div className="flex flex-col space-y-6">
            <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
                <label className="block text-sm font-medium text-gray-400 mb-2">Character Description</label>
                <textarea
                    value={charDescInput}
                    onChange={(e) => setCharDescInput(e.target.value)}
                    className="w-full h-32 bg-gray-900 border border-gray-600 rounded-lg p-3 text-white focus:border-indigo-500 focus:outline-none mb-4"
                />
                <button
                    onClick={handleGenerateCharacter}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-lg font-medium flex items-center justify-center"
                >
                    <RefreshCw size={18} className="mr-2" />
                    Generate Appearance
                </button>
            </div>
            <div className="bg-gray-800/50 p-6 rounded-xl text-sm text-gray-400">
                <p>This image will be used as a reference for Veo 3 to ensure your character looks consistent across all generated video scenes.</p>
            </div>
        </div>

        <div className="bg-black rounded-xl border-2 border-dashed border-gray-700 flex items-center justify-center overflow-hidden relative group">
            {currentProject?.characterImageBase64 ? (
                <>
                <img 
                    src={`data:image/png;base64,${currentProject.characterImageBase64}`} 
                    alt="Character" 
                    className="w-full h-full object-contain"
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                   <span className="text-white font-bold bg-black/50 px-4 py-2 rounded-full backdrop-blur-md">Character Reference Asset</span>
                </div>
                </>
            ) : (
                <div className="text-center text-gray-500">
                    <ImageIcon size={48} className="mx-auto mb-2 opacity-50" />
                    <p>No character generated yet</p>
                </div>
            )}
        </div>
      </div>

      <div className="mt-8 flex justify-end">
          <button
            onClick={handleConfirmCharacter}
            disabled={!currentProject?.characterImageBase64}
            className="bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:bg-gray-700 text-white px-8 py-3 rounded-xl font-bold text-lg flex items-center"
          >
            Approve & Continue <ChevronRight className="ml-2" />
          </button>
      </div>
    </div>
  );

  const renderScriptEditor = () => (
    <div className="w-full h-full flex flex-col p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white flex items-center">
            <Edit3 className="mr-3 text-indigo-400" />
            Script Editor
        </h2>
        <button
            onClick={() => setCurrentStep(AppStep.VIDEO_GENERATION)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-lg font-bold flex items-center"
        >
            Go to Video Generation <Film className="ml-2" size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-6 pr-4">
        {currentProject?.scenes.map((scene, idx) => (
            <div key={scene.id} className="bg-gray-800 border border-gray-700 rounded-xl p-6 transition-colors hover:border-gray-600">
                <div className="flex justify-between items-start mb-4">
                    <span className="bg-indigo-900 text-indigo-200 text-xs font-bold px-2 py-1 rounded">SCENE {scene.scene_number}</span>
                    <span className="text-gray-500 text-sm flex items-center"><Video size={14} className="mr-1"/> {scene.duration_seconds}s</span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Description (The Shot)</label>
                            <textarea
                                value={scene.description}
                                onChange={(e) => handleUpdateScene(scene.id, { description: e.target.value })}
                                className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-sm text-gray-200 focus:border-indigo-500 outline-none h-24"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Dialogue</label>
                            <input
                                value={scene.dialogue}
                                onChange={(e) => handleUpdateScene(scene.id, { dialogue: e.target.value })}
                                className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-sm text-gray-200 focus:border-indigo-500 outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Overlay Text / Caption</label>
                            <input
                                value={scene.overlayText || ""}
                                onChange={(e) => handleUpdateScene(scene.id, { overlayText: e.target.value })}
                                className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-sm text-gray-200 focus:border-indigo-500 outline-none"
                                placeholder="Text to appear on screen..."
                            />
                        </div>
                    </div>
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                             <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Pose</label>
                                <input
                                    value={scene.character.pose}
                                    onChange={(e) => handleUpdateScene(scene.id, { character: { ...scene.character, pose: e.target.value } })}
                                    className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-sm text-gray-200 focus:border-indigo-500 outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Expression</label>
                                <input
                                    value={scene.character.expression}
                                    onChange={(e) => handleUpdateScene(scene.id, { character: { ...scene.character, expression: e.target.value } })}
                                    className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-sm text-gray-200 focus:border-indigo-500 outline-none"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Actions</label>
                            <input
                                value={scene.character.actions.join(", ")}
                                onChange={(e) => handleUpdateScene(scene.id, { character: { ...scene.character, actions: e.target.value.split(",").map(s => s.trim()) } })}
                                className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-sm text-gray-200 focus:border-indigo-500 outline-none"
                            />
                        </div>
                         <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Background</label>
                            <input
                                value={scene.background}
                                onChange={(e) => handleUpdateScene(scene.id, { background: e.target.value })}
                                className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-sm text-gray-200 focus:border-indigo-500 outline-none"
                            />
                        </div>
                    </div>
                </div>
            </div>
        ))}
      </div>
    </div>
  );

  const renderVideoGeneration = () => {
    // Collect all video URLs that are done
    const readyVideosCount = currentProject?.scenes.filter(s => s.status === 'completed' && s.videoUrl).length || 0;
    const totalVideos = currentProject?.scenes.length || 0;
    const canStitch = readyVideosCount > 0 && readyVideosCount === totalVideos;

    return (
        <div className="w-full flex flex-col p-6">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-white flex items-center">
                    <Film className="mr-3 text-indigo-400" />
                    Production Studio
                </h2>
                 <div className="space-x-3">
                     <button
                        onClick={handleGenerateAllVideos}
                        className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded-lg font-bold flex items-center text-sm"
                    >
                        <Wand2 size={16} className="mr-2" />
                        Generate All Scenes
                    </button>
                    <button
                        onClick={() => setCurrentStep(AppStep.SCRIPT_EDITOR)}
                        className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg font-bold flex items-center text-sm"
                    >
                        <Edit3 size={16} className="mr-2" />
                        Back to Edit
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-auto">
                {/* Scene List & Controls */}
                <div className="lg:col-span-2 space-y-4">
                    {currentProject?.scenes.map((scene) => (
                        <div key={scene.id} className="bg-gray-800 rounded-xl overflow-hidden flex border border-gray-700 flex-col md:flex-row">
                             <div className={`flex-shrink-0 relative flex items-center justify-center border-r border-gray-700 bg-black ${currentProject?.aspectRatio === '9:16' ? 'w-full md:w-32 h-64 md:h-auto' : 'w-full md:w-48 h-32 md:h-auto'}`}>
                                {scene.status === 'completed' && scene.videoUrl ? (
                                    <video src={scene.videoUrl} className="w-full h-full object-cover" controls />
                                ) : scene.status === 'generating' ? (
                                    <div className="text-indigo-400 animate-pulse flex flex-col items-center">
                                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-400 mb-2"></div>
                                        <span className="text-xs">Generating...</span>
                                    </div>
                                ) : scene.status === 'error' ? (
                                    <div className="text-red-400 text-center p-2 text-xs">
                                        Error. <br/> Try again.
                                    </div>
                                ) : (
                                    <div className="text-gray-600 flex flex-col items-center">
                                        <Film size={24} className="mb-2"/>
                                        <span className="text-xs">No Video</span>
                                    </div>
                                )}
                             </div>
                             <div className="p-4 flex-1 flex flex-col justify-between">
                                 <div>
                                     <div className="flex justify-between mb-2">
                                         <h4 className="font-bold text-gray-200 text-sm">Scene {scene.scene_number}</h4>
                                         <span className={`text-xs px-2 py-0.5 rounded ${
                                             scene.status === 'completed' ? 'bg-green-900 text-green-300' : 
                                             scene.status === 'generating' ? 'bg-indigo-900 text-indigo-300' :
                                             scene.status === 'error' ? 'bg-red-900 text-red-300' : 'bg-gray-700 text-gray-400'
                                         }`}>
                                             {scene.status.toUpperCase()}
                                         </span>
                                     </div>
                                     <p className="text-xs text-gray-400 line-clamp-2">{scene.description}</p>
                                 </div>

                                 {/* Controls Container */}
                                 <div className="mt-3 space-y-2">
                                     {/* Trim Controls */}
                                     {scene.status === 'completed' && (
                                         <div className="p-2 bg-gray-900 rounded border border-gray-700 flex items-center space-x-4">
                                            <div className="flex items-center text-xs text-gray-400">
                                                <Scissors size={12} className="mr-1" />
                                                <span>Trim Start:</span>
                                                <input 
                                                    type="number" 
                                                    min="0"
                                                    max={scene.duration_seconds}
                                                    step="0.5"
                                                    value={scene.trimStart || 0}
                                                    onChange={(e) => handleUpdateScene(scene.id, { trimStart: parseFloat(e.target.value) })}
                                                    className="ml-2 w-12 bg-gray-800 border border-gray-600 rounded px-1 text-white"
                                                />
                                                <span className="ml-1">s</span>
                                            </div>
                                            <div className="flex items-center text-xs text-gray-400">
                                                <Scissors size={12} className="mr-1 transform rotate-180" />
                                                <span>Trim End:</span>
                                                <input 
                                                    type="number" 
                                                    min="0"
                                                    max={scene.duration_seconds}
                                                    step="0.5"
                                                    value={scene.trimEnd || 0}
                                                    onChange={(e) => handleUpdateScene(scene.id, { trimEnd: parseFloat(e.target.value) })}
                                                    className="ml-2 w-12 bg-gray-800 border border-gray-600 rounded px-1 text-white"
                                                />
                                                <span className="ml-1">s</span>
                                            </div>
                                         </div>
                                     )}
                                     
                                     {/* Overlay Text & Transition Control Row */}
                                     <div className="flex space-x-2">
                                         {/* Overlay Text Control */}
                                         <div className="flex-1 p-2 bg-gray-900 rounded border border-gray-700 flex items-center space-x-2">
                                             <Type size={12} className="text-gray-400" />
                                             <input
                                                 type="text"
                                                 placeholder="Overlay Text / Caption..."
                                                 value={scene.overlayText || ""}
                                                 onChange={(e) => handleUpdateScene(scene.id, { overlayText: e.target.value })}
                                                 className="flex-1 bg-transparent border-none text-xs text-white focus:outline-none placeholder-gray-600"
                                             />
                                         </div>

                                          {/* Transition Controls */}
                                         <div className="p-2 bg-gray-900 rounded border border-gray-700 flex items-center space-x-2">
                                            <Sparkles size={12} className="text-indigo-400" />
                                            <select 
                                                value={scene.transition?.type || 'none'}
                                                onChange={(e) => handleUpdateScene(scene.id, { 
                                                    transition: { 
                                                        type: e.target.value as TransitionType, 
                                                        duration: scene.transition?.duration || 1.0 
                                                    } 
                                                })}
                                                className="bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 p-1 focus:border-indigo-500 outline-none"
                                            >
                                                <option value="none">No Trans.</option>
                                                <option value="fade">Fade</option>
                                                <option value="wipe_left">Wipe Left</option>
                                                <option value="wipe_right">Wipe Right</option>
                                                <option value="slide_left">Slide Left</option>
                                                <option value="slide_right">Slide Right</option>
                                            </select>
                                            {(scene.transition?.type && scene.transition.type !== 'none') && (
                                                <div className="flex items-center space-x-1">
                                                    <input 
                                                        type="number"
                                                        min="0.5" max="3" step="0.5"
                                                        value={scene.transition?.duration || 1.0}
                                                        onChange={(e) => handleUpdateScene(scene.id, { 
                                                            transition: { 
                                                                ...scene.transition!, 
                                                                duration: parseFloat(e.target.value) 
                                                            } 
                                                        })}
                                                        className="w-10 bg-gray-800 border border-gray-700 rounded text-xs text-white p-1 text-center"
                                                    />
                                                    <span className="text-[10px] text-gray-500">s</span>
                                                </div>
                                            )}
                                         </div>
                                     </div>
                                 </div>

                                 <div className="flex justify-end mt-2">
                                     <button 
                                        onClick={() => handleGenerateVideoForScene(scene.id)}
                                        disabled={scene.status === 'generating'}
                                        className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 text-white text-xs px-3 py-1.5 rounded flex items-center"
                                     >
                                         {scene.status === 'completed' ? <RefreshCw size={12} className="mr-1"/> : <Play size={12} className="mr-1"/>}
                                         {scene.status === 'completed' ? "Regenerate" : "Generate Video"}
                                     </button>
                                     {scene.status === 'completed' && scene.videoUrl && (
                                         <a 
                                            href={scene.videoUrl} 
                                            download={`scene_${scene.scene_number}.mp4`}
                                            className="ml-2 bg-gray-700 hover:bg-gray-600 text-white text-xs px-3 py-1.5 rounded flex items-center"
                                         >
                                             <Download size={12} className="mr-1"/> Save Clip
                                         </a>
                                     )}
                                 </div>
                             </div>
                        </div>
                    ))}
                </div>

                {/* Preview/Assembly Area */}
                <div className="flex flex-col space-y-6 h-fit">
                    {/* Soundtrack Section */}
                    <div className="bg-gray-800 rounded-xl border border-gray-700 p-4">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center">
                            <Music className="mr-2" size={18} />
                            Soundtrack
                        </h3>
                        
                        <div className="space-y-4">
                             {/* Selected Music Display */}
                             <div className="bg-gray-900 p-3 rounded-lg border border-gray-700 flex justify-between items-center">
                                 <div className="flex items-center">
                                     <div className={`w-8 h-8 rounded-full flex items-center justify-center mr-3 ${currentProject?.backgroundMusic ? 'bg-indigo-500 text-white' : 'bg-gray-700 text-gray-500'}`}>
                                         <Music size={14} />
                                     </div>
                                     <div className="overflow-hidden">
                                        <p className="text-sm font-bold text-white truncate w-32">
                                            {currentProject?.backgroundMusic ? currentProject.backgroundMusic.name : "No Music Selected"}
                                        </p>
                                        <p className="text-xs text-gray-500">{currentProject?.backgroundMusic ? "Ready to mix" : "Select a track below"}</p>
                                     </div>
                                 </div>
                                 {currentProject?.backgroundMusic && (
                                     <button onClick={handleRemoveMusic} className="text-red-400 hover:text-red-300 p-1">
                                         <Trash2 size={16} />
                                     </button>
                                 )}
                             </div>

                             {/* Volume Control */}
                             {currentProject?.backgroundMusic && (
                                 <div>
                                     <label className="text-xs text-gray-500 mb-1 flex items-center">
                                         <Volume2 size={12} className="mr-1"/> Mix Volume: {Math.round((currentProject.backgroundMusic.volume) * 100)}%
                                     </label>
                                     <input 
                                        type="range" min="0" max="1" step="0.1" 
                                        value={currentProject.backgroundMusic.volume}
                                        onChange={(e) => handleMusicVolumeChange(parseFloat(e.target.value))}
                                        className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                     />
                                 </div>
                             )}

                             {/* Add Music Controls */}
                             <div className="grid grid-cols-2 gap-2 mt-4">
                                <label className="cursor-pointer bg-gray-700 hover:bg-gray-600 text-gray-300 py-2 px-3 rounded text-xs flex items-center justify-center transition-colors">
                                    <Upload size={14} className="mr-1" /> Upload
                                    <input 
                                        ref={fileInputRef}
                                        type="file" 
                                        accept="audio/*" 
                                        className="hidden" 
                                        onChange={handleMusicUpload}
                                    />
                                </label>
                                <div className="col-span-2 text-xs text-gray-500 mt-2 font-bold uppercase">Presets</div>
                                {PRESET_MUSIC.map((track) => (
                                    <button 
                                        key={track.name}
                                        onClick={() => handleSelectPresetMusic(track)}
                                        className="bg-gray-900 border border-gray-700 hover:border-gray-500 text-gray-300 py-2 px-3 rounded text-xs text-center transition-colors"
                                    >
                                        {track.name}
                                    </button>
                                ))}
                             </div>
                        </div>
                    </div>

                    {/* Assembly Section */}
                    <div className="bg-gray-800 rounded-xl border border-gray-700 p-4 flex flex-col flex-1">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center">
                            <Layers className="mr-2" size={18} />
                            Assembly
                        </h3>
                        <div className="space-y-4">
                             {/* Project Info */}
                             <div className="bg-gray-900 p-3 rounded-lg flex items-center justify-between">
                                <div className="flex items-center space-x-2">
                                    {currentProject?.aspectRatio === '9:16' ? <Smartphone size={16} className="text-indigo-400"/> : <Monitor size={16} className="text-indigo-400"/>}
                                    <span className="text-xs text-gray-300 font-bold">{currentProject?.aspectRatio === '9:16' ? 'Portrait (9:16)' : 'Landscape (16:9)'}</span>
                                </div>
                             </div>

                            <div className="bg-gray-900 p-3 rounded-lg">
                                <span className="text-xs text-gray-500 uppercase block mb-1">Est. Total Duration</span>
                                <span className="text-xl font-mono text-indigo-400">
                                    {currentProject?.scenes.reduce((acc, s) => {
                                        // Calculate actual duration after trims
                                        const rawDur = s.duration_seconds || 8;
                                        const trimS = s.trimStart || 0;
                                        const trimE = s.trimEnd || 0;
                                        const transD = (s.transition?.type !== 'none' && s.transition?.duration) ? s.transition.duration : 0;
                                        const actual = Math.max(0, rawDur - trimS - trimE - (transD * 0.5)); 
                                        return acc + actual;
                                    }, 0).toFixed(1)}s
                                </span>
                            </div>
                            <div className="bg-gray-900 p-3 rounded-lg">
                                <span className="text-xs text-gray-500 uppercase block mb-1">Scenes Ready</span>
                                <span className="text-xl font-mono text-green-400">
                                    {readyVideosCount} / {totalVideos}
                                </span>
                            </div>

                             {/* Export Options */}
                            <div className="bg-gray-900 p-3 rounded-lg space-y-3">
                                <span className="text-xs text-gray-500 uppercase block mb-1 flex items-center"><Settings size={10} className="mr-1"/> Export Settings</span>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="text-[10px] text-gray-400 block mb-1">Resolution</label>
                                        <select 
                                            value={exportRes}
                                            onChange={(e) => setExportRes(e.target.value as ExportResolution)}
                                            className="w-full bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 p-1 focus:border-indigo-500 outline-none"
                                        >
                                            <option value="720p">720p (HD)</option>
                                            <option value="1080p">1080p (FHD)</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-gray-400 block mb-1">Format</label>
                                        <select 
                                            value={exportFmt}
                                            onChange={(e) => setExportFmt(e.target.value as ExportFormat)}
                                            className="w-full bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 p-1 focus:border-indigo-500 outline-none"
                                        >
                                            <option value="mp4">MP4</option>
                                            <option value="mov">MOV</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <div className="mt-8 mt-auto">
                            <button
                                onClick={handleStitchVideos}
                                disabled={!canStitch}
                                className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center shadow-lg transition-all
                                    ${canStitch 
                                        ? 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 text-white shadow-green-900/30' 
                                        : 'bg-gray-700 text-gray-500 cursor-not-allowed'}`}
                            >
                                <Film className="mr-2" />
                                {canStitch ? "Export Full Movie" : "Generate All First"}
                            </button>
                            {!canStitch && (
                                <p className="text-xs text-yellow-500 mt-2 text-center">
                                    * Generate all scenes to enable full movie export.
                                </p>
                            )}
                            <p className="text-xs text-gray-500 mt-4">
                            Use the "Trim" inputs on each scene to cut unwanted parts. 
                            "Export" stitches all clips into a single file with audio.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
  }

  // --- Render ---

  return (
    <div className="w-full h-screen bg-gray-900 text-gray-100 flex overflow-hidden">
      {/* Sidebar Navigation */}
      <div className="w-20 lg:w-64 bg-gray-950 border-r border-gray-800 flex flex-col flex-shrink-0 transition-all">
        <div className="p-6 border-b border-gray-800 flex items-center justify-center lg:justify-start">
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center font-bold text-white text-lg shadow-lg shadow-indigo-500/30">V</div>
            <span className="ml-3 font-bold text-xl hidden lg:block tracking-tight">Veo3<span className="text-indigo-400">Studio</span></span>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
           <button 
             onClick={() => setCurrentStep(AppStep.DASHBOARD)}
             className={`w-full flex items-center p-3 rounded-lg transition-colors ${currentStep === AppStep.DASHBOARD ? 'bg-gray-800 text-indigo-400' : 'text-gray-400 hover:text-white hover:bg-gray-900'}`}
           >
             <div className="w-6"><Film size={20} /></div>
             <span className="ml-3 hidden lg:block font-medium">Dashboard</span>
           </button>
           
           {/* If in a project, show stages */}
           {currentStep !== AppStep.DASHBOARD && (
             <div className="pt-6 mt-6 border-t border-gray-800">
               <p className="text-xs font-bold text-gray-600 uppercase mb-4 px-3 hidden lg:block">Current Project</p>
               {[
                 { step: AppStep.CREATE_IDEA, label: 'Idea', icon: <Plus size={20}/> },
                 { step: AppStep.CHARACTER_DESIGN, label: 'Character', icon: <ImageIcon size={20}/> },
                 { step: AppStep.SCRIPT_EDITOR, label: 'Script', icon: <Edit3 size={20}/> },
                 { step: AppStep.VIDEO_GENERATION, label: 'Production', icon: <Video size={20}/> },
               ].map((item) => (
                 <button
                    key={item.step}
                    onClick={() => setCurrentStep(item.step)}
                    disabled={!currentProject}
                    className={`w-full flex items-center p-3 rounded-lg transition-colors mb-1 
                        ${currentStep === item.step ? 'bg-indigo-900/30 text-indigo-400 border border-indigo-500/30' : 'text-gray-500 hover:text-gray-300'}`}
                 >
                    <div className="w-6">{item.icon}</div>
                    <span className="ml-3 hidden lg:block text-sm">{item.label}</span>
                 </button>
               ))}
             </div>
           )}
        </nav>

        <div className="p-4 border-t border-gray-800">
             <div className="flex items-center space-x-3 text-gray-500 text-sm">
                 <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center">U</div>
                 <span className="hidden lg:block">User</span>
             </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 bg-gray-900 relative">
        {loading && <LoadingOverlay message={loadingMsg} progress={progress} />}
        {renderSettingsModal()}
        {renderDebugConsole()}
        
        {/* Header */}
        <header className="h-16 bg-gray-900/50 backdrop-blur-md border-b border-gray-800 flex items-center justify-between px-8 sticky top-0 z-10">
           <div className="flex items-center space-x-4">
              {currentStep !== AppStep.DASHBOARD && (
                 <>
                    <h2 className="text-lg font-bold text-gray-200 hidden md:block">{currentProject?.name || "New Project"}</h2>
                    <div className="h-4 w-px bg-gray-700 hidden md:block"></div>
                 </>
              )}
              {currentStep !== AppStep.DASHBOARD && (
                  <div className="flex space-x-1 md:space-x-4">
                     <StepIndicator step={AppStep.CREATE_IDEA} currentStep={currentStep} />
                     <StepIndicator step={AppStep.CHARACTER_DESIGN} currentStep={currentStep} />
                     <StepIndicator step={AppStep.SCRIPT_EDITOR} currentStep={currentStep} />
                     <StepIndicator step={AppStep.VIDEO_GENERATION} currentStep={currentStep} />
                  </div>
              )}
           </div>
           
           <div className="flex items-center space-x-3">
             <button 
                onClick={() => setShowDebug(!showDebug)}
                className={`p-2 rounded-lg transition-colors border ${showDebug ? 'bg-indigo-900 text-indigo-400 border-indigo-500' : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'}`}
                title="Toggle Debug Console"
             >
                <Terminal size={18} />
             </button>

             <button 
                onClick={() => setShowSettings(true)}
                className="p-2 bg-gray-800 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700 transition-colors border border-gray-700"
                title="Settings"
             >
                <Settings size={18} />
             </button>

             <button 
               onClick={handleSaveProjects}
               disabled={saveState === 'saving'}
               className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-all border ${
                  saveState === 'saved' ? 'bg-green-500/20 text-green-400 border-green-500/50' : 
                  saveState === 'saving' ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/50' :
                  'bg-gray-800 hover:bg-gray-700 text-gray-300 border-gray-700'
               }`}
             >
               {saveState === 'saving' ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-400" />
               ) : saveState === 'saved' ? (
                  <Save size={16} className="text-green-400" />
               ) : (
                  <Save size={16} />
               )}
               <span>
                  {saveState === 'saving' ? 'Saving...' : 
                   saveState === 'saved' ? 'Saved!' : 'Save Project'}
               </span>
             </button>
           </div>
        </header>

        {/* Dynamic Body */}
        <main className="flex-1 overflow-auto">
           {currentStep === AppStep.DASHBOARD && renderDashboard()}
           {currentStep === AppStep.CREATE_IDEA && renderCreateIdea()}
           {currentStep === AppStep.CHARACTER_DESIGN && renderCharacterDesign()}
           {currentStep === AppStep.SCRIPT_EDITOR && renderScriptEditor()}
           {currentStep === AppStep.VIDEO_GENERATION && renderVideoGeneration()}
        </main>
      </div>
    </div>
  );
}
