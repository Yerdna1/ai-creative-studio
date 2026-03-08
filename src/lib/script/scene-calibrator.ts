// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * AI Scene Calibrator
 *
 * Use AI to intelligently calibrate scene lists extracted from scripts
 *
 * Features:
 * 1. Count appearance count and episode numbers for each scene
 * 2. AI analysis to identify important scenes vs transition scenes
 * 3. AI merge variants of the same location (e.g., Zhang Family Living Room = Zhang Ming Home Living Room)
 * 4. AI supplement scene information (architecture style, lighting, props, etc.)
 * 5. Master-level scene visual design (professional prompt generation)
 */

import type { ScriptScene, ProjectBackground, EpisodeRawScript } from '@/types/script';
import { callFeatureAPI } from '@/lib/ai/feature-router';
import { processBatched } from '@/lib/ai/batch-processor';
import { estimateTokens, safeTruncate } from '@/lib/ai/model-registry';
import { t } from '@/i18n';
import { getPromptLanguageSuffix } from './prompt-language';

// ==================== Type Definitions ====================

export interface SceneCalibrationResult {
  /** Calibrated scene list */
  scenes: CalibratedScene[];
  /** Merged scene records */
  mergeRecords: SceneMergeRecord[];
  /** AI analysis notes */
  analysisNotes: string;
}

export interface CalibratedScene {
  id: string;
  name: string;
  location: string;
  time: string;
  atmosphere: string;
  /** Scene importance */
  importance: 'main' | 'secondary' | 'transition';
  /** Episode numbers where scene appears */
  episodeNumbers: number[];
  /** Appearance count */
  appearanceCount: number;
  /** Architecture style */
  architectureStyle?: string;
  /** Lighting design */
  lightingDesign?: string;
  /** Color palette */
  colorPalette?: string;
  /** Key props */
  keyProps?: string[];
  /** Spatial layout */
  spatialLayout?: string;
  /** Era characteristics */
  eraDetails?: string;
  /** English visual prompt */
  visualPromptEn?: string;
  /** Chinese visual description */
  visualPromptZh?: string;
  /** Original name variants */
  nameVariants: string[];
}

export interface SceneMergeRecord {
  /** Final name used */
  finalName: string;
  /** Variants that were merged */
  variants: string[];
  /** Reason for merge */
  reason: string;
}

export interface SceneStats {
  name: string;
  location: string;
  /** Appearance count */
  appearanceCount: number;
  /** Episode numbers where scene appears */
  episodeNumbers: number[];
  /** Scene content samples */
  contentSamples: string[];
  /** Characters appearing */
  characters: string[];
  /** Time settings */
  times: string[];
  /** Action description samples (for inferring scene props/layout) */
  actionSamples: string[];
  /** Dialogue samples (for understanding scene purpose) */
  dialogueSamples: string[];
}

/** @deprecated No longer needed manually, automatically obtained from service mapping */
export interface CalibrationOptions {
  apiKey?: string;
  provider?: string;
  baseUrl?: string;
}

// ==================== Statistics Functions ====================

/**
 * Collect appearance data for all scenes from episode scripts
 */
