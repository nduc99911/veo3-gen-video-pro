
import { Scene, BackgroundMusic, ExportResolution, ExportFormat, TransitionType, AspectRatio } from "../types";

// Helper to wait for video events
const waitForEvent = (element: HTMLMediaElement, event: string) => {
  return new Promise<void>((resolve) => {
    const handler = () => {
      element.removeEventListener(event, handler);
      resolve();
    };
    element.addEventListener(event, handler);
  });
};

// Helper to draw text with wrapping anchored at the bottom
const drawWrappedText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  fontSize: number
) => {
  const words = text.split(' ');
  let line = '';
  const lines: string[] = [];

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;
    if (testWidth > maxWidth && n > 0) {
      lines.push(line);
      line = words[n] + ' ';
    } else {
      line = testLine;
    }
  }
  lines.push(line);

  ctx.save();
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.fillStyle = 'white';
  ctx.strokeStyle = 'black';
  ctx.lineWidth = fontSize / 8;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 4;
  ctx.lineJoin = 'round';

  for (let k = lines.length - 1; k >= 0; k--) {
    const lineY = y - ((lines.length - 1 - k) * lineHeight);
    ctx.strokeText(lines[k], x, lineY);
    ctx.fillText(lines[k], x, lineY);
  }
  ctx.restore();
};

interface VideoSlot {
  video: HTMLVideoElement;
  sourceNode: MediaElementAudioSourceNode;
  gainNode: GainNode;
}

