// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * 5-Stage Shot Calibration Module
 *
 * Split 30+ fields into 5 independent AI calls to avoid reasoning model token exhaustion
 *
 * Stage 1: Narrative Skeleton (9 fields) — Shot size/movement/duration + narrative analysis
 * Stage 2: Visual Description (6 fields) — English descriptions + characters + audio
 * Stage 3: Shooting Control (15 fields) — Lighting/DOF/equipment/angle/focal length, etc.
 * Stage 4: First Frame Prompts (3 fields) — imagePrompt + needsEndFrame
 * Stage 5: Motion + End Frame Prompts (4 fields) — videoPrompt + endFramePrompt
 */

import { processBatched } from '@/lib/ai/batch-processor';
import { getStyleDescription, getMediaType } from '@/lib/constants/visual-styles';
import { buildCinematographyGuidance } from '@/lib/constants/cinematography-profiles';
import { getMediaTypeGuidance } from '@/lib/generation/media-type-tokens';

export interface ShotInputData {
  shotId: string;
  sourceText: string;
  actionSummary: string;
  dialogue?: string;
  characterNames?: string[];
  sceneLocation: string;
  sceneAtmosphere: string;
  sceneTime: string;
  sceneWeather?: string;
  architectureStyle?: string;
  colorPalette?: string;
  eraDetails?: string;
  lightingDesign?: string;
  currentShotSize?: string;
  currentCameraMovement?: string;
  currentDuration?: number;
}

export interface GlobalContext {
  title: string;
  genre?: string;
  era?: string;
  outline: string;
  characterBios: string;
  worldSetting?: string;
  themes?: string[];
  episodeTitle: string;
  episodeSynopsis?: string;
  episodeKeyEvents?: string[];
  episodeRawContent?: string;
  episodeSeason?: string;
  totalEpisodes?: number;
  currentEpisode?: number;
}

export interface CalibrationOptions {
  styleId?: string;
  cinematographyProfileId?: string;
}

/**
 * 5-stage shot calibration main function
 */
