// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Trailer Service - AI Trailer Shot Selection Service
 *
 * Features: Intelligently select key shots from existing shots to generate trailers
 * Selection criteria:
 * - Prioritize shots with narrative function "climax/turning point"
 * - Prioritize shots with strong emotional tags
 * - Prioritize scenes with visual impact
 * - Prioritize key character appearances
 */

import type { Shot, ProjectBackground } from '@/types/script';
import type { SplitScene, TrailerDuration } from '@/stores/director-store';
import type { EmotionTag, ShotSizeType } from '@/stores/director-presets';
import { callFeatureAPI } from '@/lib/ai/feature-router';
import { t } from '@/i18n';
import { getPromptLanguageSuffix } from './prompt-language';

// Shot count corresponding to duration
const DURATION_TO_SHOT_COUNT: Record<TrailerDuration, number> = {
  10: 2,   // 10 seconds: 2-3 shots
  30: 6,   // 30 seconds: 5-6 shots
  60: 12,  // 1 minute: 10-12 shots
};

/** @deprecated No longer needed manually, automatically obtained from service mapping */
export interface TrailerGenerationOptions {
  apiKey?: string;
  provider?: string;
  baseUrl?: string;
}

export interface TrailerGenerationResult {
  success: boolean;
  selectedShots: Shot[];
  shotIds: string[];
  error?: string;
}

/**
 * AI select trailer shots
 *
 * @param shots All available shots
 * @param background Project background information
 * @param duration Trailer duration
 */