export function collectSceneStats(
  episodeScripts: EpisodeRawScript[]
): Map<string, SceneStats> {
  const stats = new Map<string, SceneStats>();

  if (!episodeScripts || !Array.isArray(episodeScripts)) {
    console.warn('[collectSceneStats] Invalid episodeScripts');
    return stats;
  }

  for (const ep of episodeScripts) {
    if (!ep || !ep.scenes) continue;
    const epIndex = ep.episodeIndex ?? 0;

    for (const scene of ep.scenes) {
      if (!scene || !scene.sceneHeader) continue;

      // Parse scene header to get location
      const location = extractLocationFromHeader(scene.sceneHeader);
      const key = normalizeLocation(location);

      let stat = stats.get(key);
      if (!stat) {
        stat = {
          name: location,
          location: location,
          appearanceCount: 0,
          episodeNumbers: [],
          contentSamples: [],
          characters: [],
          times: [],
          actionSamples: [],
          dialogueSamples: [],
        };
        stats.set(key, stat);
      }

      stat.appearanceCount++;
      if (!stat.episodeNumbers.includes(epIndex)) {
        stat.episodeNumbers.push(epIndex);
      }

      // Collect content samples
      if (stat.contentSamples.length < 5) {
        const sample = scene.content?.slice(0, 150) || scene.sceneHeader;
        stat.contentSamples.push(`Ep ${epIndex}: ${sample}`);
      }

      // Collect action descriptions (for inferring props and scene layout)
      if (scene.actions && scene.actions.length > 0 && stat.actionSamples.length < 8) {
        // Use parsed action descriptions (starting with △)
        for (const action of scene.actions.slice(0, 3)) {
          if (action && stat.actionSamples.length < 8) {
            stat.actionSamples.push(`Ep ${epIndex}: ${action.slice(0, 100)}`);
          }
        }
      } else if (scene.content && stat.actionSamples.length < 8) {
        // If no △ actions, use first 200 chars of scene content as action samples
        const contentSample = scene.content.slice(0, 200).replace(/\n/g, ' ');
        stat.actionSamples.push(`Ep ${epIndex}: ${contentSample}`);
      }

      // Collect dialogue samples (for understanding what happens in the scene)
      if (scene.dialogues && stat.dialogueSamples.length < 5) {
        for (const d of scene.dialogues.slice(0, 2)) {
          if (d && stat.dialogueSamples.length < 5) {
            stat.dialogueSamples.push(`${d.character}: ${d.line.slice(0, 50)}`);
          }
        }
      }

      // Collect characters
      for (const char of (scene.characters || [])) {
        if (!stat.characters.includes(char)) {
          stat.characters.push(char);
        }
      }

      // Collect time
      const time = extractTimeFromHeader(scene.sceneHeader);
      if (time && !stat.times.includes(time)) {
        stat.times.push(time);
      }
    }
  }

  return stats;
}

/**
 * Extract location from scene header
 * e.g. "1-1 Day Indoor Shanghai Zhang Family" → "Shanghai Zhang Family"
 */
function extractLocationFromHeader(header: string): string {
  // Remove scene number and time/interior markers
  const parts = header.split(/\s+/);
  // Skip "1-1", "Day/Night/Dawn/Dusk", "Indoor/Outdoor/Int/Ext"
  const locationParts = parts.filter(p =>
    !p.match(/^\d+-\d+$/) &&
    !p.match(/^(day|night|dawn|dusk|morning|evening|sunrise|sunset)$/i) &&
    !p.match(/^(int|int\.|ext|ext\.|indoors?|outdoors?|interior|exterior)$/i)
  );
  return locationParts.join(' ') || header;
}

/**
 * Extract time from scene header
 */
function extractTimeFromHeader(header: string): string {
  const timeMatch = header.match(/(day|night|dawn|dusk|morning|evening|sunrise|sunset)/i);
  return timeMatch ? timeMatch[1].toLowerCase() : 'day';
}

/**
 * Normalize location name for matching
 */
function normalizeLocation(location: string): string {
  return cleanLocationString(location)
    .replace(/\s+/g, '')
    .replace(/[\uff08\uff09()]/g, '')
    .toLowerCase();
}

/**
 * Clean scene location string, remove irrelevant content like character information
 */