export async function calibrateShotsMultiStage(
  shots: ShotInputData[],
  options: CalibrationOptions,
  globalContext: GlobalContext,
  onStageProgress?: (stage: number, totalStages: number, stageName: string) => void
): Promise<Record<string, Record<string, unknown>>> {
  const { styleId, cinematographyProfileId } = options;
  const {
    title, genre, era, episodeTitle, episodeSynopsis, episodeKeyEvents,
    totalEpisodes, currentEpisode, episodeSeason
  } = globalContext;

  const styleDesc = getStyleDescription(styleId || 'cinematic');
  const cinematographyGuidance = cinematographyProfileId
    ? buildCinematographyGuidance(cinematographyProfileId)
    : '';
  const contextLine = [
    `"${title}"`, genre || '', era || '',
    totalEpisodes ? `${totalEpisodes} Episodes Total` : '',
    `Episode ${currentEpisode} "${episodeTitle}"`,
    episodeSeason || '',
  ].filter(Boolean).join(' | ');

  // Media type constraints (appended when non-cinematic style)
  const mt = getMediaType(styleId || 'cinematic');
  const mediaTypeHint = mt !== 'cinematic' ? `\n【Media Type】${getMediaTypeGuidance(mt)}` : '';

  // JSON parsing helper
  function parseStageJSON(raw: string): Record<string, Record<string, unknown>> {
    let cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
    }
    const parsed = JSON.parse(cleaned);
    return parsed.shots || parsed || {};
  }

  // Generic Stage executor: uses processBatched for automatic batching (auto-split sub-batch when 30+ shots)
  async function runStage(
    stageName: string,
    buildPrompts: (batch: ShotInputData[]) => { system: string; user: string },
    outputTokensPerItem: number,
    maxTokens: number,
  ): Promise<void> {
    console.log(`[MultiStage] ${stageName}`);
    const { results, failedBatches } = await processBatched<ShotInputData, Record<string, unknown>>( {
      items: shots,
      feature: 'script_analysis',
      buildPrompts,
      parseResult: (raw, batch) => {
        const shotsResult = parseStageJSON(raw);
        const result = new Map<string, Record<string, unknown>>();
        for (const item of batch) {
          if (shotsResult[item.shotId]) {
            result.set(item.shotId, shotsResult[item.shotId]);
          }
        }
        return result;
      },
      estimateItemOutputTokens: () => outputTokensPerItem,
      apiOptions: { maxTokens },
    });

    for (const shot of shots) {
      const stageResult = results.get(shot.shotId);
      if (stageResult) {
        Object.assign(merged[shot.shotId], stageResult);
      }
    }
    if (failedBatches > 0) {
      console.warn(`[MultiStage] ${stageName}: ${failedBatches} batches failed`);
    }
  }

  // Initialize merged results
  const merged: Record<string, Record<string, unknown>> = {};
  for (const shot of shots) {
    merged[shot.shotId] = {};
  }

  // ===================== Stage 1: Narrative Skeleton =====================
  onStageProgress?.(1, 5, 'Narrative Skeleton');
  console.log('[MultiStage] Stage 1/5: Narrative Skeleton');

  const s1System = `You are a film narrative analyst, proficient in cinematic language and narrative structure. Analyze each shot's narrative function and determine shot parameters.

${contextLine}${episodeSynopsis ? `\nEpisode synopsis: ${episodeSynopsis}` : ''}${episodeKeyEvents?.length ? `\nKey events: ${episodeKeyEvents.join(', ')}` : ''}

For each shot output JSON:
- shotSize: ECU/CU/MCU/MS/MLS/LS/WS/FS
- cameraMovement: none/static/tracking/orbit/zoom-in/zoom-out/pan-left/pan-right/tilt-up/tilt-down/dolly-in/dolly-out/truck-left/truck-right/crane-up/crane-down/drone-aerial/360-roll
- specialTechnique: none/hitchcock-zoom/timelapse/crash-zoom-in/crash-zoom-out/whip-pan/bullet-time/fpv-shuttle/macro-closeup/first-person/slow-motion/probe-lens/spinning-tilt
- duration: Seconds (integer), pure action 3-5s/brief dialogue 4-6s/long dialogue 6-10s/complex action 5-8s
- narrativeFunction: setup/rise/climax/turning-point/transition/resolution
- shotPurpose: One-sentence description
- visualFocus: Visual focus sequence (use → to indicate)
- cameraPosition: Camera position description
- characterBlocking: Character blocking
- rhythm: Rhythm feel

Format: {"shots":{"shot_id":{...}}}`;

  try {
    await runStage('Stage 1/5: Narrative Skeleton', (batch) => {
      const userShots = batch.map(s => {
        const chars = s.characterNames?.join(', ') || 'None';
        return `ID: ${s.shotId}\nScene: ${s.sceneLocation} | Time: ${s.sceneTime}${s.sceneWeather ? ` | Weather: ${s.sceneWeather}` : ''}\nOriginal: ${s.sourceText || s.actionSummary}${s.dialogue ? `\nDialogue: "${s.dialogue}"` : ''}\nCharacters: ${chars} | Atmosphere: ${s.sceneAtmosphere}\nCurrent: ShotSize=${s.currentShotSize || '?'} Movement=${s.currentCameraMovement || '?'}`;
      }).join('\n\n---\n\n');
      return { system: s1System, user: `Analyze the following shots:\n\n${userShots}` };
    }, 200, 4096);
  } catch (e) {
    console.error('[MultiStage] Stage 1 failed:', e);
  }

  // ===================== Stage 2: Visual Description + Audio =====================
  onStageProgress?.(2, 5, 'Visual Description');
  console.log('[MultiStage] Stage 2/5: Visual Description');

  const s2System = `You are a film visual description artist. Based on original script text and narrative analysis, generate visual descriptions and audio design.

Rules:
- Scene attribution is absolutely fixed: main scenes cannot be changed, use "superimposed image" description for flashbacks
- Character list must be complete from original text, no additions or deletions
- visualDescription: Detailed visual description
- visualPrompt: English, within 40 words, for AI drawing
- emotionTags options: happy/sad/angry/surprised/fearful/calm/tense/excited/mysterious/romantic/funny/touching/serious/relaxed/playful/gentle/passionate/low
- ambientSound/soundEffect: Sound descriptions

Format: {"shots":{"shot_id":{"visualDescription":"","visualPrompt":"","characterNames":[],"emotionTags":[],"ambientSound":"","soundEffect":""}}}`;

  try {
    await runStage('Stage 2/5: Visual Description', (batch) => {
      const userShots = batch.map(s => {
        const prev = merged[s.shotId] || {};
        const hasFlashback = /flashback|superimpose|memory|intercut/i.test(s.sourceText || '');
        return `ID: ${s.shotId}\n[Main Scene (Unchangeable)]: ${s.sceneLocation}${hasFlashback ? ' ⚠️Contains flashback, main scene unchanged!' : ''}\nOriginal: ${s.sourceText || s.actionSummary}${s.dialogue ? `\nDialogue: "${s.dialogue}"` : ''}\nCharacters: ${s.characterNames?.join(', ') || 'None'}\nNarrative: ShotSize=${prev.shotSize || '?'} | Function=${prev.narrativeFunction || '?'} | Purpose=${prev.shotPurpose || '?'}\nFocus: ${prev.visualFocus || '?'} | Blocking: ${prev.characterBlocking || '?'}`;
      }).join('\n\n---\n\n');
      return { system: s2System, user: `Please generate visual descriptions:\n\n${userShots}` };
    }, 200, 4096);
  } catch (e) {
    console.error('[MultiStage] Stage 2 failed:', e);
  }

  // ===================== Stage 3: Shooting Control =====================
  onStageProgress?.(3, 5, 'Shooting Control');
  console.log('[MultiStage] Stage 3/5: Shooting Control');

  const s3System = `You are a film cinematographer (DP). Determine professional shooting parameters based on visual descriptions.${cinematographyGuidance ? `\n\n${cinematographyGuidance}` : ''}

For each shot output:
- lightingStyle: natural/high-key/low-key/silhouette/chiaroscuro/neon
- lightingDirection: front/side/back/top/bottom/rim
- colorTemperature: warm-3200K/neutral-5600K/cool-7500K/mixed/golden-hour/blue-hour
- lightingNotes: Lighting details
- depthOfField: shallow/medium/deep/split-diopter
- focusTarget: Focus subject
- focusTransition: none/rack-focus/pull-focus/follow-focus
- cameraRig: tripod/handheld/steadicam/dolly/crane/drone/gimbal/shoulder
- movementSpeed: static/slow/normal/fast/whip
- atmosphericEffects: Array, e.g., ["fog"]
- effectIntensity: subtle/moderate/heavy
- playbackSpeed: slow-0.25x/slow-0.5x/normal/fast-1.5x/fast-2x/timelapse
- cameraAngle: eye-level/low-angle/high-angle/birds-eye/worms-eye/dutch-angle/over-shoulder/pov/aerial
- focalLength: 14mm/18mm/24mm/28mm/35mm/50mm/85mm/100mm-macro/135mm/200mm
- photographyTechnique: long-exposure/double-exposure/high-speed/timelapse-photo/tilt-shift/silhouette/reflection/bokeh (can be empty)

Format: {"shots":{"shot_id":{...}}}`;

  try {
    await runStage('Stage 3/5: Shooting Control', (batch) => {
      const userShots = batch.map(s => {
        const prev = merged[s.shotId] || {};
        const artParts = [
          s.architectureStyle ? `Architecture:${s.architectureStyle}` : '',
          s.colorPalette ? `Color:${s.colorPalette}` : '',
          s.eraDetails ? `Era:${s.eraDetails}` : '',
          s.lightingDesign ? `Lighting:${s.lightingDesign}` : '',
        ].filter(Boolean);
        return `ID: ${s.shotId}\nScene: ${s.sceneLocation} | Time: ${s.sceneTime}${s.sceneWeather ? ` | Weather:${s.sceneWeather}` : ''}\nShot Size: ${prev.shotSize || '?'} | Movement: ${prev.cameraMovement || '?'} | Rhythm: ${prev.rhythm || '?'}\nVisual Description: ${prev.visualDescription || '?'}${artParts.length ? `\nScene Art: ${artParts.join(' | ')}` : ''}`;
      }).join('\n\n---\n\n');
      return { system: s3System, user: `Please determine shooting parameters:\n\n${userShots}` };
    }, 200, 4096);
  } catch (e) {
    console.error('[MultiStage] Stage 3 failed:', e);
  }

  // ===================== Stage 4: First Frame Prompts =====================
  onStageProgress?.(4, 5, 'First Frame Prompts');
  console.log('[MultiStage] Stage 4/5: First Frame Prompts');

  const s4System = `You are an AI image generation expert. Generate first frame prompts based on visual descriptions and shooting parameters.

${styleDesc}${mediaTypeHint}

imagePrompt (English, 60-80 words) and imagePromptZh (Chinese, 60-100 characters) must contain:
a) Scene environment (location + environmental details + time atmosphere)
b) Lighting design (light source + texture + atmosphere)
c) Character description (age + clothing + expression + pose, write every character)
d) Composition and shot size (shot size + character position relationship + focus)
e) Important props (key props + status)
f) Visual style (cinematic feel/color tone)

Note: imagePrompt must be 100% English, no Chinese characters allowed
Note: imagePromptZh must be Chinese

needsEndFrame judgment:
- true: Character position change/action sequence/object state change/camera movement (non-Static)
- false: Pure dialogue + no position change/only micro-expressions
- Set true when uncertain

Format: {"shots":{"shot_id":{"imagePrompt":"","imagePromptZh":"","needsEndFrame":true}}}`;

  try {
    await runStage('Stage 4/5: First Frame Prompts', (batch) => {
      const userShots = batch.map(s => {
        const prev = merged[s.shotId] || {};
        return `ID: ${s.shotId}\nShot Size: ${prev.shotSize || '?'} | Angle: ${prev.cameraAngle || '?'} | Focal Length: ${prev.focalLength || '?'}\nMovement: ${prev.cameraMovement || '?'}\nVisual Description: ${prev.visualDescription || '?'}\nCharacters: ${(Array.isArray(prev.characterNames) ? prev.characterNames : s.characterNames || []).join(', ')}\nLighting: ${prev.lightingStyle || '?'}, ${prev.lightingDirection || '?'}, ${prev.colorTemperature || '?'}\nDOF: ${prev.depthOfField || '?'} | Focus: ${prev.focusTarget || '?'}\nAtmosphere: ${(Array.isArray(prev.atmosphericEffects) ? prev.atmosphericEffects : []).join(',')}${prev.lightingNotes ? `\nLighting Notes: ${prev.lightingNotes}` : ''}`;
      }).join('\n\n---\n\n');
      return { system: s4System, user: `Please generate first frame prompts:\n\n${userShots}` };
    }, 400, 8192);
  } catch (e) {
    console.error('[MultiStage] Stage 4 failed:', e);
  }

  // ===================== Stage 5: Motion + End Frame Prompts =====================
  onStageProgress?.(5, 5, 'Motion+End Frame Prompts');
  console.log('[MultiStage] Stage 5/5: Motion+End Frame Prompts');

  const s5System = `You are an AI video generation expert. Based on first frame images, generate video motion descriptions and end frame images.

videoPrompt (English) / videoPromptZh (Chinese):
- Describe dynamic motions in video (character movements, object movements, camera movements)
- Emphasize verbs, describe motion process

endFramePrompt (English, 60-80 words) / endFramePromptZh (Chinese, 60-100 characters):
Only generate when needsEndFrame=true, otherwise set to empty string.
- Describe final image after motion completion
- Include same scene environment and lighting as first frame
- Focus on differences from first frame (new position/new pose/new expression/new prop state)
- Maintain same visual style as first frame

Note: English fields 100% English, Chinese fields Chinese

Format: {"shots":{"shot_id":{"videoPrompt":"","videoPromptZh":"","endFramePrompt":"","endFramePromptZh":""}}}`;

  try {
    await runStage('Stage 5/5: Motion+End Frame', (batch) => {
      const userShots = batch.map(s => {
        const prev = merged[s.shotId] || {};
        return `ID: ${s.shotId}\nDuration: ${prev.duration || '?'}s | Movement: ${prev.cameraMovement || '?'}\nneedsEndFrame: ${prev.needsEndFrame ?? true}\nAction: ${s.actionSummary || '?'}${s.dialogue ? `\nDialogue: "${s.dialogue}"` : ''}\nFirst Frame(EN): ${prev.imagePrompt || '?'}\nFirst Frame(ZH): ${prev.imagePromptZh || '?'}`;
      }).join('\n\n---\n\n');
      return { system: s5System, user: `Please generate video and end frame prompts:\n\n${userShots}` };
    }, 400, 8192);
  } catch (e) {
    console.error('[MultiStage] Stage 5 failed:', e);
  }

  console.log('[MultiStage] All 5 stages completed, calibrated fields:', Object.keys(merged[shots[0]?.shotId] || {}).length);
  return merged;
}