export async function selectTrailerShots(
  shots: Shot[],
  background: ProjectBackground | null,
  duration: TrailerDuration,
): Promise<TrailerGenerationResult> {
  if (shots.length === 0) {
    return {
      success: false,
      selectedShots: [],
      shotIds: [],
      error: t('lib.error.noAvailableShots'),
    };
  }

  const targetCount = DURATION_TO_SHOT_COUNT[duration];

  // If the number of shots is less than the target count, return all shots directly
  if (shots.length <= targetCount) {
    return {
      success: true,
      selectedShots: shots,
      shotIds: shots.map(s => s.id),
    };
  }

  try {
    // Build shot summaries for AI analysis
    const shotSummaries = shots.map((shot, index) => ({
      index: index + 1,
      id: shot.id,
      episodeId: shot.episodeId,
      actionSummary: shot.actionSummary || '',
      visualDescription: shot.visualDescription || '',
      dialogue: shot.dialogue || '',
      characterNames: shot.characterNames || [],
      narrativeFunction: shot.narrativeFunction || '',
      emotionTags: shot.emotionTags || [],
      shotSize: shot.shotSize || '',
    }));

    const systemPrompt = `You are a professional film trailer editor, skilled at selecting the most attractive shots from large amounts of footage to create trailers.

Your task is to select the ${targetCount} most trailer-suitable shots from the given shot list.

[Trailer Structure Principles]
1. **Opening**: Establish atmosphere, attract attention (1-2 shots)
2. **Conflict Escalation**: Show core conflicts of the story (2-4 shots)
3. **Climax Suspense**: Most tense visuals, leave suspense (1-2 shots)

[Selection Criteria]
- Prioritize shots with narrative function "climax", "turn", "conflict"
- Prioritize shots with strong emotions (tense, excited, mysterious)
- Prioritize visually striking images (action scenes, close-ups, confrontations)
- Prioritize key moments with main characters
- Cover different episodes to show story span
- Avoid spoiling key endings

[Output Requirements]
Please return a JSON array containing the shot indices (index) you selected, arranged in trailer playback order.
Format: { "selectedIndices": [1, 5, 12, 23, 45, 60] }` + getPromptLanguageSuffix();

    const userPrompt = `[Project Information]
${background?.title ? `Title: "${background.title}"` : ''}
${background?.outline ? `Outline: ${background.outline.slice(0, 500)}` : ''}

[Shot List] (Total: ${shots.length} shots)
${shotSummaries.map(s =>
  `[${s.index}] ${s.id}
   Action: ${s.actionSummary.slice(0, 100)}
   Description: ${s.visualDescription.slice(0, 100)}
   Characters: ${s.characterNames.join(', ') || 'None'}
   Narrative function: ${s.narrativeFunction || 'Unknown'}
   Emotions: ${Array.isArray(s.emotionTags) ? s.emotionTags.join(', ') : 'None'}`
).join('\n\n')}

Please select ${targetCount} most trailer-suitable shots from the above shots, return JSON format index list.`;

    // Get configuration from service mapping uniformly
    const result = await callFeatureAPI('script_analysis', systemPrompt, userPrompt);

    // Parse AI returned JSON - support multiple formats
    let selectedIndices: number[] = [];
    
    console.log('[TrailerService] AI raw response (first 1000 chars):', result.slice(0, 1000));
    
    // Try to match { "selectedIndices": [...] } format
    const jsonMatch = result.match(/\{[\s\S]*?"selectedIndices"\s*:\s*\[[\d,\s]*\][\s\S]*?\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        selectedIndices = parsed.selectedIndices || [];
      } catch (e) {
        console.warn('[TrailerService] Failed to parse JSON match:', e);
      }
    }

    // If above fails, try to directly match number array [1, 2, 3, ...]
    if (selectedIndices.length === 0) {
      const arrayMatch = result.match(/\[\s*\d+(?:\s*,\s*\d+)*\s*\]/);
      if (arrayMatch) {
        try {
          selectedIndices = JSON.parse(arrayMatch[0]);
        } catch (e) {
          console.warn('[TrailerService] Failed to parse array match:', e);
        }
      }
    }

    // If still fails, try to extract all numbers
    if (selectedIndices.length === 0) {
      const numbers = result.match(/\b(\d{1,3})\b/g);
      if (numbers) {
        selectedIndices = numbers
          .map(n => parseInt(n, 10))
          .filter(n => n >= 1 && n <= shots.length)
          .slice(0, targetCount);
      }
    }

    if (selectedIndices.length === 0) {
      console.warn('[TrailerService] AI returned format error, cannot parse indices, using rule-based selection');
      const fallbackShots = selectTrailerShotsByRules(shots, targetCount);
      return {
        success: true,
        selectedShots: fallbackShots,
        shotIds: fallbackShots.map(s => s.id),
        error: t('lib.error.aiSelectionFailedUsingRules'),
      };
    }

    console.log('[TrailerService] Parsed selectedIndices:', selectedIndices);

    // Get the corresponding shots based on indices
    const selectedShots = selectedIndices
      .filter(idx => idx >= 1 && idx <= shots.length)
      .map(idx => shots[idx - 1]);

    return {
      success: true,
      selectedShots,
      shotIds: selectedShots.map(s => s.id),
    };
  } catch (error) {
    console.error('[TrailerService] AI selection failed:', error);
    return {
      success: false,
      selectedShots: [],
      shotIds: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Rule-based selection (fallback when AI fails)
 */
function selectTrailerShotsByRules(shots: Shot[], targetCount: number): Shot[] {
  // Scoring function
  const scoreShot = (shot: Shot): number => {
    let score = 0;

    // Narrative function scoring - English keywords
    const narrativeFunction = shot.narrativeFunction || '';
    if (narrativeFunction.includes('climax')) score += 10;
    if (narrativeFunction.includes('turn')) score += 8;
    if (narrativeFunction.includes('conflict')) score += 6;
    if (narrativeFunction.includes('rise')) score += 4;

    // Emotion scoring
    const emotionTags = shot.emotionTags || [];
    if (emotionTags.includes('tense')) score += 5;
    if (emotionTags.includes('excited')) score += 5;
    if (emotionTags.includes('mysterious')) score += 4;
    if (emotionTags.includes('touching')) score += 3;

    // Shots with dialogue are more attractive
    if (shot.dialogue) score += 2;

    // Shots with multiple characters are more dramatic
    if (shot.characterNames && shot.characterNames.length >= 2) score += 2;

    return score;
  };

  // Sort by score
  const scoredShots = shots.map(shot => ({
    shot,
    score: scoreShot(shot),
  })).sort((a, b) => b.score - a.score);

  // Select evenly from different episodes
  const episodeIds = shots.map(s => s.episodeId).filter((id): id is string => !!id);
  const episodeSet = new Set(episodeIds);
  const episodeCount = episodeSet.size;

  if (episodeCount > 1) {
    // Multiple episodes: select a portion from each episode
    const perEpisode = Math.ceil(targetCount / episodeCount);
    const selected: Shot[] = [];
    const episodeSelected = new Map<string, number>();

    for (const { shot } of scoredShots) {
      const epId = shot.episodeId || 'default';
      const count = episodeSelected.get(epId) || 0;

      if (count < perEpisode && selected.length < targetCount) {
        selected.push(shot);
        episodeSelected.set(epId, count + 1);
      }
    }

    // Sort by original order (trailer follows timeline)
    return selected.sort((a, b) => {
      const idxA = shots.findIndex(s => s.id === a.id);
      const idxB = shots.findIndex(s => s.id === b.id);
      return idxA - idxB;
    });
  } else {
    // Single episode: take the highest scored shots directly
    return scoredShots.slice(0, targetCount).map(s => s.shot);
  }
}

/**
 * Convert selected Shot to SplitScene format (for AI Director shot editing)
 */
export function convertShotsToSplitScenes(
  shots: Shot[],
  sceneName?: string
): SplitScene[] {
  return shots.map((shot, index) => ({
    id: index,
    sceneName: sceneName || `Trailer #${index + 1}`,
    sceneLocation: '',
    imageDataUrl: '',
    imageHttpUrl: null,
    width: 0,
    height: 0,
    imagePrompt: shot.imagePrompt || shot.visualPrompt || '',
    imagePromptZh: shot.imagePromptZh || shot.visualDescription || '',
    videoPrompt: shot.videoPrompt || '',
    videoPromptZh: shot.videoPromptZh || '',
    endFramePrompt: shot.endFramePrompt || '',
    endFramePromptZh: shot.endFramePromptZh || '',
    needsEndFrame: shot.needsEndFrame || false,
    row: 0,
    col: index,
    sourceRect: { x: 0, y: 0, width: 0, height: 0 },
    endFrameImageUrl: null,
    endFrameHttpUrl: null,
    endFrameSource: null,
    characterIds: [],
    emotionTags: (shot.emotionTags || []) as EmotionTag[],
    shotSize: (shot.shotSize || null) as ShotSizeType | null,
    // Seedance 1.5 Pro requires 4-12 seconds, force limit range
    duration: Math.max(4, Math.min(12, shot.duration || 5)),
    ambientSound: shot.ambientSound || '',
    soundEffects: [],
    soundEffectText: shot.soundEffect || '',
    dialogue: shot.dialogue || '',
    actionSummary: shot.actionSummary || '',
    cameraMovement: shot.cameraMovement || '',
    // Narrative-driven fields
    narrativeFunction: shot.narrativeFunction || '',
    shotPurpose: shot.shotPurpose || '',
    visualFocus: shot.visualFocus || '',
    cameraPosition: shot.cameraPosition || '',
    characterBlocking: shot.characterBlocking || '',
    rhythm: shot.rhythm || '',
    visualDescription: shot.visualDescription || '',
    // Lighting Director
    lightingStyle: shot.lightingStyle,
    lightingDirection: shot.lightingDirection,
    colorTemperature: shot.colorTemperature,
    lightingNotes: shot.lightingNotes,
    // Focus Puller
    depthOfField: shot.depthOfField,
    focusTarget: shot.focusTarget,
    focusTransition: shot.focusTransition,
    // Equipment Crew
    cameraRig: shot.cameraRig,
    movementSpeed: shot.movementSpeed,
    // Special Effects Artist
    atmosphericEffects: shot.atmosphericEffects,
    effectIntensity: shot.effectIntensity,
    // Speed Control
    playbackSpeed: shot.playbackSpeed,
    // Continuity
    continuityRef: shot.continuityRef,
    imageStatus: 'idle' as const,
    imageProgress: 0,
    imageError: null,
    videoStatus: 'idle' as const,
    videoProgress: 0,
    videoUrl: null,
    videoHttpUrl: null,
    videoError: null,
    videoMediaId: null,
    endFrameStatus: 'idle' as const,
    endFrameProgress: 0,
    endFrameError: null,
  }));
}
