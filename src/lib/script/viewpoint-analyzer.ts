// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * AI Viewpoint Analyzer
 *
 * Use AI to analyze scene and shot content, intelligently generate appropriate viewpoint lists
 * Replaces the original hardcoded keyword matching
 */

import type { Shot, ScriptScene } from '@/types/script';
import { callFeatureAPI } from '@/lib/ai/feature-router';
import { getPromptLanguageSuffix } from './prompt-language';

export interface AnalyzedViewpoint {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  descriptionEn: string;
  keyProps: string[];
  keyPropsEn: string[];
  shotIndexes: number[];  // Associated shot indices
}

export interface ViewpointAnalysisResult {
  viewpoints: AnalyzedViewpoint[];
  analysisNote: string;
}

export interface ViewpointAnalysisOptions {
  /** Episode outline/story synopsis */
  episodeSynopsis?: string;
  /** Key events of this episode */
  keyEvents?: string[];
  /** Series title */
  title?: string;
  /** Genre (business/wuxia/romance/etc.) */
  genre?: string;
  /** Era/historical period */
  era?: string;
  /** World setting/style configuration */
  worldSetting?: string;
}

/**
 * AI analyze scene viewpoints
 * Based on scene information and shot content, intelligently generate the list of viewpoints needed for the scene
 */