function cleanLocationString(location: string): string {
  if (!location) return '';
  // Remove "Characters: XXX" or "Character: XXX" part
  let cleaned = location.replace(/\s*(?:characters?|character)\s*[:\[].*/gi, '');
  // Remove "Role: XXX" part
  cleaned = cleaned.replace(/\s*role\s*[:\[].*/gi, '');
  // Remove "Time: XXX" part
  cleaned = cleaned.replace(/\s*time\s*[:\[].*/gi, '');
  // Trim leading/trailing whitespace
  return cleaned.trim();
}

// ==================== Core Calibration Functions ====================

/**
 * AI calibrate all scenes (lightweight mode)
 *
 * [Important] This function only supplements art design info for existing scenes, does not change:
 * - Scene list (no additions, deletions, or merges)
 * - Scene order
 * - viewpoints (multi-view joint image data)
 * - sceneIds, shotIds and other related data
 */
export async function calibrateScenes(
  currentScenes: ScriptScene[],
  background: ProjectBackground,
  episodeScripts: EpisodeRawScript[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options?: CalibrationOptions // No longer needed, kept for compatibility
): Promise<SceneCalibrationResult> {

  // [Lightweight mode] Use currentScenes directly, don't re-collect
  if (!currentScenes || currentScenes.length === 0) {
    console.warn('[calibrateScenes] currentScenes is empty, cannot calibrate');
    return {
      scenes: [],
      mergeRecords: [],
      analysisNotes: 'Scene list is empty',
    };
  }

  console.log('[calibrateScenes] Lightweight mode: supplementing art design for', currentScenes.length, 'existing scenes');

  // 1. Collect scene action description samples (for inferring props)
  const stats = collectSceneStats(episodeScripts);

  // 2. Prepare scene batch items (each scene with statistical info)
  const batchItems = currentScenes.map((scene) => {
    const normalizedLoc = scene.location?.replace(/\s+/g, '').toLowerCase() || '';
    let sceneStat: SceneStats | undefined;
    for (const [key, stat] of stats) {
      if (key.includes(normalizedLoc) || normalizedLoc.includes(key) ||
          stat.name === scene.name || stat.location === scene.location) {
        sceneStat = stat;
        break;
      }
    }
    return {
      sceneId: scene.id,
      name: scene.name || scene.location,
      location: scene.location,
      characters: sceneStat?.characters?.slice(0, 5).join(', ') || 'Unknown',
      appearCount: sceneStat?.appearanceCount || 1,
      episodes: sceneStat?.episodeNumbers?.join(',') || '1',
      actionSamples: sceneStat?.actionSamples?.slice(0, 3) || [],
      dialogueSamples: sceneStat?.dialogueSamples?.slice(0, 2) || [],
    };
  });

  // 3. Build shared system prompt
  const systemPrompt = `You are a professional film art director and scene designer, skilled at supplementing professional visual design schemes for existing scenes.

【Core Task】
Supplement art design information for the following scenes, used for generating scene concept art.

【Important Constraints】
1. **Do not add scenes** - Only process scenes in the list
2. **Do not delete scenes** - Even transition scenes must be kept
3. **Do not merge scenes** - Only record “merge suggestions”, do not merge on your own
4. **Keep original sceneId** - Must return exactly as received

【Scene Design Elements - Must infer from action descriptions】
For each scene supplement:
- Architecture style, lighting design, color palette
- **Key props**: Must infer from “action descriptions”
- Spatial layout, era features, importance classification

Please return analysis results in JSON format.` + getPromptLanguageSuffix();

  // Shared background context
  const outlineContext = safeTruncate(background.outline || '', 1500);

  try {
    // Closure to collect cross-batch aggregated fields
    const allMergeRecords: SceneMergeRecord[] = [];
    const allAnalysisNotes: string[] = [];

    const { results: sceneResults, failedBatches } = await processBatched<
      typeof batchItems[number],
      {
        sceneId?: string;
        name?: string;
        location?: string;
        importance?: string;
        atmosphere?: string;
        architectureStyle?: string;
        lightingDesign?: string;
        colorPalette?: string;
        keyProps?: string[];
        spatialLayout?: string;
        eraDetails?: string;
      }
    >({
      items: batchItems,
      feature: 'script_analysis',
      buildPrompts: (batch) => {
        const sceneList = batch.map((s, i) => {
          const actionInfo = s.actionSamples.length
            ? `\n   Action descriptions: ${s.actionSamples.join('; ')}`
            : '';
          const dialogueInfo = s.dialogueSamples.length
            ? `\n   Dialogue samples: ${s.dialogueSamples.join('; ')}`
            : '';
          return `${i + 1}. [sceneId: ${s.sceneId}] ${s.name}\n   Location: ${s.location} [Appears ${s.appearCount} times, Episodes ${s.episodes}]\n   Characters: ${s.characters}${actionInfo}${dialogueInfo}`;
        }).join('\n\n');

        const user = `【Script Information】
Title: “${background.title}”
${background.genre ? `Genre: ${background.genre}` : ''}
${background.era ? `Era: ${background.era}` : ''}
${background.storyStartYear ? `Story years: ${background.storyStartYear}${background.storyEndYear && background.storyEndYear !== background.storyStartYear ? ` - ${background.storyEndYear}` : ''}` : ''}
${background.timelineSetting ? `Timeline: ${background.timelineSetting}` : ''}
${background.worldSetting ? `World setting: ${safeTruncate(background.worldSetting, 200)}` : ''}
Total episodes: ${episodeScripts.length}

【Story Outline】
${outlineContext || 'None'}

【Existing Scene List - Please supplement art design for each scene】(Total: ${batch.length})
${sceneList}

【Output Rules】
1. Must return each scene's sceneId (exactly matching input)
2. keyProps must be extracted from action descriptions
3. Merge suggestions go in mergeRecords

Please return JSON format:
{
  “scenes”: [
    {
      “sceneId”: “original_scene_id”,
      “name”: “Scene name”,
      “location”: “Specific location”,
      “importance”: “main/secondary/transition”,
      “architectureStyle”: “Architecture style”,
      “lightingDesign”: “Lighting design”,
      “colorPalette”: “Color palette”,
      “keyProps”: [“prop1”, “prop2”],
      “spatialLayout”: “Spatial layout”,
      “eraDetails”: “Era details”,
      “atmosphere”: “Atmosphere”
    }
  ],
  “mergeRecords”: [],
  “analysisNotes”: “Analysis notes”
}`;
        return { system: systemPrompt, user };
      },
      parseResult: (raw) => {
        // Enhanced fault-tolerant JSON parsing
        let cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const jsonStart = cleaned.indexOf('{');
        const jsonEnd = cleaned.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
          cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
        }

        type ParsedSceneData = {
          sceneId?: string;
          name?: string;
          location?: string;
          importance?: string;
          atmosphere?: string;
          architectureStyle?: string;
          lightingDesign?: string;
          colorPalette?: string;
          keyProps?: string[];
          spatialLayout?: string;
          eraDetails?: string;
          [key: string]: unknown;
        };
        let batchParsed: { scenes?: ParsedSceneData[]; mergeRecords?: SceneMergeRecord[]; analysisNotes?: string } = { scenes: [] };
        try {
          batchParsed = JSON.parse(cleaned);
        } catch (parseErr) {
          console.warn('[calibrateScenes] Batch JSON parsing failed, attempting partial parse...');
          const partialScenes: ParsedSceneData[] = [];
          const scenePattern = /\{\s*”sceneId”\s*:\s*”([^”]+)”[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g;
          let match;
          while ((match = scenePattern.exec(raw)) !== null) {
            try {
              const sceneObj = JSON.parse(match[0]);
              if (sceneObj.sceneId) partialScenes.push(sceneObj as ParsedSceneData);
            } catch { /* skip */ }
          }
          if (partialScenes.length > 0) {
            batchParsed = { scenes: partialScenes, mergeRecords: [], analysisNotes: 'Partial parse' };
          } else {
            throw parseErr;
          }
        }

        // Collect aggregated fields
        allMergeRecords.push(...(batchParsed.mergeRecords || []));
        if (batchParsed.analysisNotes) allAnalysisNotes.push(batchParsed.analysisNotes);

        // Return Map<sceneId, scene data>
        const map = new Map<string, ParsedSceneData>();
        for (const s of (batchParsed.scenes || [])) {
          if (s.sceneId) {
            map.set(s.sceneId, s);
          }
          // Fallback: use location/name mapping
          if (s.location) map.set('loc:' + normalizeLocation(s.location), s);
          if (s.name) map.set('loc:' + normalizeLocation(s.name), s);
        }
        return map;
      },
      estimateItemTokens: (item) => estimateTokens(
        `${item.name} ${item.location} ${item.characters} ` +
        item.actionSamples.join(' ') + ' ' + item.dialogueSamples.join(' ')
      ),
      estimateItemOutputTokens: () => 300,
    });

    if (failedBatches > 0) {
      console.warn(`[SceneCalibrator] ${failedBatches} batches failed, using partial results`);
    }

    console.log('[calibrateScenes] AI returned', sceneResults.size, 'scene results');

    // [Key] Traverse currentScenes in original order, only update art fields
    const scenes: CalibratedScene[] = currentScenes.map((orig, i) => {
      let aiData = sceneResults.get(orig.id);
      if (!aiData) aiData = sceneResults.get('loc:' + normalizeLocation(orig.location || ''));
      if (!aiData) aiData = sceneResults.get('loc:' + normalizeLocation(orig.name || ''));

      const matched = !!aiData;
      console.log(`[calibrateScenes] Scene #${i + 1} “${orig.name || orig.location}” (${orig.id}) -> AI match: ${matched ? 'YES' : 'NO'}`);

      return {
        id: orig.id,
        name: orig.name || orig.location,
        location: orig.location,
        time: orig.time || 'day',
        atmosphere: aiData?.atmosphere || orig.atmosphere || 'calm',
        importance: (aiData?.importance || 'secondary') as CalibratedScene['importance'],
        episodeNumbers: [],
        appearanceCount: 1,
        architectureStyle: aiData?.architectureStyle,
        lightingDesign: aiData?.lightingDesign,
        colorPalette: aiData?.colorPalette,
        keyProps: aiData?.keyProps,
        spatialLayout: aiData?.spatialLayout,
        eraDetails: aiData?.eraDetails,
        nameVariants: [orig.name || orig.location],
      };
    });

    // Generate professional visual prompts for main scenes
    const enrichedScenes = await enrichScenesWithVisualPrompts(
      scenes,
      background
    );

    return {
      scenes: enrichedScenes,
      mergeRecords: allMergeRecords,
      analysisNotes: allAnalysisNotes.join('; ') || '',
    };
  } catch (error) {
    console.error('[SceneCalibrator] AI calibration failed:', error);
    const fallbackScenes: CalibratedScene[] = Array.from(stats.values())
      .sort((a, b) => b.appearanceCount - a.appearanceCount)
      .map((s, i) => ({
        id: `scene_${i + 1}`,
        name: s.name,
        location: s.location,
        time: s.times[0] || 'day',
        atmosphere: 'calm',
        importance: (s.appearanceCount >= 5 ? 'main' :
                    s.appearanceCount >= 2 ? 'secondary' : 'transition') as 'main' | 'secondary' | 'transition',
        episodeNumbers: s.episodeNumbers,
        appearanceCount: s.appearanceCount,
        nameVariants: [s.name],
      }));

    return {
      scenes: fallbackScenes,
      mergeRecords: [],
      analysisNotes: 'AI calibration failed, returning statistics-based results',
    };
  }
}

/**
 * AI calibrate single episode scenes
 */
export async function calibrateEpisodeScenes(
  episodeIndex: number,
  currentScenes: ScriptScene[],
  background: ProjectBackground,
  episodeScripts: EpisodeRawScript[],
  _options: CalibrationOptions
): Promise<SceneCalibrationResult> {
  // Find the episode script
  const episodeScript = episodeScripts.find(ep => ep.episodeIndex === episodeIndex);
  if (!episodeScript) {
    throw new Error(t('lib.error.episodeScriptNotFound', { index: episodeIndex }));
  }

  // Only calibrate scenes for this episode
  const singleEpisodeScripts = [episodeScript];

  // Reuse global calibration logic, but only pass single episode data
  return calibrateScenes(currentScenes, background, singleEpisodeScripts, _options);
}

// ==================== Professional Visual Design ====================

/**
 * Generate professional visual prompts for main scenes
 */
async function enrichScenesWithVisualPrompts(
  scenes: CalibratedScene[],
  background: ProjectBackground
): Promise<CalibratedScene[]> {
  // Only generate detailed prompts for main and secondary scenes
  const keyScenes = scenes.filter(s =>
    s.importance === 'main' || s.importance === 'secondary'
  );

  if (keyScenes.length === 0) {
    return scenes;
  }

  console.log(`[enrichScenesWithVisualPrompts] Generating professional prompts for ${keyScenes.length} key scenes...`);

  const systemPrompt = `You are a Hollywood top-tier art director, having designed scenes for movies like "Inception" and "The Grand Budapest Hotel".

Your professional capabilities:
- **Spatial Aesthetics**: Understanding how to use composition, lighting, and color to convey emotion
- **Era Restoration**: Accurately grasp architectural and interior decoration features of different eras
- **AI Image Generation**: Deeply knowledgeable in best prompt writing practices for Midjourney, DALL-E and other AI drawing models
- **Cinematic Language**: Understanding how scenes serve narrative

【Script Information】
Title: "${background.title}"
Genre: ${background.genre || 'Unknown'}
Era: ${background.era || 'Unknown'}

【Story Outline】
${background.outline?.slice(0, 1000) || 'None'}

【Task】
Generate professional visual prompts for the following scenes:

${keyScenes.map((s, i) => `${i+1}. ${s.name}
   - Importance: ${s.importance === 'main' ? 'Main scene' : 'Secondary scene'}
   - Architecture style: ${s.architectureStyle || 'Unknown'}
   - Lighting: ${s.lightingDesign || 'Unknown'}
   - Color: ${s.colorPalette || 'Unknown'}
   - Props: ${s.keyProps?.join(', ') || 'Unknown'}
   - Era: ${s.eraDetails || 'Unknown'}`).join('\n\n')}

【Output Requirements】
For each scene generate:
1. Chinese visual description (100-150 words, including spatial feel, atmosphere, details)
2. English visual prompt (50-80 words, suitable for AI image generation, including style, lighting, composition)

Please return JSON format:
{
  "scenes": [
    {
      "name": "Scene name",
      "visualPromptZh": "Chinese visual description",
      "visualPromptEn": "English visual prompt for AI image generation"
    }
  ]
}` + getPromptLanguageSuffix();

  try {
    // Get configuration from service mapping uniformly
    const result = await callFeatureAPI('script_analysis', systemPrompt, 'Please generate professional visual prompts for the above scenes');

    // Parse result
    let cleaned = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
    }

    const parsed = JSON.parse(cleaned);
    const designMap = new Map<string, {
      name?: string;
      visualPromptZh?: string;
      visualPromptEn?: string;
    }>();
    for (const s of (parsed.scenes || [])) {
      designMap.set(s.name, s);
    }

    // Merge into scene data
    return scenes.map(s => {
      const design = designMap.get(s.name);
      if (design) {
        return {
          ...s,
          visualPromptZh: design.visualPromptZh,
          visualPromptEn: design.visualPromptEn,
        };
      }
      return s;
    });
  } catch (error) {
    console.error('[enrichScenesWithVisualPrompts] Generation failed:', error);
    return scenes;
  }
}

// ==================== Conversion Functions ====================

/**
 * Convert calibration result back to ScriptScene format
 */
export function convertToScriptScenes(
  calibrated: CalibratedScene[],
  originalScenes?: ScriptScene[]
): ScriptScene[] {
  return calibrated.map(c => {
    // Find original scene data
    const original = originalScenes?.find(orig =>
      orig.name === c.name ||
      orig.location === c.location ||
      normalizeLocation(orig.location) === normalizeLocation(c.location)
    );

    // Clean location string
    const cleanedLocation = cleanLocationString(c.location);

    return {
      // Preserve original fields
      ...original,
      // Update/supplement AI-calibrated fields
      id: original?.id || c.id,
      name: c.name,
      location: cleanedLocation,
      time: c.time,
      atmosphere: c.atmosphere,
      // Professional scene design fields
      visualPrompt: c.visualPromptZh,
      visualPromptEn: c.visualPromptEn,
      architectureStyle: c.architectureStyle,
      lightingDesign: c.lightingDesign,
      colorPalette: c.colorPalette,
      keyProps: c.keyProps,
      spatialLayout: c.spatialLayout,
      eraDetails: c.eraDetails,
      // Appearance statistics
      episodeNumbers: c.episodeNumbers,
      appearanceCount: c.appearanceCount,
      importance: c.importance,
      // Tags
      tags: [
        c.importance,
        `Appears ${c.appearanceCount} times`,
        ...(c.keyProps || []).slice(0, 3),
      ],
      // [Fix] Preserve original scene's viewpoints data (AI perspective analysis result)
      viewpoints: original?.viewpoints,
    };
  });
}

/**
 * Sort scenes by importance
 */
export function sortByImportance(scenes: CalibratedScene[]): CalibratedScene[] {
  const order = { main: 0, secondary: 1, transition: 2 };
  return [...scenes].sort((a, b) => {
    // First by importance
    const importanceOrder = order[a.importance] - order[b.importance];
    if (importanceOrder !== 0) return importanceOrder;
    // Then by appearance count
    return b.appearanceCount - a.appearanceCount;
  });
}