export const stitchVideos = async (
  scenes: Scene[],
  bgMusic: BackgroundMusic | undefined,
  resolution: ExportResolution,
  format: ExportFormat,
  aspectRatio: AspectRatio,
  onProgress: (progress: number, message: string) => void
): Promise<string> => {
  const validScenes = scenes.filter(s => s.status === 'completed' && s.videoUrl);
  
  if (validScenes.length === 0) {
    throw new Error("No completed videos to stitch.");
  }

  // 1. Setup Canvas based on Resolution AND Aspect Ratio
  let width, height;
  if (aspectRatio === '16:9') {
      width = resolution === '1080p' ? 1920 : 1280;
      height = resolution === '1080p' ? 1080 : 720;
  } else {
      // 9:16 Portrait
      width = resolution === '1080p' ? 1080 : 720;
      height = resolution === '1080p' ? 1920 : 1280;
  }
  
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Could not get canvas context");
  
  // 2. Setup Audio Context
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const dest = audioCtx.createMediaStreamDestination();
  
  // Create two video slots for transitions
  const createSlot = (): VideoSlot => {
    const v = document.createElement('video');
    v.crossOrigin = "anonymous";
    v.width = width;
    v.height = height;
    v.muted = false; // Source node handles audio
    v.volume = 1; 
    
    const src = audioCtx.createMediaElementSource(v);
    const gain = audioCtx.createGain();
    src.connect(gain);
    gain.connect(dest);
    return { video: v, sourceNode: src, gainNode: gain };
  };

  const slots = [createSlot(), createSlot()];

  // 3. Setup Background Music
  let bgMusicEl: HTMLAudioElement | null = null;
  
  if (bgMusic && bgMusic.url) {
    bgMusicEl = new Audio();
    bgMusicEl.crossOrigin = "anonymous";
    bgMusicEl.src = bgMusic.url;
    bgMusicEl.loop = true;
    bgMusicEl.volume = bgMusic.volume; 
    
    const bgSource = audioCtx.createMediaElementSource(bgMusicEl);
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = bgMusic.volume;
    
    bgSource.connect(gainNode);
    gainNode.connect(dest);
    
    // Preload music
    try {
        await new Promise((resolve) => {
            if (!bgMusicEl) return resolve(true);
            bgMusicEl.oncanplaythrough = () => resolve(true);
            bgMusicEl.onerror = () => resolve(true);
            setTimeout(() => resolve(true), 3000); 
        });
    } catch (e) {
        console.warn("Failed to load background music", e);
    }
  }

  // 4. Setup Recorder
  let mimeType = 'video/webm'; 
  if (format === 'mp4' || format === 'mov') {
      if (MediaRecorder.isTypeSupported('video/mp4')) {
          mimeType = 'video/mp4';
      } else if (MediaRecorder.isTypeSupported('video/webm;codecs=h264')) {
          mimeType = 'video/webm;codecs=h264';
      } else if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
          mimeType = 'video/webm;codecs=vp9';
      }
  }

  const canvasStream = canvas.captureStream(30);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...dest.stream.getAudioTracks()
  ]);

  const recorder = new MediaRecorder(combinedStream, {
    mimeType: mimeType,
    videoBitsPerSecond: resolution === '1080p' ? 8000000 : 5000000 
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  recorder.start();
  if (bgMusicEl) bgMusicEl.play().catch(e => console.warn("Could not play bg music", e));

  // 5. Playback Logic
  let activeSlotIndex = 0; // toggles 0 or 1
  let lastProgressUpdate = 0;

  try {
    // Load first scene
    const firstScene = validScenes[0];
    onProgress(0, `Preparing Scene 1...`);
    
    slots[activeSlotIndex].video.src = firstScene.videoUrl!;
    await waitForEvent(slots[activeSlotIndex].video, 'loadedmetadata');

    for (let i = 0; i < validScenes.length; i++) {
      const currentScene = validScenes[i];
      const currentSlot = slots[activeSlotIndex];
      const nextSceneIndex = i + 1;
      const hasNext = nextSceneIndex < validScenes.length;
      
      const nextSlot = slots[1 - activeSlotIndex]; // The other slot
      const nextScene = hasNext ? validScenes[nextSceneIndex] : null;

      // Determine transition
      const transition = nextScene?.transition;
      const transitionType = transition?.type || 'none';
      const transitionDuration = (transitionType !== 'none' && transition?.duration) ? transition.duration : 0;

      // Setup current video timing
      const start = currentScene.trimStart || 0;
      const endTrim = currentScene.trimEnd || 0;
      const duration = currentSlot.video.duration;
      const end = Math.min(duration, duration - endTrim);
      
      // Effective play duration
      // If there's a transition to the next scene, we stop playing this scene "solo" slightly earlier to blend
      // BUT simpler model: The transition duration "eats" into the end of current scene and start of next.
      // So we play current scene until (End - TransitionDuration). Then we play both.
      
      const playEndTime = end;
      // If we have a transition, the SOLO playback ends at (end - transitionDuration).
      // Then we enter transition phase loop.
      const soloEndTime = hasNext ? Math.max(start, end - transitionDuration) : end;

      // Seek if needed (if it's the first scene or we are just starting it)
      // Note: If we transitioned INTO this scene, it's already playing.
      // If i==0, we need to seek and play.
      if (i === 0) {
        currentSlot.video.currentTime = start;
        await waitForEvent(currentSlot.video, 'seeked');
        await currentSlot.video.play();
      }

      // Draw Main Body (Solo)
      await new Promise<void>((resolve) => {
        const drawSolo = () => {
           if (currentSlot.video.paused || currentSlot.video.ended || currentSlot.video.currentTime >= soloEndTime) {
             resolve();
             return;
           }

           // Draw Object-Fit logic (Cover)
           // If we have mismatched aspect ratios (e.g. 9:16 project but 16:9 source clip), we need to fill 'cover'
           // Calculate scaling
           const vW = currentSlot.video.videoWidth;
           const vH = currentSlot.video.videoHeight;
           const scale = Math.max(width / vW, height / vH);
           const dx = (width - vW * scale) / 2;
           const dy = (height - vH * scale) / 2;

           ctx.drawImage(currentSlot.video, dx, dy, vW * scale, vH * scale);
           
           // Overlay Text
           if (currentScene.overlayText) {
               const fontSize = resolution === '1080p' ? 48 : 32;
               drawWrappedText(ctx, currentScene.overlayText, width/2, height * 0.9, width * 0.8, fontSize * 1.2, fontSize);
           }

           // Update Progress
           const now = Date.now();
           if (now - lastProgressUpdate > 100) {
             const progress = (i / validScenes.length) * 100;
             onProgress(progress, `Processing Scene ${currentScene.scene_number}...`);
             lastProgressUpdate = now;
           }

           requestAnimationFrame(drawSolo);
        };
        drawSolo();
      });

      // Handle Transition to Next
      if (hasNext && nextScene) {
         // Pause Recorder while loading next video to avoid "dead air" or stutter
         recorder.pause();
         
         // Load next
         onProgress((i + 0.9) / validScenes.length * 100, `Preparing transition to Scene ${nextScene.scene_number}...`);
         nextSlot.video.src = nextScene.videoUrl!;
         await waitForEvent(nextSlot.video, 'loadedmetadata');
         
         const nextStart = nextScene.trimStart || 0;
         nextSlot.video.currentTime = nextStart;
         await waitForEvent(nextSlot.video, 'seeked');
         
         // Start playing both (Current finishes its last segment, Next starts its first)
         // Note: Current is already playing (or paused if we paused renderer logic, but element is valid)
         // We need to ensure current is playing if we rely on it.
         // Actually currentSlot.video might have passed `soloEndTime`.
         
         await nextSlot.video.play();
         // Ensure current is playing
         if (currentSlot.video.paused) await currentSlot.video.play();

         recorder.resume();

         // Render Transition Loop
         await new Promise<void>((resolve) => {
            const drawTrans = () => {
                // Determine normalized time in transition (0 to 1)
                // Use nextSlot's time as reference: from nextStart to nextStart + transitionDuration
                const tCurrent = nextSlot.video.currentTime - nextStart;
                const t = Math.min(1, Math.max(0, tCurrent / (transitionDuration || 0.001))); // avoid div0

                if (t >= 1) {
                    resolve();
                    return;
                }

                // Draw based on type
                // 1. Draw Background (Current Scene)
                // Fade out audio of current, Fade in audio of next
                currentSlot.gainNode.gain.value = 1 - t;
                nextSlot.gainNode.gain.value = t;

                // Scaling helper
                const drawScaled = (slot: VideoSlot, alpha: number = 1, xOffset: number = 0) => {
                    const vW = slot.video.videoWidth;
                    const vH = slot.video.videoHeight;
                    const scale = Math.max(width / vW, height / vH);
                    const dx = (width - vW * scale) / 2 + xOffset;
                    const dy = (height - vH * scale) / 2;
                    
                    ctx.globalAlpha = alpha;
                    ctx.drawImage(slot.video, dx, dy, vW * scale, vH * scale);
                    ctx.globalAlpha = 1;
                };

                // Visual Effects
                if (transitionType === 'fade') {
                    drawScaled(currentSlot, 1);
                    drawScaled(nextSlot, t);
                } 
                else if (transitionType === 'wipe_left') {
                    // Current full
                    drawScaled(currentSlot);
                    // Next clipped (revealing from right to left)
                    ctx.save();
                    ctx.beginPath();
                    const revealX = width * (1 - t);
                    ctx.rect(revealX, 0, width, height);
                    ctx.clip();
                    drawScaled(nextSlot);
                    ctx.restore();
                }
                else if (transitionType === 'wipe_right') {
                    drawScaled(currentSlot);
                    ctx.save();
                    ctx.beginPath();
                    const revealW = width * t;
                    ctx.rect(0, 0, revealW, height);
                    ctx.clip();
                    drawScaled(nextSlot);
                    ctx.restore();
                }
                else if (transitionType === 'slide_left') {
                    drawScaled(currentSlot, 1, -width * t);
                    drawScaled(nextSlot, 1, width * (1 - t));
                }
                else if (transitionType === 'slide_right') {
                    drawScaled(currentSlot, 1, width * t);
                    drawScaled(nextSlot, 1, -width * (1 - t));
                }
                else {
                    drawScaled(nextSlot);
                }

                requestAnimationFrame(drawTrans);
            };
            drawTrans();
         });

         // Transition Done
         // Stop current
         currentSlot.video.pause();
         // Reset gain for next usage
         currentSlot.gainNode.gain.value = 1;
         nextSlot.gainNode.gain.value = 1; // Ensure next is fully audible

         // Swap active slot
         activeSlotIndex = 1 - activeSlotIndex;
      } else {
         // No next scene, just ensure we stopped at end
         currentSlot.video.pause();
      }
    }

    onProgress(100, "Finalizing...");
    recorder.stop();
    if (bgMusicEl) bgMusicEl.pause();

    return new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        resolve(url);
      };
    });

  } catch (error) {
    console.error(error);
    throw new Error("Stitching failed.");
  } finally {
    audioCtx.close();
    slots.forEach(s => {
        s.video.remove();
        s.sourceNode.disconnect();
        s.gainNode.disconnect();
    });
    canvas.remove();
    if (bgMusicEl) bgMusicEl.remove();
  }
};