export async function analyzeSceneViewpoints(
  scene: ScriptScene,
  shots: Shot[],
  options?: ViewpointAnalysisOptions
): Promise<ViewpointAnalysisResult> {

  // If there are no shots, return default viewpoints
  if (shots.length === 0) {
    return {
      viewpoints: [
        { id: 'overview', name: 'Overview', nameEn: 'Overview', description: 'Overall space', descriptionEn: 'Overall space', keyProps: [], keyPropsEn: [], shotIndexes: [] },
        { id: 'detail', name: 'Detail', nameEn: 'Detail', description: 'Detail close-up', descriptionEn: 'Detail close-up', keyProps: [], keyPropsEn: [], shotIndexes: [] },
      ],
      analysisNote: 'No shots, using default viewpoints',
    };
  }

  // Build shot content summary (using more detailed fields)
  const shotSummaries = shots.map((shot, idx) => {
    const parts = [
      `[Shot ${idx + 1}]`,
      shot.actionSummary && `Action: ${shot.actionSummary}`,
      shot.visualDescription && `Visual: ${shot.visualDescription}`,
      shot.visualFocus && `Focus: ${shot.visualFocus}`,
      shot.dialogue && `Dialogue: ${shot.dialogue.slice(0, 80)}`,
      shot.ambientSound && `Ambient: ${shot.ambientSound}`,
      shot.characterBlocking && `Blocking: ${shot.characterBlocking}`,
      shot.shotSize && `Size: ${shot.shotSize}`,
      shot.cameraMovement && `Movement: ${shot.cameraMovement}`,
    ].filter(Boolean);
    return parts.join('\n  ');
  }).join('\n\n');

  // Handle optional parameters uniformly
  const opts = options || {};

  // Build episode outline section
  const synopsisPart = opts.episodeSynopsis
    ? `[Episode Synopsis]\n${opts.episodeSynopsis}\n`
    : '';
  const keyEventsPart = opts.keyEvents && opts.keyEvents.length > 0
    ? `[Episode Key Events]\n${opts.keyEvents.map((e, i) => `${i + 1}. ${e}`).join('\n')}\n`
    : '';

  // Build global story context
  const globalContextParts = [
    opts.title ? `Title: "${opts.title}"` : '',
    opts.genre ? `Genre: ${opts.genre}` : '',
    opts.era ? `Era: ${opts.era}` : '',
    opts.worldSetting ? `World Setting: ${opts.worldSetting.slice(0, 200)}` : '',
  ].filter(Boolean);
  const globalContextSection = globalContextParts.length > 0
    ? `[Script Information]\n${globalContextParts.join('\n')}\n\n`
    : '';

  const systemPrompt = `You are a professional film art director, skilled at analyzing scenes and determining required shooting viewpoints.

${globalContextSection}[Task]
Based on the episode synopsis, scene information, and shot content, analyze what different viewpoints/camera angles this scene needs to generate scene background images.

[Important Principles]
1. Viewpoints must match scene type:
   - Bus/Car scenes: window, seat area, aisle, driver seat, etc.
   - Indoor home: living room, bedroom, kitchen, window side, etc.
   - Outdoor scenes: overview, close-up, specific landmarks, etc.
   - Ancient scenes: main room, courtyard, desk table, etc.
2. Extract actually needed viewpoints from shot actions and visual descriptions
3. Combine with episode synopsis to understand scene's narrative function, determine which viewpoints are core
4. Each viewpoint should have key props (extracted from shot's visual focus and ambient sound)
5. Output 4-6 viewpoints

[Output Format]
Return JSON:
{
  "viewpoints": [
    {
      "id": "unique ID like window/seat/overview",
      "name": "Chinese Name",
      "nameEn": "English Name",
      "description": "Chinese description (within 20 chars)",
      "descriptionEn": "English description",
      "keyProps": ["prop1", "prop2"],
      "keyPropsEn": ["prop1", "prop2"],
      "shotIndexes": [1, 2]  // Which shots need this viewpoint
    }
  ],
  "analysisNote": "Analysis note"
}` + getPromptLanguageSuffix();

  const userPrompt = `${synopsisPart}${keyEventsPart}[Scene Information]
Location: ${scene.location || scene.name}
Time: ${scene.time || 'day'}
Atmosphere: ${scene.atmosphere || 'calm'}

[Shot Content (${shots.length} shots total)]
${shotSummaries}

Please analyze the viewpoints needed for this scene based on the episode synopsis and shot content above, return JSON.`;

  try {
    console.log('[analyzeSceneViewpoints] Starting AI API call...');
    console.log('[analyzeSceneViewpoints] Scene:', scene.location || scene.name);
    console.log('[analyzeSceneViewpoints] Shot count:', shots.length);

    // Get configuration from service mapping uniformly
    const result = await callFeatureAPI('script_analysis', systemPrompt, userPrompt);

    console.log('[analyzeSceneViewpoints] AI API call successful, response length:', result.length);
    console.log('[analyzeSceneViewpoints] First 200 chars of response:', result.slice(0, 200));

    // Parse JSON
    let cleaned = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
    }

    const parsed = JSON.parse(cleaned);

    console.log('[analyzeSceneViewpoints] JSON parsed successfully, viewpoint count:', parsed.viewpoints?.length || 0);

    const viewpoints = (parsed.viewpoints || []).map((v: {
      id?: string;
      name?: string;
      nameEn?: string;
      description?: string;
      descriptionEn?: string;
      keyProps?: string[];
      keyPropsEn?: string[];
      shotIndexes?: number[];
    }, idx: number) => ({
      id: v.id || `viewpoint_${idx}`,
      name: v.name || 'Unnamed Viewpoint',
      nameEn: v.nameEn || 'Unnamed Viewpoint',
      description: v.description || '',
      descriptionEn: v.descriptionEn || '',
      keyProps: v.keyProps || [],
      keyPropsEn: v.keyPropsEn || [],
      shotIndexes: v.shotIndexes || [],
    }));

    console.log('[analyzeSceneViewpoints] Returned viewpoints:', viewpoints.map((v: AnalyzedViewpoint) => v.name).join(', '));

    return {
      viewpoints,
      analysisNote: parsed.analysisNote || '',
    };
  } catch (error) {
    console.error('[analyzeSceneViewpoints] AI analysis failed:');

    // Fallback: Return basic viewpoints
    return {
      viewpoints: [
        { id: 'overview', name: 'Overview', nameEn: 'Overview', description: 'Overall spatial layout', descriptionEn: 'Overall spatial layout', keyProps: [], keyPropsEn: [], shotIndexes: [] },
        { id: 'medium', name: 'Medium', nameEn: 'Medium Shot', description: 'Medium shot view', descriptionEn: 'Medium shot view', keyProps: [], keyPropsEn: [], shotIndexes: [] },
        { id: 'detail', name: 'Detail', nameEn: 'Detail', description: 'Detail close-up', descriptionEn: 'Detail close-up', keyProps: [], keyPropsEn: [], shotIndexes: [] },
      ],
      analysisNote: 'AI analysis failed, using default viewpoints',
    };
  }
}

/**
 * Batch analyze viewpoints for multiple scenes
 */
export async function analyzeMultipleScenesViewpoints(
  scenesWithShots: Array<{ scene: ScriptScene; shots: Shot[] }>,
  options: ViewpointAnalysisOptions,
  onProgress?: (current: number, total: number, sceneName: string) => void
): Promise<Map<string, ViewpointAnalysisResult>> {
  const results = new Map<string, ViewpointAnalysisResult>();

  for (let i = 0; i < scenesWithShots.length; i++) {
    const { scene, shots } = scenesWithShots[i];

    onProgress?.(i + 1, scenesWithShots.length, scene.name || scene.location || 'Unknown scene');

    const result = await analyzeSceneViewpoints(scene, shots, options);
    results.set(scene.id, result);

    // Avoid API rate limiting
    if (i < scenesWithShots.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return results;
}
