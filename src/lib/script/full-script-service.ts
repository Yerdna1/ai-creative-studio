// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Full Script Service - Complete script import and episode-by-episode shot generation service
 *
 * Core Features:
 * 1. Import complete scripts (including outline, character bios, 60 episodes of content)
 * 2. Generate shots by episode (generate one episode at a time)
 * 3. Update single or all episode shots
 * 4. AI calibration: Generate titles for episodes missing titles
 */

import type {
  EpisodeRawScript,
  ProjectBackground,
  ScriptData,
  Shot,
} from "@/types/script";
import {
  parseFullScript,
  convertToScriptData,
} from "./episode-parser";
import { callFeatureAPI } from "@/lib/ai/feature-router";
import { processBatched } from "@/lib/ai/batch-processor";
import { getStyleDescription, getMediaType } from "@/lib/constants/visual-styles";
import { buildCinematographyGuidance } from "@/lib/constants/cinematography-profiles";
import { getMediaTypeGuidance } from "@/lib/generation/media-type-tokens";
import { getVariationForEpisode } from "./character-stage-analyzer";
import { analyzeSceneViewpoints, type ViewpointAnalysisOptions } from "./viewpoint-analyzer";
import { runStaggered } from "@/lib/utils/concurrency";
import { calibrateShotsMultiStage, type ShotInputData } from "./shot-calibration-stages";
import { useScriptStore } from "@/stores/script-store";
import { useAPIConfigStore } from "@/stores/api-config-store";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { t } from '@/i18n';
import { getPromptLanguageSuffix } from './prompt-language';

export interface ImportResult {
  success: boolean;
  background: ProjectBackground | null;
  projectBackground?: ProjectBackground; // Compatibility field
  episodes: EpisodeRawScript[];
  scriptData: ScriptData | null;
  error?: string;
}

export interface GenerateShotsOptions {
  apiKey: string;
  provider: string;
  baseUrl?: string;
  styleId: string;
  targetDuration: string;
  language?: string;
}

export interface GenerateEpisodeShotsResult {
  shots: Shot[];
  viewpointAnalyzed: boolean;
  viewpointSkippedReason?: string;
}

/**
 * Import complete script
 * @param fullText Complete script text
 * @param projectId Project ID
 */
export async function importFullScript(
  fullText: string,
  projectId: string
): Promise<ImportResult> {
  try {
    // 1. Parse complete script
    const { background, episodes } = parseFullScript(fullText);

    if (episodes.length === 0) {
      return {
        success: false,
        background: null,
        episodes: [],
        scriptData: null,
        error: t('lib.error.couldNotParseAnyEpisodes'),
      };
    }

    // 2. Convert to ScriptData format
    const scriptData = convertToScriptData(background, episodes);

    // 3. Save to store
    const store = useScriptStore.getState();
    store.setProjectBackground(projectId, background);
    store.setEpisodeRawScripts(projectId, episodes);
    store.setScriptData(projectId, scriptData);
    store.setRawScript(projectId, fullText);
    store.setParseStatus(projectId, "ready");

    // 4. Auto-generate project metadata MD (as global reference for AI generation)
    const metadataMd = exportProjectMetadata(projectId);
    store.setMetadataMarkdown(projectId, metadataMd);
    console.log('[importFullScript] Metadata auto-generated, length:', metadataMd.length);

    return {
      success: true,
      background,
      projectBackground: background, // Return both fields for compatibility
      episodes,
      scriptData,
    };
  } catch (error) {
    console.error("Import error:", error);
    return {
      success: false,
      background: null,
      episodes: [],
      scriptData: null,
      error: error instanceof Error ? error.message : "Import failed",
    };
  }
}

/**
 * Generate shots for a single episode
 * @param episodeIndex Episode index (1-based)
 * @param projectId Project ID
 * @param options Generation options
 */
export async function generateEpisodeShots(
  episodeIndex: number,
  projectId: string,
  options: GenerateShotsOptions,
  onProgress?: (message: string) => void
): Promise<GenerateEpisodeShotsResult> {
  const store = useScriptStore.getState();
  const project = store.projects[projectId];
  
  if (!project) {
    throw new Error(t('lib.error.projectNotFound'));
  }
  
  const episodeScript = project.episodeRawScripts.find(
    (ep) => ep.episodeIndex === episodeIndex
  );
  
  if (!episodeScript) {
    throw new Error(t('lib.error.episodeScriptNotFound', { index: episodeIndex }));
  }
  
  // Update episode generation status
  store.updateEpisodeRawScript(projectId, episodeIndex, {
    shotGenerationStatus: 'generating',
  });

  try {
    onProgress?.(`Generating shots for episode ${episodeIndex}...`);

    // Get scenes for this episode
    const scriptData = project.scriptData;
    if (!scriptData) {
      throw new Error(t('lib.error.scriptDataNotFound'));
    }

    const episode = scriptData.episodes.find((ep) => ep.index === episodeIndex);
    if (!episode) {
      throw new Error(t('lib.error.episodeScriptNotFound', { index: episodeIndex }));
    }

    const episodeScenes = scriptData.scenes.filter((s) =>
      episode.sceneIds.includes(s.id)
    );

    // Build scene content for shot generation
    const scenesWithContent = episodeScenes.map((scene, idx) => {
      const rawScene = episodeScript.scenes[idx];
      return {
        ...scene,
        // Use raw content to generate shots
        rawContent: rawScene?.content || '',
        dialogues: rawScene?.dialogues || [],
        actions: rawScene?.actions || [],
      };
    });

    // Generate shots
    const newShots = await generateShotsForEpisode(
      scenesWithContent,
      episodeIndex,
      episode.id,
      scriptData.characters,
      options,
      onProgress
    );

    // Update existing shots (remove old shots for this episode, add new shots)
    const existingShots = project.shots.filter(
      (shot) => shot.episodeId !== episode.id
    );
    const allShots = [...existingShots, ...newShots];

    store.setShots(projectId, allShots);

    // === AI Viewpoint Analysis (auto-executed after shot generation) ===
    let viewpointAnalyzed = false;
    let viewpointSkippedReason: string | undefined;
    let analysisExecuted = false;
    let viewpointCount = 0;

    console.log('\n============================================');
    console.log('[generateEpisodeShots] === Starting AI Viewpoint Analysis ===');
    console.log('[generateEpisodeShots] apiKey:', options.apiKey ? `Configured(length ${options.apiKey.length})` : 'Not configured');
    console.log('[generateEpisodeShots] provider:', options.provider);
    console.log('[generateEpisodeShots] baseUrl:', options.baseUrl || 'Default');
    console.log('[generateEpisodeShots] episodeScenes.length:', episodeScenes.length);
    console.log('[generateEpisodeShots] newShots.length:', newShots.length);
    console.log('============================================\n');

    if (!options.apiKey) {
      viewpointSkippedReason = 'API key not configured';
      console.error('[generateEpisodeShots] ❌ Skipping AI Viewpoint Analysis: API key not configured');
    } else if (episodeScenes.length === 0) {
      viewpointSkippedReason = 'No scenes';
      console.warn('[generateEpisodeShots] ⚠️ Skipping AI Viewpoint Analysis: No scenes');
    }

    if (options.apiKey && episodeScenes.length > 0) {
      onProgress?.(`AI analyzing scene viewpoints (${episodeScenes.length} scenes total)...`);

      try {
        // Get episode synopsis and key events
        const episodeSynopsis = episodeScript.synopsis || '';
        const keyEvents = episodeScript.keyEvents || [];

        console.log('[generateEpisodeShots] Episode synopsis:', episodeSynopsis ? `Configured(${episodeSynopsis.length} chars)` : 'Not configured');
        console.log('[generateEpisodeShots] Key events:', keyEvents.length > 0 ? keyEvents.join(', ') : 'Not configured');
        
        const background = project.projectBackground;
        const viewpointOptions: ViewpointAnalysisOptions = {
          episodeSynopsis,  // Pass episode synopsis
          keyEvents,        // Pass key events
          title: background?.title,
          genre: background?.genre,
          era: background?.era,
          worldSetting: background?.worldSetting,
        };

        console.log('[generateEpisodeShots] viewpointOptions built, genre:', viewpointOptions.genre || 'Unknown');

        // Get concurrency configuration (using statically imported store at top)
        // Zhipu API has strict concurrency limits, viewpoint analysis uses at most 10 concurrent requests
        const userConcurrency = useAPIConfigStore.getState().concurrency || 1;
        const concurrency = Math.min(userConcurrency, 10);
        console.log(`[generateEpisodeShots] Using concurrency: ${concurrency} (User setting: ${userConcurrency}, Limit: 10)`);

        // Analyze viewpoints for each scene (supports concurrency)
        const updatedScenes = [...scriptData.scenes];

        // Prepare scene analysis tasks
        const sceneAnalysisTasks = episodeScenes.map((scene, i) => ({
          scene,
          index: i,
          sceneShots: newShots.filter(s => s.sceneRefId === scene.id),
        })).filter(task => task.sceneShots.length > 0);

        console.log(`[generateEpisodeShots] 🚀 Scenes to analyze: ${sceneAnalysisTasks.length}, concurrency: ${concurrency}`);

        // Function to process a single scene
        const processScene = async (taskIndex: number) => {
          const task = sceneAnalysisTasks[taskIndex];
          const { scene, index: i, sceneShots } = task;

          console.log(`[generateEpisodeShots] Scene ${i + 1}/${episodeScenes.length}: "${scene.location}" has ${sceneShots.length} shots`);
          analysisExecuted = true;
          onProgress?.(`AI analyzing scene ${i + 1}/${episodeScenes.length}: ${scene.location}...`);

          console.log(`[generateEpisodeShots] 🔄 Calling analyzeSceneViewpoints for "${scene.location}"...`);
          const result = await analyzeSceneViewpoints(scene, sceneShots, viewpointOptions);
          console.log(`[generateEpisodeShots] ✅ AI analysis complete, returned ${result.viewpoints.length} viewpoints:`,
            result.viewpoints.map(v => v.name).join(', '));
          console.log(`[generateEpisodeShots] 📝 analysisNote: ${result.analysisNote}`);

          return { scene, sceneShots, result };
        };

        // Staggered startup concurrency control: start a new task every 5 seconds, max concurrency at a time
        const settledResults = await runStaggered(
          sceneAnalysisTasks.map((_, taskIndex) => async () => {
            console.log(`[generateEpisodeShots] 🚀 Starting scene ${taskIndex + 1}/${sceneAnalysisTasks.length}`);
            return await processScene(taskIndex);
          }),
          concurrency,
          5000
        );

        // Process all results
        for (const settledResult of settledResults) {
          if (settledResult.status === 'fulfilled') {
            const { scene, sceneShots, result } = settledResult.value;

            // Update scene's viewpoint data
            const sceneIndex = updatedScenes.findIndex(s => s.id === scene.id);
            if (sceneIndex !== -1) {
              const viewpointsData = result.viewpoints.map((v: { id: string; name: string; nameEn: string; shotIndexes: number[]; keyProps?: string[] }, idx: number) => ({
                id: v.id,
                name: v.name,
                nameEn: v.nameEn,
                shotIds: v.shotIndexes.map((si: number) => sceneShots[si - 1]?.id).filter(Boolean),
                keyProps: v.keyProps || [],
                gridIndex: idx,
              }));

              // Check for unassigned shots and assign them to appropriate viewpoints
              const allAssignedShotIds = new Set(viewpointsData.flatMap((v: { shotIds: string[] }) => v.shotIds));
              const unassignedShots = sceneShots.filter((s: { id: string }) => !allAssignedShotIds.has(s.id));

              if (unassignedShots.length > 0) {
                console.log(`[generateEpisodeShots] ⚠️ Found ${unassignedShots.length} unassigned shots:`, unassignedShots.map((s: { id: string }) => s.id));

                // Strategy: Intelligently assign to best matching viewpoint based on shot content
                for (const shot of unassignedShots) {
                  const shotText = [
                    shot.actionSummary,
                    shot.visualDescription,
                    shot.visualFocus,
                    shot.dialogue,
                  ].filter(Boolean).join(' ').toLowerCase();

                  // Find best matching viewpoint
                  let bestViewpointIdx = 0;
                  let bestScore = 0;

                  for (let vIdx = 0; vIdx < viewpointsData.length; vIdx++) {
                    const vp = viewpointsData[vIdx];
                    const vpName = vp.name.toLowerCase();
                    const vpKeywords = vp.keyProps || [];

                    let score = 0;
                    // Regex kept for parsing Chinese input - removes viewpoint suffix keywords
                    const nameKeywords = vpName.replace(/(viewpoint|area|position)$/g, '').split('');
                    for (const char of nameKeywords) {
                      if (shotText.includes(char)) score += 1;
                    }
                    for (const prop of vpKeywords) {
                      if (shotText.includes(prop.toLowerCase())) score += 2;
                    }

                    if (score > bestScore) {
                      bestScore = score;
                      bestViewpointIdx = vIdx;
                    }
                  }

                  if (bestScore === 0) {
                    const overviewIdx = viewpointsData.findIndex((v: { name: string; id: string }) =>
                      v.name.includes('overview') || v.id === 'overview'
                    );
                    bestViewpointIdx = overviewIdx >= 0 ? overviewIdx : 0;
                  }

                  viewpointsData[bestViewpointIdx].shotIds.push(shot.id);
                  console.log(`[generateEpisodeShots]   - Shot ${shot.id} assigned to viewpoint "${viewpointsData[bestViewpointIdx].name}" (score: ${bestScore})`);
                }
              }

              updatedScenes[sceneIndex] = {
                ...updatedScenes[sceneIndex],
                viewpoints: viewpointsData,
              };
              viewpointCount += viewpointsData.length;
              console.log(`[generateEpisodeShots] 💾 Scene "${scene.location}" viewpoints updated:`, viewpointsData);
            }
          } else {
            console.error(`[generateEpisodeShots] ❌ Scene analysis failed:`, settledResult.reason);
          }
        }

        // Log for scenes with no shots
        const skippedScenes = episodeScenes.filter(scene =>
          !sceneAnalysisTasks.find(t => t.scene.id === scene.id)
        );
        for (const scene of skippedScenes) {
          console.log(`[generateEpisodeShots] ⏭️ Skipping scene "${scene.location}" (no shots)`);
        }

        // Save updated scene data
        console.log('\n============================================');
        console.log('[generateEpisodeShots] 📦 Saving AI viewpoints to scriptData.scenes...');
        console.log('[generateEpisodeShots] Scenes with viewpoints in updatedScenes:');
        updatedScenes.forEach(s => {
          if (s.viewpoints && s.viewpoints.length > 0) {
            console.log(`  - ${s.location}: ${s.viewpoints.length} viewpoints [${s.viewpoints.map((v: { name: string }) => v.name).join(', ')}]`);
          }
        });

        store.setScriptData(projectId, {
          ...scriptData,
          scenes: updatedScenes,
        });

        console.log('[generateEpisodeShots] ✅ AI viewpoints saved to store');
        console.log('[generateEpisodeShots] Total AI analyzed viewpoints:', viewpointCount);
        console.log('============================================\n');

        viewpointAnalyzed = analysisExecuted;
        if (!analysisExecuted) {
          viewpointSkippedReason = 'No shots';
        }

        onProgress?.(`AI viewpoint analysis complete (${viewpointCount} viewpoints)`);
      } catch (e) {
        const err = e as Error;
        console.error('\n============================================');
        console.error('[generateEpisodeShots] ❌ AI viewpoint analysis failed:', err);
        console.error('[generateEpisodeShots] Error name:', err.name);
        console.error('[generateEpisodeShots] Error message:', err.message);
        console.error('[generateEpisodeShots] Error stack:', err.stack);
        console.error('============================================\n');
        viewpointSkippedReason = `AI analysis failed: ${err.message}`;
        // Does not affect main flow, but logs detailed error
      }
    }

    store.updateEpisodeRawScript(projectId, episodeIndex, {
      shotGenerationStatus: 'completed',
      lastGeneratedAt: Date.now(),
    });

    onProgress?.(`Episode ${episodeIndex} shot generation complete! ${newShots.length} shots total`);
    
    return { shots: newShots, viewpointAnalyzed, viewpointSkippedReason };
  } catch (error) {
    store.updateEpisodeRawScript(projectId, episodeIndex, {
      shotGenerationStatus: 'error',
    });
    throw error;
  }
}

/**
 * Generate shots for specified episode's scenes
 */
async function generateShotsForEpisode(
  scenes: Array<{
    id: string;
    name?: string;
    location: string;
    time: string;
    atmosphere: string;
    rawContent: string;
    dialogues: Array<{ character: string; parenthetical?: string; line: string }>;
    actions: string[];
  }>,
  episodeIndex: number,
  episodeId: string,
  characters: Array<{ id: string; name: string }>,
  options: GenerateShotsOptions,
  onProgress?: (message: string) => void
): Promise<Shot[]> {
  const shots: Shot[] = [];
  let shotIndex = 1;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    onProgress?.(`Processing scene ${i + 1}/${scenes.length}: ${scene.name || scene.location}`);

    // Generate shots based on scene content
    const sceneShots = generateShotsFromSceneContent(
      scene,
      episodeId,
      shotIndex,
      characters
    );

    shots.push(...sceneShots);
    shotIndex += sceneShots.length;
  }

  return shots;
}

/**
 * Generate shots from scene raw content (rule-based generation, no AI dependency)
 * Generate one shot per dialogue or action
 */
function generateShotsFromSceneContent(
  scene: {
    id: string;
    name?: string;
    location: string;
    time: string;
    atmosphere: string;
    rawContent: string;
    dialogues: Array<{ character: string; parenthetical?: string; line: string }>;
    actions: string[];
  },
  episodeId: string,
  startIndex: number,
  characters: Array<{ id: string; name: string }>
): Shot[] {
  const shots: Shot[] = [];
  let index = startIndex;

  // Parse scene content, generate shots in order
  const lines = scene.rawContent.split('\n').filter(line => line.trim());

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip character lines and empty lines (including markdown format)
    if (!trimmedLine) continue;
    if (trimmedLine.startsWith('Characters') || trimmedLine.startsWith('**Characters')) continue;
    // Skip pure markdown format lines (like **xxx**)
    if (trimmedLine.match(/^\*\*[^Characters*]+\*\*$/)) continue;

    // Dialogue line
    const dialogueMatch = trimmedLine.match(/^([^:([\n△*]{1,10})[:]\s*(?:[[(]([^)\]]+)[)])?\s*(.+)$/);
    if (dialogueMatch) {
      const charName = dialogueMatch[1].trim();
      const parenthetical = dialogueMatch[2]?.trim() || '';
      const dialogueText = dialogueMatch[3].trim();

      // Skip non-dialogue
      if (charName.match(/^[SubtitleNarrationSceneCharacters]/)) continue;

      const charId = characters.find(c => c.name === charName)?.id || '';

      shots.push(createShot({
        index: index++,
        episodeId,
        sceneRefId: scene.id,
        actionSummary: `${charName} speaking`,
        visualDescription: `${scene.location}, ${charName}${parenthetical ? ` (${parenthetical})` : ''} says: "${dialogueText.slice(0, 50)}${dialogueText.length > 50 ? '...' : ''}"`,
        dialogue: `${charName}${parenthetical ? ` (${parenthetical})` : ''}: ${dialogueText}`,
        characterNames: [charName],
        characterIds: charId ? [charId] : [],
        shotSize: dialogueText.length > 30 ? 'MS' : 'CU',
        duration: Math.max(3, Math.ceil(dialogueText.length / 10)),
      }));
      continue;
    }

    // Action line (starts with △)
    if (trimmedLine.startsWith('△')) {
      const actionText = trimmedLine.slice(1).trim();

      // Extract possible characters from action description
      const mentionedChars = characters.filter(c =>
        actionText.includes(c.name)
      );

      shots.push(createShot({
        index: index++,
        episodeId,
        sceneRefId: scene.id,
        // Keep complete original action text, don't truncate, for AI calibration use
        actionSummary: actionText,
        visualDescription: `${scene.location}, ${actionText}`,
        characterNames: mentionedChars.map(c => c.name),
        characterIds: mentionedChars.map(c => c.id),
        shotSize: actionText.includes('overview') || actionText.includes('wide') ? 'WS' : 'MS',
        duration: Math.max(2, Math.ceil(actionText.length / 15)),
        ambientSound: detectAmbientSound(actionText, scene.atmosphere),
      }));
      continue;
    }

    // Subtitle []
    if (trimmedLine.startsWith('[') && trimmedLine.endsWith(']')) {
      const subtitleText = trimmedLine.slice(1, -1);

      // If flashback marker, generate transition shot
      if (subtitleText.includes('flashback') || subtitleText.includes('Flashback')) {
        shots.push(createShot({
          index: index++,
          episodeId,
          sceneRefId: scene.id,
          actionSummary: subtitleText,
          visualDescription: `[${subtitleText}] Screen fade transition`,
          characterNames: [],
          characterIds: [],
          shotSize: 'WS',
          duration: 2,
        }));
        continue;
      }

      // Subtitle display
      if (subtitleText.startsWith('subtitle') || subtitleText.startsWith('Subtitle')) {
        shots.push(createShot({
          index: index++,
          episodeId,
          sceneRefId: scene.id,
          actionSummary: 'Subtitle display',
          visualDescription: `Screen overlay subtitle: ${subtitleText.replace(/^subtitle[:\uff1a:]\s*/i, '').replace(/^Subtitle[:\uff1a:]\s*/i, '')}`,
          characterNames: [],
          characterIds: [],
          shotSize: 'WS',
          duration: 3,
        }));
      }
    }
  }

  // If no shots generated for scene, create a default establishing shot
  if (shots.length === 0) {
    shots.push(createShot({
      index: index,
      episodeId,
      sceneRefId: scene.id,
      actionSummary: `${scene.name || scene.location} establishing shot`,
      visualDescription: `${scene.location}, ${scene.atmosphere} atmosphere`,
      characterNames: [],
      characterIds: [],
      shotSize: 'WS',
      duration: 3,
      ambientSound: detectAmbientSound('', scene.atmosphere),
    }));
  }

  return shots;
}

/**
 * Automatically match character stage variants based on episode number
 * Used to automatically select correct character version during shot generation (e.g., episode 50 automatically uses Zhang Ming middle-aged version)
 */
function matchCharacterVariationsForEpisode(
  characterIds: string[],
  episodeIndex: number
): Record<string, string> {
  const characterVariations: Record<string, string> = {};
  const charLibStore = useCharacterLibraryStore.getState();

  for (const charId of characterIds) {
    // Find character in character library through characterLibraryId
    // Note: charId is the ID in the script, need to find the associated character library character
    const scriptStore = useScriptStore.getState();
    const projects = Object.values(scriptStore.projects);

    // Iterate through projects to find character
    for (const project of projects) {
      const scriptChar = project.scriptData?.characters.find(c => c.id === charId);
      if (scriptChar?.characterLibraryId) {
        const libChar = charLibStore.getCharacterById(scriptChar.characterLibraryId);
        if (libChar && libChar.variations.length > 0) {
          // Find stage variant matching current episode number
          const matchedVariation = getVariationForEpisode(libChar.variations, episodeIndex);
          if (matchedVariation) {
            characterVariations[charId] = matchedVariation.id;
            console.log(`[VariationMatch] Character ${scriptChar.name} episode ${episodeIndex} -> using variant "${matchedVariation.name}"`);
          }
        }
        break;
      }
    }
  }

  return characterVariations;
}

/**
 * Extract episode number from episodeId
 */
function getEpisodeIndexFromId(episodeId: string): number {
  // episodeId format is "ep_X"
  const match = episodeId.match(/ep_(\d+)/);
  return match ? parseInt(match[1], 10) : 1;
}

/**
 * Create shot object
 */
function createShot(params: {
  index: number;
  episodeId: string;
  sceneRefId: string;
  actionSummary: string;
  visualDescription: string;
  dialogue?: string;
  characterNames: string[];
  characterIds: string[];
  shotSize: string;
  duration: number;
  ambientSound?: string;
  cameraMovement?: string;
}): Shot {
  // Auto-match character stage variants
  const episodeIndex = getEpisodeIndexFromId(params.episodeId);
  const characterVariations = matchCharacterVariationsForEpisode(
    params.characterIds,
    episodeIndex
  );

  return {
    id: `shot_${Date.now()}_${params.index}`,
    index: params.index,
    episodeId: params.episodeId,
    sceneRefId: params.sceneRefId,
    actionSummary: params.actionSummary,
    visualDescription: params.visualDescription,
    dialogue: params.dialogue,
    characterNames: params.characterNames,
    characterIds: params.characterIds,
    characterVariations,  // Auto-filled stage variant mapping
    shotSize: params.shotSize,
    duration: params.duration,
    ambientSound: params.ambientSound,
    cameraMovement: params.cameraMovement || 'Static',
    imageStatus: 'idle',
    imageProgress: 0,
    videoStatus: 'idle',
    videoProgress: 0,
  };
}

/**
 * Detect ambient sound
 */
function detectAmbientSound(text: string, atmosphere: string): string {
  if (text.includes('rain') || atmosphere.includes('rain')) return 'Rain sounds';
  if (text.includes('wind') || atmosphere.includes('wind')) return 'Wind sounds';
  if (text.includes('ocean') || text.includes('dock') || text.includes('sea')) return 'Ocean waves, seagulls';
  if (text.includes('street') || text.includes('market')) return 'Street bustle, crowd noise';
  if (text.includes('night') || atmosphere.includes('night')) return 'Night silence, insects';
  if (text.includes('dinner') || text.includes('eating')) return 'Tableware clinking';
  return 'Ambient sound';
}

/**
 * Update shots for all episodes
 */
export async function regenerateAllEpisodeShots(
  projectId: string,
  options: GenerateShotsOptions,
  onProgress?: (current: number, total: number, message: string) => void
): Promise<void> {
  const store = useScriptStore.getState();
  const project = store.projects[projectId];

  if (!project || !project.episodeRawScripts.length) {
    throw new Error(t('lib.error.noEpisodesToGenerate'));
  }

  const totalEpisodes = project.episodeRawScripts.length;

  for (let i = 0; i < totalEpisodes; i++) {
    const ep = project.episodeRawScripts[i];
    onProgress?.(i + 1, totalEpisodes, `Generating episode ${ep.episodeIndex}...`);

    await generateEpisodeShots(
      ep.episodeIndex,
      projectId,
      options,
      (msg) => onProgress?.(i + 1, totalEpisodes, msg)
    );
  }
}

/**
 * Get episode generation status summary
 */
export function getEpisodeGenerationSummary(projectId: string): {
  total: number;
  completed: number;
  generating: number;
  idle: number;
  error: number;
} {
  const store = useScriptStore.getState();
  const project = store.projects[projectId];
  
  if (!project) {
    return { total: 0, completed: 0, generating: 0, idle: 0, error: 0 };
  }
  
  const episodes = project.episodeRawScripts;
  return {
    total: episodes.length,
    completed: episodes.filter(ep => ep.shotGenerationStatus === 'completed').length,
    generating: episodes.filter(ep => ep.shotGenerationStatus === 'generating').length,
    idle: episodes.filter(ep => ep.shotGenerationStatus === 'idle').length,
    error: episodes.filter(ep => ep.shotGenerationStatus === 'error').length,
  };
}

// ==================== AI Calibration Feature ====================

// CalibrationOptions no longer needed, config obtained uniformly from service mapping
export interface CalibrationOptions {
  // Keep empty interface for compatibility
}

export interface CalibrationResult {
  success: boolean;
  calibratedCount: number;
  totalMissing: number;
  error?: string;
}

/**
 * Check if episode is missing title
 * Missing title criteria: title is empty, or only contains "Episode X" without content after the colon
 */
function isMissingTitle(title: string): boolean {
  if (!title || title.trim() === '') return true;
  // Match "Episode X" or "EpisodeXX" but without subsequent title
  const onlyEpisodeNum = /^Episode\s+\d+$/i;
  return onlyEpisodeNum.test(title.trim());
}

/**
 * Get list of episodes missing titles
 */
export function getMissingTitleEpisodes(projectId: string): EpisodeRawScript[] {
  const store = useScriptStore.getState();
  const project = store.projects[projectId];
  
  if (!project || !project.episodeRawScripts.length) {
    return [];
  }
  
  return project.episodeRawScripts.filter(ep => isMissingTitle(ep.title));
}


/**
 * Extract summary from episode content
 */
function extractEpisodeSummary(episode: EpisodeRawScript): string {
  const parts: string[] = [];
  
  // Take first 3 scenes' content summary
  const scenesToUse = episode.scenes.slice(0, 3);
  for (const scene of scenesToUse) {
    // Scene info (using sceneHeader instead of location)
    if (scene.sceneHeader) {
      parts.push(`Scene: ${scene.sceneHeader}`);
    }

    // Take first few dialogues
    const dialogueSample = scene.dialogues.slice(0, 3).map(d =>
      `${d.character}: ${d.line.slice(0, 30)}`
    ).join('\n');
    if (dialogueSample) {
      parts.push(dialogueSample);
    }

    // Take first few action descriptions
    const actionSample = scene.actions.slice(0, 2).map(a => a.slice(0, 50)).join('\n');
    if (actionSample) {
      parts.push(actionSample);
    }
  }

  // Limit total length
  const summary = parts.join('\n').slice(0, 800);
  return summary || '(No content)';
}

/**
 * AI calibration: Generate titles for episodes missing titles
 * @param projectId Project ID
 * @param options AI config (no longer needed, kept for compatibility)
 * @param onProgress Progress callback
 */
export async function calibrateEpisodeTitles(
  projectId: string,
  _options?: CalibrationOptions, // No longer needed, kept for compatibility
  onProgress?: (current: number, total: number, message: string) => void
): Promise<CalibrationResult> {
  const store = useScriptStore.getState();
  const project = store.projects[projectId];
  
  if (!project) {
    return { success: false, calibratedCount: 0, totalMissing: 0, error: t('lib.error.projectNotFound') };
  }
  
  // Find episodes missing titles
  const missingEpisodes = getMissingTitleEpisodes(projectId);
  const totalMissing = missingEpisodes.length;
  
  if (totalMissing === 0) {
    return { success: true, calibratedCount: 0, totalMissing: 0 };
  }
  
  onProgress?.(0, totalMissing, `Found ${totalMissing} episodes missing titles, starting calibration...`);
  
  // Get global background info
  const background = project.projectBackground;
  const globalContext = {
    title: background?.title || project.scriptData?.title || 'Untitled Script',
    outline: background?.outline || project.scriptData?.logline || '',
    characterBios: background?.characterBios || '',
    totalEpisodes: project.episodeRawScripts.length,
  };
  
  try {
    // Prepare batch items
    type TitleItem = { index: number; contentSummary: string };
    const items: TitleItem[] = missingEpisodes.map(ep => ({
      index: ep.episodeIndex,
      contentSummary: extractEpisodeSummary(ep),
    }));
    
    const { results, failedBatches, totalBatches } = await processBatched<TitleItem, string>({
      items,
      feature: 'script_analysis',
      buildPrompts: (batch) => {
        const { title, outline, characterBios, totalEpisodes } = globalContext;
        const system = `You are a Hollywood senior screenwriter with Emmy Award nomination experience.

Your professional skills:
- Master of episode naming art: Use short, powerful titles to capture each episode's core conflict and emotional turning points
- Narrative structure control: Understand naming styles for different types of series (business, family, romance, etc.)
- Market sensitivity: Know what titles attract viewers and improve click-through rates

Your task is to generate short, attractive titles for each episode based on the script's global background and each episode's content.

[Script Information]
Title: ${title}
Total Episodes: ${totalEpisodes}

[Story Outline]
${outline.slice(0, 1500)}

[Main Characters]
${characterBios.slice(0, 1000)}

[Requirements]
1. Titles should summarize the main content or turning point of each episode
2. Keep title length between 6-15 characters
3. Style should match the script type (e.g., business dramas use business terminology, wuxia dramas use martial arts atmosphere)
4. Titles should have continuity and reflect plot development

Please return in JSON format:
{
  "titles": {
    "1": "Episode 1 Title",
    "2": "Episode 2 Title"
  }
}` + getPromptLanguageSuffix();
        const episodeContents = batch.map(ep =>
          `Episode ${ep.index} Content Summary: ${ep.contentSummary}`
        ).join('\n\n');
        const user = `Please generate titles for the following episodes:\n\n${episodeContents}`;
        return { system, user };
      },
      parseResult: (raw) => {
        const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(cleaned);
        const result = new Map<string, string>();
        if (parsed.titles) {
          for (const [key, value] of Object.entries(parsed.titles)) {
            result.set(key, value as string);
          }
        }
        return result;
      },
      estimateItemOutputTokens: () => 30, // Titles are short, ~30 tokens per episode
      onProgress: (completed, total, message) => {
        onProgress?.(completed, total, `[Title Calibration] ${message}`);
      },
    });

    // Process results
    let calibratedCount = 0;
    for (const ep of missingEpisodes) {
      const newTitle = results.get(String(ep.episodeIndex));
      if (newTitle) {
        store.updateEpisodeRawScript(projectId, ep.episodeIndex, {
          title: `Episode ${ep.episodeIndex}: ${newTitle}`,
        });

        const scriptData = store.projects[projectId]?.scriptData;
        if (scriptData) {
          const epData = scriptData.episodes.find(e => e.index === ep.episodeIndex);
          if (epData) {
            epData.title = `Episode ${ep.episodeIndex}: ${newTitle}`;
            store.setScriptData(projectId, { ...scriptData });
          }
        }

        calibratedCount++;
      }
    }
    
    if (failedBatches > 0) {
      console.warn(`[Episode title calibration] ${failedBatches}/${totalBatches} batches failed`);
    }
    
    onProgress?.(calibratedCount, totalMissing, `Calibrated ${calibratedCount}/${totalMissing} episodes`);
    
    return {
      success: true,
      calibratedCount,
      totalMissing,
    };
  } catch (error) {
    console.error('[calibrate] Error:', error);
    return {
      success: false,
      calibratedCount: 0,
      totalMissing,
      error: error instanceof Error ? error.message : 'Calibration failed',
    };
  }
}

// ==================== AI Shot Calibration Feature ====================

export interface ShotCalibrationOptions {
  apiKey: string;
  provider: string;
  baseUrl?: string;
  model?: string;  // Optional model specification
  styleId?: string;  // Style identifier, affects visualPrompt generation
  cinematographyProfileId?: string;  // Cinematography profile ID, affects shot control field defaults
}

export interface ShotCalibrationResult {
  success: boolean;
  calibratedCount: number;
  totalShots: number;
  error?: string;
}

/**
 * AI calibrate shots: Optimize Chinese descriptions, generate English visualPrompt, optimize shot design
 */
export async function calibrateEpisodeShots(
  episodeIndex: number,
  projectId: string,
  options: ShotCalibrationOptions,
  onProgress?: (current: number, total: number, message: string) => void,
  filterSceneId?: string,
): Promise<ShotCalibrationResult> {
  const store = useScriptStore.getState();
  const project = store.projects[projectId];
  
  if (!project) {
    return { success: false, calibratedCount: 0, totalShots: 0, error: t('lib.error.projectNotFound') };
  }
  
  // Find shots for this episode
  const scriptData = project.scriptData;
  if (!scriptData) {
    return { success: false, calibratedCount: 0, totalShots: 0, error: t('lib.error.scriptDataNotFound') };
  }
  
  const episode = scriptData.episodes.find(ep => ep.index === episodeIndex);
  if (!episode) {
    return { success: false, calibratedCount: 0, totalShots: 0, error: t('lib.error.episodeNotFound', { index: episodeIndex }) };
  }
  
  // Get all shots for this episode (optional: only calibrate shots for specified scene)
  let episodeShots = project.shots.filter(shot => shot.episodeId === episode.id);
  if (filterSceneId) {
    episodeShots = episodeShots.filter(shot => shot.sceneRefId === filterSceneId);
  }
  const totalShots = episodeShots.length;
  
  if (totalShots === 0) {
    return { success: false, calibratedCount: 0, totalShots: 0, error: t('lib.error.noShotsInEpisode') };
  }
  
  onProgress?.(0, totalShots, `Starting calibration of ${totalShots} shots in episode ${episodeIndex}...`);
  
  // Get global background info
  const background = project.projectBackground;
  const episodeScript = project.episodeRawScripts.find(ep => ep.episodeIndex === episodeIndex);
  
  // Extract raw script content for this episode (dialogue + actions)
  const episodeRawContent = episodeScript?.rawContent || '';
  
  const globalContext = {
    title: background?.title || project.scriptData?.title || 'Untitled Script',
    genre: background?.genre || '',
    era: background?.era || '',
    outline: background?.outline || '',
    characterBios: background?.characterBios || '',
    worldSetting: background?.worldSetting || '',
    themes: background?.themes || [],
    episodeTitle: episode.title,
    episodeSynopsis: episodeScript?.synopsis || '',  // Use episode synopsis
    episodeKeyEvents: episodeScript?.keyEvents || [],  // Key events
    episodeRawContent,  // Raw script content for this episode (complete dialogue, action descriptions)
    episodeSeason: episodeScript?.season,  // Season of this episode
    totalEpisodes: project.episodeRawScripts.length,
    currentEpisode: episodeIndex,
  };
  
  // Build raw scene weather map (get weather from originally parsed scenes)
  const rawSceneWeatherMap = new Map<string, string>();
  if (episodeScript?.scenes) {
    for (const rawScene of episodeScript.scenes) {
      if (rawScene.weather) {
        // Use scene header as key
        rawSceneWeatherMap.set(rawScene.sceneHeader, rawScene.weather);
      }
    }
  }
  
  try {
    // Get user-set concurrency
    const concurrency = useAPIConfigStore.getState().concurrency || 1;
    const batchSize = 5; // Each AI call processes 5 shots
    let calibratedCount = 0;
    const updatedShots: Shot[] = [...project.shots];
    
    // Prepare all batch tasks
    const allBatches: { batch: Shot[]; batchNum: number; batchData: ShotInputData[] }[] = [];
    for (let i = 0; i < episodeShots.length; i += batchSize) {
      const batch = episodeShots.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      
      // Prepare batch data
      const batchData = batch.map(shot => {
        const scene = scriptData.scenes.find(s => s.id === shot.sceneRefId);
        let sourceText = shot.actionSummary || '';
        if (shot.dialogue) {
          sourceText += `\nDialogue: "${shot.dialogue}"`;
        }
        // Try to find corresponding scene weather
        let sceneWeather = '';
        for (const [header, weather] of rawSceneWeatherMap) {
          if (scene?.location && header.includes(scene.location.replace(/\s+/g, ''))) {
            sceneWeather = weather;
            break;
          }
        }
        return {
          shotId: shot.id,
          sourceText,
          actionSummary: shot.actionSummary,
          dialogue: shot.dialogue,
          characterNames: shot.characterNames,
          sceneLocation: scene?.location || '',
          sceneAtmosphere: scene?.atmosphere || '',
          sceneTime: scene?.time || 'day',
          sceneWeather,
          architectureStyle: scene?.architectureStyle || '',
          colorPalette: scene?.colorPalette || '',
          eraDetails: scene?.eraDetails || '',
          lightingDesign: scene?.lightingDesign || '',
          currentShotSize: shot.shotSize,
          currentCameraMovement: shot.cameraMovement,
          currentDuration: shot.duration,
        };
      });
      
      allBatches.push({ batch, batchNum, batchData });
    }
    
    const totalBatches = allBatches.length;
    console.log(`[calibrateShots] Processing: ${totalShots} shots, ${totalBatches} batches, concurrency: ${concurrency}`);
    
    // Staggered startup concurrency control: start a new batch every 5 seconds, max concurrency at a time
    let completedBatches = 0;
    const settledBatchResults = await runStaggered(
      allBatches.map(({ batch, batchNum, batchData }) => async () => {
        console.log(`[calibrateShots] Starting batch ${batchNum}/${totalBatches}`);
        onProgress?.(calibratedCount, totalShots, `Processing batch ${batchNum}/${totalBatches}...`);
        
        // AI call with retry mechanism
        let calibrations: Record<string, Record<string, unknown>> = {};
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
          try {
            calibrations = await calibrateShotsMultiStage(
              batchData,
              { styleId: options.styleId, cinematographyProfileId: options.cinematographyProfileId },
              globalContext,
              (stage, total, name) => {
                console.log(`[calibrateShots] Batch ${batchNum}/${totalBatches} - Stage ${stage}/${total}: ${name}`);
                onProgress?.(calibratedCount, totalShots, `Batch ${batchNum} Stage ${stage}/${total}: ${name}`);
              }
            );
            completedBatches++;
            console.log(`[calibrateShots] Batch ${batchNum} completed, progress: ${completedBatches}/${totalBatches}`);
            return { batch, calibrations, success: true as const };
          } catch (err) {
            retryCount++;
            console.warn(`[calibrateShots] Batch ${batchNum} failed, retry ${retryCount}/${maxRetries}:`, err);
            if (retryCount >= maxRetries) {
              console.error(`[calibrateShots] Batch ${batchNum} reached max retries, skipping`);
              completedBatches++;
              return { batch, calibrations: {} as Record<string, Record<string, unknown>>, success: false as const };
            }
            await new Promise(r => setTimeout(r, 2000 * retryCount));
          }
        }
        completedBatches++;
        return { batch, calibrations, success: false as const };
      }),
      concurrency,
      5000
    );
    const results = settledBatchResults
      .filter((r): r is { status: 'fulfilled'; value: { batch: Shot[]; calibrations: Record<string, Record<string, unknown>>; success: boolean } } => r.status === 'fulfilled')
      .map(r => r.value);
    
    // Process results
    for (const { batch, calibrations, success } of results) {
      if (success) {
        for (const shot of batch) {
          const calibration = calibrations[shot.id] as Record<string, unknown> | undefined;
          if (calibration) {
            const cal = calibration as Record<string, any>;
            const shotIndex = updatedShots.findIndex(s => s.id === shot.id);
            if (shotIndex !== -1) {
              updatedShots[shotIndex] = {
                ...updatedShots[shotIndex],
                visualDescription: cal.visualDescription || updatedShots[shotIndex].visualDescription,
                visualPrompt: cal.visualPrompt || updatedShots[shotIndex].visualPrompt,
                shotSize: cal.shotSize || updatedShots[shotIndex].shotSize,
                cameraMovement: cal.cameraMovement || updatedShots[shotIndex].cameraMovement,
                duration: cal.duration || updatedShots[shotIndex].duration,
                emotionTags: cal.emotionTags || updatedShots[shotIndex].emotionTags,
                characterNames: cal.characterNames?.length > 0
                  ? cal.characterNames
                  : updatedShots[shotIndex].characterNames,
                ambientSound: cal.ambientSound || updatedShots[shotIndex].ambientSound,
                soundEffect: cal.soundEffect || updatedShots[shotIndex].soundEffect,
                imagePrompt: cal.imagePrompt || updatedShots[shotIndex].imagePrompt,
                imagePromptZh: cal.imagePromptZh || updatedShots[shotIndex].imagePromptZh,
                videoPrompt: cal.videoPrompt || updatedShots[shotIndex].videoPrompt,
                videoPromptZh: cal.videoPromptZh || updatedShots[shotIndex].videoPromptZh,
                endFramePrompt: cal.endFramePrompt || updatedShots[shotIndex].endFramePrompt,
                endFramePromptZh: cal.endFramePromptZh || updatedShots[shotIndex].endFramePromptZh,
                needsEndFrame: cal.needsEndFrame ?? updatedShots[shotIndex].needsEndFrame,
                narrativeFunction: cal.narrativeFunction || updatedShots[shotIndex].narrativeFunction,
                shotPurpose: cal.shotPurpose || updatedShots[shotIndex].shotPurpose,
                visualFocus: cal.visualFocus || updatedShots[shotIndex].visualFocus,
                cameraPosition: cal.cameraPosition || updatedShots[shotIndex].cameraPosition,
                characterBlocking: cal.characterBlocking || updatedShots[shotIndex].characterBlocking,
                rhythm: cal.rhythm || updatedShots[shotIndex].rhythm,
                // Shooting control fields
                lightingStyle: cal.lightingStyle || updatedShots[shotIndex].lightingStyle,
                lightingDirection: cal.lightingDirection || updatedShots[shotIndex].lightingDirection,
                colorTemperature: cal.colorTemperature || updatedShots[shotIndex].colorTemperature,
                lightingNotes: cal.lightingNotes || updatedShots[shotIndex].lightingNotes,
                depthOfField: cal.depthOfField || updatedShots[shotIndex].depthOfField,
                focusTarget: cal.focusTarget || updatedShots[shotIndex].focusTarget,
                focusTransition: cal.focusTransition || updatedShots[shotIndex].focusTransition,
                cameraRig: cal.cameraRig || updatedShots[shotIndex].cameraRig,
                movementSpeed: cal.movementSpeed || updatedShots[shotIndex].movementSpeed,
                atmosphericEffects: cal.atmosphericEffects || updatedShots[shotIndex].atmosphericEffects,
                effectIntensity: cal.effectIntensity || updatedShots[shotIndex].effectIntensity,
                playbackSpeed: cal.playbackSpeed || updatedShots[shotIndex].playbackSpeed,
                cameraAngle: cal.cameraAngle || updatedShots[shotIndex].cameraAngle,
                focalLength: cal.focalLength || updatedShots[shotIndex].focalLength,
                photographyTechnique: cal.photographyTechnique || updatedShots[shotIndex].photographyTechnique,
                specialTechnique: cal.specialTechnique || updatedShots[shotIndex].specialTechnique,
              };
              calibratedCount++;
            }
          }
        }
      }
    }
    
    onProgress?.(calibratedCount, totalShots, `Calibrated ${calibratedCount}/${totalShots} shots`);
    
    // Save updated shots
    store.setShots(projectId, updatedShots);
    
    return {
      success: true,
      calibratedCount,
      totalShots,
    };
  } catch (error) {
    console.error('[calibrateShots] Error:', error);
    return {
      success: false,
      calibratedCount: 0,
      totalShots,
      error: error instanceof Error ? error.message : 'Shot calibration failed',
    };
  }
}

/**
 * AI calibrate single shot: For trailer Tab to calibrate individual shots
 */
export async function calibrateSingleShot(
  shotId: string,
  projectId: string,
  options: ShotCalibrationOptions,
  onProgress?: (message: string) => void
): Promise<ShotCalibrationResult> {
  const store = useScriptStore.getState();
  const project = store.projects[projectId];
  
  if (!project) {
    return { success: false, calibratedCount: 0, totalShots: 1, error: 'Project does not exist' };
  }
  
  const scriptData = project.scriptData;
  if (!scriptData) {
    return { success: false, calibratedCount: 0, totalShots: 1, error: t('lib.error.scriptDataNotFound') };
  }
  
  // Find target shot
  const shot = project.shots.find(s => s.id === shotId);
  if (!shot) {
    return { success: false, calibratedCount: 0, totalShots: 1, error: t('lib.error.noShotsToCalibrate', { shotId }) };
  }

  onProgress?.(`Calibrating shot...`);
  
  // Get scene and episode info for the shot
  const scene = scriptData.scenes.find(s => s.id === shot.sceneRefId);
  const episode = scriptData.episodes.find(ep => ep.id === shot.episodeId);
  const episodeIndex = episode?.index || 1;
  
  // Get global background info
  const background = project.projectBackground;
  const episodeScript = project.episodeRawScripts.find(ep => ep.episodeIndex === episodeIndex);
  const episodeRawContent = episodeScript?.rawContent || '';
  
  const globalContext = {
    title: background?.title || scriptData?.title || 'Untitled Script',
    genre: background?.genre || '',
    era: background?.era || '',
    outline: background?.outline || '',
    characterBios: background?.characterBios || '',
    worldSetting: background?.worldSetting || '',
    themes: background?.themes || [],
    episodeTitle: episode?.title || `Episode ${episodeIndex}`,
    episodeSynopsis: episodeScript?.synopsis || '',
    episodeKeyEvents: episodeScript?.keyEvents || [],
    episodeRawContent,
    episodeSeason: episodeScript?.season,
    totalEpisodes: project.episodeRawScripts.length,
    currentEpisode: episodeIndex,
  };
  
  try {
    // Prepare shot data
    let sourceText = shot.actionSummary || '';
    if (shot.dialogue) {
      sourceText += `\nDialogue: "${shot.dialogue}"`;
    }

    // Find scene weather
    let sceneWeather = '';
    if (episodeScript?.scenes) {
      for (const rawScene of episodeScript.scenes) {
        if (rawScene.weather && scene?.location && rawScene.sceneHeader.includes(scene.location.replace(/\s+/g, ''))) {
          sceneWeather = rawScene.weather;
          break;
        }
      }
    }
    
    const shotData = [{
      shotId: shot.id,
      sourceText,
      actionSummary: shot.actionSummary || '',
      dialogue: shot.dialogue,
      characterNames: shot.characterNames,
      sceneLocation: scene?.location || '',
      sceneAtmosphere: scene?.atmosphere || '',
      sceneTime: scene?.time || 'day',
      sceneWeather,
      // Scene art design fields (from AI scene calibration)
      architectureStyle: scene?.architectureStyle || '',
      colorPalette: scene?.colorPalette || '',
      eraDetails: scene?.eraDetails || '',
      lightingDesign: scene?.lightingDesign || '',
      currentShotSize: shot.shotSize,
      currentCameraMovement: shot.cameraMovement,
      currentDuration: shot.duration,
    }];
    
    // Call AI calibration
    const calibrations = await callAIForShotCalibration(shotData, options, globalContext);
    const calibration = calibrations[shot.id];

    if (!calibration) {
      return { success: false, calibratedCount: 0, totalShots: 1, error: 'AI calibration returned no results' };
    }
    
    // Update shots
    const updatedShots: Shot[] = project.shots.map(s => {
      if (s.id !== shot.id) return s;
      return {
        ...s,
        visualDescription: calibration.visualDescription || s.visualDescription,
        visualPrompt: calibration.visualPrompt || s.visualPrompt,
        shotSize: calibration.shotSize || s.shotSize,
        cameraMovement: calibration.cameraMovement || s.cameraMovement,
        duration: calibration.duration || s.duration,
        emotionTags: calibration.emotionTags || s.emotionTags,
        characterNames: calibration.characterNames?.length > 0 ? calibration.characterNames : s.characterNames,
        ambientSound: calibration.ambientSound || s.ambientSound,
        soundEffect: calibration.soundEffect || s.soundEffect,
        // Three-tier prompt system
        imagePrompt: calibration.imagePrompt || s.imagePrompt,
        imagePromptZh: calibration.imagePromptZh || s.imagePromptZh,
        videoPrompt: calibration.videoPrompt || s.videoPrompt,
        videoPromptZh: calibration.videoPromptZh || s.videoPromptZh,
        endFramePrompt: calibration.endFramePrompt || s.endFramePrompt,
        endFramePromptZh: calibration.endFramePromptZh || s.endFramePromptZh,
        needsEndFrame: calibration.needsEndFrame ?? s.needsEndFrame,
        // Narrative-driven fields
        narrativeFunction: calibration.narrativeFunction || s.narrativeFunction,
        shotPurpose: calibration.shotPurpose || s.shotPurpose,
        visualFocus: calibration.visualFocus || s.visualFocus,
        cameraPosition: calibration.cameraPosition || s.cameraPosition,
        characterBlocking: calibration.characterBlocking || s.characterBlocking,
        rhythm: calibration.rhythm || s.rhythm,
        // Shooting control fields
        lightingStyle: calibration.lightingStyle || s.lightingStyle,
        lightingDirection: calibration.lightingDirection || s.lightingDirection,
        colorTemperature: calibration.colorTemperature || s.colorTemperature,
        lightingNotes: calibration.lightingNotes || s.lightingNotes,
        depthOfField: calibration.depthOfField || s.depthOfField,
        focusTarget: calibration.focusTarget || s.focusTarget,
        focusTransition: calibration.focusTransition || s.focusTransition,
        cameraRig: calibration.cameraRig || s.cameraRig,
        movementSpeed: calibration.movementSpeed || s.movementSpeed,
        atmosphericEffects: calibration.atmosphericEffects || s.atmosphericEffects,
        effectIntensity: calibration.effectIntensity || s.effectIntensity,
        playbackSpeed: calibration.playbackSpeed || s.playbackSpeed,
        cameraAngle: calibration.cameraAngle || s.cameraAngle,
        focalLength: calibration.focalLength || s.focalLength,
        photographyTechnique: calibration.photographyTechnique || s.photographyTechnique,
        specialTechnique: calibration.specialTechnique || s.specialTechnique,
      } as Shot;
    });

    store.setShots(projectId, updatedShots);
    onProgress?.(`Shot calibration complete`);

    return {
      success: true,
      calibratedCount: 1,
      totalShots: 1,
    };
  } catch (error) {
    console.error('[calibrateSingleShot] Error:', error);
    return {
      success: false,
      calibratedCount: 0,
      totalShots: 1,
      error: error instanceof Error ? error.message : 'Single shot calibration failed',
    };
  }
}

/**
 * Call AI API to calibrate shots - reuse callChatAPI
 */
async function callAIForShotCalibration(
  shots: Array<{
    shotId: string;
    sourceText: string;        // Raw script text fragment (original text corresponding to this shot)
    actionSummary: string;
    dialogue?: string;
    characterNames?: string[];
    sceneLocation: string;
    sceneAtmosphere: string;
    sceneTime: string;
    sceneWeather?: string;        // Weather (rain/snow/fog, etc.)
    // Scene art design fields (aligned with ScriptScene field names)
    architectureStyle?: string;   // Architecture style
    colorPalette?: string;        // Color palette
    eraDetails?: string;          // Era details
    lightingDesign?: string;      // Lighting design
    currentShotSize?: string;
    currentCameraMovement?: string;
    currentDuration?: number;
  }>,
  options: ShotCalibrationOptions,
  globalContext: {
    title: string;
    genre?: string;
    era?: string;
    outline: string;
    characterBios: string;
    worldSetting?: string;
    themes?: string[];
    episodeTitle: string;
    episodeSynopsis?: string;  // Episode synopsis
    episodeKeyEvents?: string[];  // Key events
    episodeRawContent?: string;  // Raw script content for this episode
    episodeSeason?: string;      // Season of this episode
    totalEpisodes?: number;
    currentEpisode?: number;
  }
): Promise<Record<string, {
  visualDescription: string;
  visualPrompt: string;
  // Three-tier prompt system
  imagePrompt: string;      // First frame prompt (static description)
  imagePromptZh: string;    // First frame prompt in Chinese
  videoPrompt: string;      // Video prompt (dynamic action)
  videoPromptZh: string;    // Video prompt in Chinese
  endFramePrompt: string;   // End frame prompt (static description)
  endFramePromptZh: string; // End frame prompt in Chinese
  needsEndFrame: boolean;   // Whether end frame is needed
  shotSize: string;
  cameraMovement: string;
  duration: number;         // Duration (seconds)
  emotionTags: string[];    // Emotion tags
  characterNames: string[]; // Full character list
  ambientSound: string;     // Ambient sound
  soundEffect: string;      // Sound effect
  // === Narrative-driven fields (based on "Grammar of Film Language") ===
  narrativeFunction: string;  // Narrative function: setup/rise/climax/turn/transition/epilogue
  shotPurpose: string;        // Shot purpose: why use this shot
  visualFocus: string;        // Visual focus: what should the audience look at
  cameraPosition: string;     // Camera position description
  characterBlocking: string;  // Character blocking
  rhythm: string;             // Rhythm description
  // === Shooting Control Fields ===
  lightingStyle?: string;
  lightingDirection?: string;
  colorTemperature?: string;
  lightingNotes?: string;
  depthOfField?: string;
  focusTarget?: string;
  focusTransition?: string;
  cameraRig?: string;
  movementSpeed?: string;
  atmosphericEffects?: string[];
  effectIntensity?: string;
  playbackSpeed?: string;
  cameraAngle?: string;
  focalLength?: string;
  photographyTechnique?: string;
  specialTechnique?: string;
}>> {
  // No longer need apiKey/provider/baseUrl, config obtained uniformly from service mapping
  const { styleId, cinematographyProfileId } = options;
  const {
    title, genre, era, outline, characterBios, worldSetting, themes,
    episodeTitle, episodeSynopsis, episodeKeyEvents,
    episodeSeason, totalEpisodes, currentEpisode
  } = globalContext;

  // Use shared style description function
  const styleDesc = getStyleDescription(styleId || 'cinematic');
  
  // Cinematography profile guidance text
  const cinematographyGuidance = cinematographyProfileId
    ? buildCinematographyGuidance(cinematographyProfileId)
    : '';
  
  // Build more complete context information
  const contextInfo = [
    `Title: "${title}"`,
    genre ? `Genre: ${genre}` : '',
    era ? `Era: ${era}` : '',
    totalEpisodes ? `Total Episodes: ${totalEpisodes}` : '',
    `Current: Episode ${currentEpisode} "${episodeTitle}"`,
    episodeSeason ? `Season: ${episodeSeason}` : '',
  ].filter(Boolean).join(' | ');

  const systemPrompt = `You are a world-class master cinematographer, proficient in all theories from Daniel Arijon's "Grammar of Film Language," with Academy Award Best Cinematography experience.

Your Core Philosophy: **Shots are not isolated images, but links in the narrative chain. Each shot's scale, movement, and duration must serve the narrative.**

Your Professional Skills:
- Master of visual language: Accurately judge each shot's scale, movement style, and lighting design
- **Narrative-driven design**: Understand each shot's position and function in the entire episode story, ensuring shot design serves the narrative
- Blocking: Use triangle principle, over-the-shoulder shots, and other techniques for dialogue scenes
- Motion capture: Accurately judge whether a shot's start and end states have significant differences
- AI video generation experience: Deep understanding of Seedance, Sora, Runway, and other AI video models' working principles

Your task is to generate professional visual descriptions and three-tier prompts for each shot based on the script's global background and shot information.

[Script Information]
${contextInfo}
${episodeSynopsis ? `
Episode Synopsis: ${episodeSynopsis}` : ''}
${episodeKeyEvents && episodeKeyEvents.length > 0 ? `
Key Events: ${episodeKeyEvents.join(', ')}` : ''}
${worldSetting ? `
World Setting: ${worldSetting.slice(0, 200)}` : ''}
${themes && themes.length > 0 ? `
Themes: ${themes.join(', ')}` : ''}
${outline ? `
Story Background: ${outline.slice(0, 400)}` : ''}
${characterBios ? `
Main Characters: ${characterBios.slice(0, 400)}` : ''}

[⚠️ Core Principles - Must Strictly Follow]

1. **Absolute Scene Fixity** (Most Important!):
   - Each shot has a [Main Scene] (specified by sceneLocation field), which is **absolutely unchangeable**
   - Even if the shot description mentions other scenes (flashback, overlay, memory, insert shot), the **main scene remains sceneLocation**
   - Flashback/overlay are "visual techniques within the current main scene," not scene changes
   - All descriptions you generate (visualDescription, imagePrompt, etc.) must be based on the **main scene as background**
   - If the original text contains flashback/overlay content, use "picture overlay," "picture-in-picture," "subjective memory" to describe, not as another scene
   - Example: Main scene is "Zhang Family Living Room," original text mentions "flashback to billiards hall," describe as "In Zhang Family Living Room, picture overlay of billiards hall memory scene"

2. **Strictly Based on Original Text**: Each shot comes with [Original Script Text], all your generated content must be completely based on that original text:
   - Visual descriptions must include all key elements mentioned in the original text (characters, actions, props, scene)
   - Do not add content not in the original text
   - Do not mix content from other shots
   - Do not omit important information from the original text

3. **Complete Character Recognition**: Appearing characters must be completely from the original text, listed in order of appearance
   - Example: Original text "Zhang Ming eating with parents" → characterNames: ["Zhang Ming", "Zhang Father", "Zhang Mother"]
   - Prohibit omitting characters, prohibit adding characters not in original text

4. **Chinese-English Separation**:
   - **Chinese fields** (visualDescription, ambientSound, soundEffect, imagePromptZh, videoPromptZh, endFramePromptZh): Must be pure Chinese
   - **English fields** (visualPrompt, imagePrompt, videoPrompt, endFramePrompt): Must be 100% pure English, absolutely no Chinese characters
   - If unsure how to translate a word, use English description or synonym, but never leave Chinese

5. **Duration Estimation**: Estimate reasonable shot duration (seconds) based on action complexity and dialogue length
   - Pure action without dialogue: 3-5 seconds
   - Short dialogue: 4-6 seconds
   - Longer dialogue: 6-10 seconds
   - Complex action sequence: 5-8 seconds

6. **Audio Design** (Must be in Chinese): Identify and output based on original text:
   - ambientSound (ambient sound): e.g., "birds chirping outside window," "restaurant ambient noise," "wind sound"
   - soundEffect (sound effect): e.g., "glass breaking sound," "footsteps," "door closing sound"

[Task]
Generate for each shot:

**Basic Fields:**
1. Chinese Visual Description (visualDescription): Detailed, visual **pure Chinese** description, must include all key elements from original text (environment, characters, actions, props)
2. English Visual Description (visualPrompt): **pure English** description for AI image generation, within 40 words
3. Shot Size (shotSize): ECU/CU/MCU/MS/MLS/LS/WS/FS
4. Camera Movement (cameraMovement): none/static/tracking/orbit/zoom-in/zoom-out/pan-left/pan-right/tilt-up/tilt-down/dolly-in/dolly-out/truck-left/truck-right/crane-up/crane-down/drone-aerial/360-roll
4b. Special Technique (specialTechnique): none/hitchcock-zoom/timelapse/crash-zoom-in/crash-zoom-out/whip-pan/bullet-time/fpv-shuttle/macro-closeup/first-person/slow-motion/probe-lens/spinning-tilt
5. Duration (duration): seconds, integer
6. Emotion Tags (emotionTags): 1-3 emotion tag IDs
7. Appearing Characters (characterNames): Complete character list, from original text
8. Ambient Sound (ambientSound): **Chinese**, inferred from scene
9. Sound Effect (soundEffect): **Chinese**, inferred from action

**Narrative-Driven Fields (Important! Must analyze based on episode synopsis):**
10. Narrative Function (narrativeFunction): setup/rise/climax/turn/transition/epilogue
11. Shot Purpose (shotPurpose): Why use this shot? One sentence explanation
12. Visual Focus (visualFocus): What order should the audience look? Use arrows to indicate
13. Camera Position (cameraPosition): Camera position relative to characters
14. Character Blocking (characterBlocking): Position relationships of characters in frame
15. Rhythm (rhythm): This shot's rhythmic feel

**Cinematography Control Fields:**
16. Lighting Style (lightingStyle): natural/high-key/low-key/silhouette/chiaroscuro/neon
17. Lighting Direction (lightingDirection): front/side/back/top/bottom/rim
18. Color Temperature (colorTemperature): warm-3200K/neutral-5600K/cool-7500K/mixed/golden-hour/blue-hour
19. Lighting Notes (lightingNotes): Free text, Chinese, supplement lighting details
20. Depth of Field (depthOfField): shallow/medium/deep/split-diopter
21. Focus Target (focusTarget): Free text, Chinese, describe focus subject
22. Focus Transition (focusTransition): none/rack-focus/pull-focus/follow-focus
23. Camera Rig (cameraRig): tripod/handheld/steadicam/dolly/crane/drone/gimbal/shoulder
24. Movement Speed (movementSpeed): static/slow/normal/fast/whip
25. Atmospheric Effects (atmosphericEffects): Array, multiple selections allowed, e.g., ["fog", "dust"] for weather/environment/artistic effects
26. Effect Intensity (effectIntensity): subtle/moderate/heavy
27. Playback Speed (playbackSpeed): slow-0.25x/slow-0.5x/normal/fast-1.5x/fast-2x/timelapse
28. Camera Angle (cameraAngle): eye-level/low-angle/high-angle/birds-eye/worms-eye/dutch-angle/over-shoulder/pov/aerial
29. Focal Length (focalLength): 14mm/18mm/24mm/28mm/35mm/50mm/85mm/100mm-macro/135mm/200mm
30. Photography Technique (photographyTechnique): long-exposure/double-exposure/high-speed/timelapse-photo/tilt-shift/silhouette/reflection/bokeh (leave empty if no special technique needed)

[Three-Tier Prompt System - Important]

[16. First Frame Prompt (imagePrompt/imagePromptZh): For AI image generation, describes complete static frame of video's first frame
    **Must include all following elements** (none can be missing):

    a) **Scene Environment**:
       - Location type (family restaurant/office/street, etc.)
       - Environment details (window view, interior decor, prop arrangement)
       - Time atmosphere (daytime/dusk/night, seasonal feel)

    b) **Lighting Design**:
       - Light source type (natural light/artificial light/mixed light)
       - Light quality (soft/hard/diffused)
       - Light shadow atmosphere (warm/cool tone/contrast)

    c) **Character Description** (must write for each appearing character):
       - Age group (youth/middle-aged/elderly)
       - Clothing overview (casual/formal/work wear, etc.)
       - Facial expression (nervous/serious/smile/worried)
       - Pose action (sitting/standing/leaning over/holding item)

    d) **Composition and Shot Size**:
       - Shot size description (medium shot three people/close-up half body/close-up face)
       - Character position relationships (left-center-right layout, front-back relationships)
       - Visual focus (where subject is in frame)

    e) **Important Props**:
       - Plot-critical props (certificate, item, food, etc.)
       - Prop state (holding/placed/displaying)

    f) **Image Style**:
       - Cinematic/realistic style/drama photo quality
       - Tone tendency (warm/cool/natural)

    - imagePromptZh: Pure Chinese, 60-100 characters, includes all above elements
    - imagePrompt: Pure English, 60-80 words, complete translation corresponding to Chinese content, suitable for AI image models

11. Video Prompt (videoPrompt/videoPromptZh): Describes dynamic content in video
    - **Must emphasize action** (verbs like "repeatedly watching," "nervously eating")
    - Screen action (character actions, object movement)
    - Camera movement description
    - Dialogue hints (if any)
    - videoPromptZh: Pure Chinese
    - videoPrompt: Pure English

[18. End Frame Prompt (endFramePrompt/endFramePromptZh): For AI image generation, describes complete static frame of video's last frame

    **Equally important as first frame! Must include all following elements** (none can be missing):

    a) **Scene Environment**: Keep same scene as first frame, but reflect changed state

    b) **Lighting Design**: Keep consistent with first frame (unless story has time change)

    c) **Character Description** (Key! Describe state after action completion):
       - Still include age, clothing
       - **New facial expression** (emotion after action completion)
       - **New pose position** (position after action completion)
       - New state of props

    d) **Composition and Shot Size**:
       - If there's camera movement, describe new shot size after movement ends
       - Character's new position relationships

    e) **Change Contrast** (Core!):
       - Clearly describe differences from first frame (position/action/expression/prop state)

    f) **Image Style**: Keep consistent with first frame

    - endFramePromptZh: Pure Chinese, 60-100 characters, includes all above elements
    - endFramePrompt: Pure English, 60-80 words, complete translation corresponding to Chinese content

19. Needs End Frame (needsEndFrame):
    **Must set to true**:
    - Character position changes (walking, standing up, sitting down, etc.)
    - Action sequences (picking up items, putting down things, etc.)
    - State changes (door opening/closing, item moving, etc.)
    - Camera movement (non-Static)
    - Item state changes (page turning, folding, etc.)

    **Can set to false**:
    - Pure dialogue (position unchanged)
    - Only subtle expression changes
    - Completely static shot

    **When unsure, set to true** (better to generate more than miss)

[Emotion Tag Options]
Basic emotions: happy, sad, angry, surprised, fearful, calm
Atmospheric emotions: tense, excited, mysterious, romantic, funny, touching
Tone emotions: serious, relaxed, playful, gentle, passionate, low

[Style Requirements]
${styleDesc}
${cinematographyGuidance ? `
${cinematographyGuidance}
` : ''}
${(() => {
  const mt = getMediaType(styleId || 'cinematic');
  return mt !== 'cinematic' ? `
[Media Type Constraints]
${getMediaTypeGuidance(mt)}
` : '';
})()}
Shot design principles:
- Emotional dialogue, inner activity: CU/ECU close-up shots
- Action scenes, chases: MS/WS + Tracking
- Scene establishment, transitions: WS/FS wide shots
- Tense confrontation: Quick shot changes
- Important objects/details: ECU close-ups

**Important: Use English for all fields!**
- All description fields should be in English
- All prompt fields should be in English

Please return in JSON format:
{
  "shots": {
    "shot_id_1": {
      "visualDescription": "Gardenias blooming outside window, at dining table John eating nervously with parents, father holding graduate certificate examining it repeatedly.",
      "visualPrompt": "Gardenias blooming outside window, at dining table John eating nervously with parents, father holding graduate certificate examining it repeatedly",
      "shotSize": "MS",
      "cameraMovement": "static",
      "specialTechnique": "none",
      "duration": 5,
      "emotionTags": ["tense", "serious"],
      "characterNames": ["John", "Father", "Mother"],
      "ambientSound": "Restaurant ambient sounds, light clinking of utensils",
      "soundEffect": "",
      "narrativeFunction": "setup",
      "shotPurpose": "Establish surface harmony but underlying tension in family, use graduation certificate to imply father's expectations for son",
      "visualFocus": "Gardenias outside window → John's tense face → Certificate in father's hands",
      "cameraPosition": "45 degrees behind John to the side, showing three-person relationship",
      "characterBlocking": "John (center) vs parents (both sides), forming enclosed feeling",
      "rhythm": "Slow, oppressive, creating tension beneath surface calm",
      "lightingStyle": "natural",
      "lightingDirection": "side",
      "colorTemperature": "warm-3200K",
      "lightingNotes": "Afternoon side light through window creates warm but oppressive light-dark contrast",
      "depthOfField": "medium",
      "focusTarget": "John's tense facial expression",
      "focusTransition": "rack-focus",
      "cameraRig": "tripod",
      "movementSpeed": "static",
      "atmosphericEffects": ["natural light spots"],
      "effectIntensity": "subtle",
      "playbackSpeed": "normal",
      "cameraAngle": "eye-level",
      "focalLength": "50mm",
      "photographyTechnique": "",
      "imagePrompt": "Cinematic medium shot, modern family dining room, warm afternoon sunlight through window with blooming gardenias outside, young man John (25, casual clothes, tense expression) sitting at dining table with his middle-aged parents, father (50s, stern face, holding graduate certificate examining it), mother (50s, worried look) beside them, wooden dining table with home-cooked dishes, warm color tones, realistic film style",
      "imagePromptZh": "",
      "videoPrompt": "Father repeatedly examining graduate certificate with focused attention, John eating nervously with utensils, occasionally glancing at father, mother sitting beside watching silently with worried expression",
      "videoPromptZh": "",
      "needsEndFrame": true,
      "endFramePrompt": "Cinematic medium shot, same modern family dining room, warm afternoon light. Father (50s) now lowering the certificate with satisfied yet stern expression, John (25) stopped eating and looking down nervously, mother (50s) glancing between husband and son with concern. Certificate now placed on table beside dishes, tense atmosphere, warm color tones, realistic film style",
      "endFramePromptZh": ""
    }
  }
}

**Special Notes**:
- Gardenias = gardenias
- visualDescription must be in English
- ambientSound/soundEffect must be in English`
  
  const shotDescriptions = shots.map(shot => {
    const chars = shot.characterNames?.join(', ') || 'None';
    // Detect if contains flashback/overlay content
    const sourceText = shot.sourceText || shot.actionSummary || '';
    const hasFlashback = /flashback|superimpose|memory|intercut/i.test(sourceText);
    const flashbackNote = hasFlashback
      ? `\n⚠️ Note: Original text contains flashback/overlay content, but main scene remains "${shot.sceneLocation}", do not describe as another scene!`
      : '';
    // Build scene art design info (if available)
    const artDesignParts = [
      shot.architectureStyle ? `Architecture Style: ${shot.architectureStyle}` : '',
      shot.colorPalette ? `Color Palette: ${shot.colorPalette}` : '',
      shot.eraDetails ? `Era Details: ${shot.eraDetails}` : '',
      shot.lightingDesign ? `Lighting Design: ${shot.lightingDesign}` : '',
    ].filter(Boolean);
    const artDesignSection = artDesignParts.length > 0
      ? `\n[🎨 Scene Art Design (Must Follow Strictly)]\n${artDesignParts.join('\n')}`
      : '';
    return `ID: ${shot.shotId}
[⭐ Main Scene (Cannot Be Changed)]: ${shot.sceneLocation}${flashbackNote}${artDesignSection}
[Original Script Text]
${sourceText}
[Parsed Information]
Action: ${shot.actionSummary}
Dialogue: ${shot.dialogue || 'None'}
Characters: ${chars}
Atmosphere: ${shot.sceneAtmosphere}
Time: ${shot.sceneTime}${shot.sceneWeather ? `
Weather: ${shot.sceneWeather}` : ''}
Current Shot Size: ${shot.currentShotSize || 'TBD'}
Current Camera Movement: ${shot.currentCameraMovement || 'TBD'}`;
  }).join('\n\n═══════════════════════════════════════\n\n');

  const userPrompt = `Please strictly generate calibration content based on each shot's [Original Script Text].

⚠️ Important Reminders (Must Follow):
1. **Absolute Scene Fixity**: Each shot's [Main Scene] is already marked, even if original text mentions flashback/overlay/memory, main scene remains unchanged
2. Do not omit any key information from original text (characters, actions, props, environment)
3. Do not add content not in original text
4. **All fields must be in English**: visualDescription, ambientSound, soundEffect, visualPrompt, imagePrompt, videoPrompt, endFramePrompt
5. Character list must be complete
6. Gardenias = gardenias (not peonies)

🎬 **Narrative-Driven Analysis (Based on "Grammar of Film Language")**:
- Judge each shot's narrative function in entire episode story based on [Episode Synopsis]
- Shot design must serve story's emotional rhythm and narrative arc
- Shot size selection should match narrative function (setup uses wide shot, climax uses close-up, etc.)
- Consider character blocking and camera position's impact on story tension

${shotDescriptions}` + getPromptLanguageSuffix();

  // Get config uniformly from service mapping (single shot calibration uses larger token budget)
  const result = await callFeatureAPI('script_analysis', systemPrompt, userPrompt, { maxTokens: 16384 });
  
  // Parse JSON result (enhanced version)
  try {
    let cleaned = result;
    
    // Remove markdown code block markers
    cleaned = cleaned.replace(/^```json\s*/i, '');
    cleaned = cleaned.replace(/^```\s*/i, '');
    cleaned = cleaned.replace(/\s*```$/i, '');
    cleaned = cleaned.trim();
    
    // Try to find JSON object start and end positions
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
    }
    
    const parsed = JSON.parse(cleaned);
    return parsed.shots || {};
  } catch (e) {
    console.error('[calibrateShots] Failed to parse AI response:', result);
    console.error('[calibrateShots] Parse error:', e);
    
    // Try partial parse: extract completed shots
    try {
      const partialResult: Record<string, Record<string, unknown>> = {};
      // Match complete JSON object for each shot
      const shotPattern = /"(shot_[^"]+)"\s*:\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})/g;
      let match;
      while ((match = shotPattern.exec(result)) !== null) {
        try {
          const shotId = match[1];
          const shotJson = match[2];
          partialResult[shotId] = JSON.parse(shotJson);
        } catch {
          // Single shot parse failed, continue to next
        }
      }

      if (Object.keys(partialResult).length > 0) {
        console.log(`[calibrateShots] Partial parse successful, recovered ${Object.keys(partialResult).length} shots`);
        return partialResult as Awaited<ReturnType<typeof callAIForShotCalibration>>;
      }
    } catch {
      // Partial parse also failed
    }

    throw new Error(t('lib.error.aiResponseParseFailed'));
  }
}

// ==================== AI Generate Episode Synopses ====================

export interface SynopsisGenerationResult {
  success: boolean;
  generatedCount: number;
  totalEpisodes: number;
  error?: string;
}

/**
 * AI generate episode synopses
 * Based on global background and each episode's content, generate concise episode synopses
 */
export async function generateEpisodeSynopses(
  projectId: string,
  _options?: CalibrationOptions, // No longer needed, kept for compatibility
  onProgress?: (current: number, total: number, message: string) => void
): Promise<SynopsisGenerationResult> {
  const store = useScriptStore.getState();
  const project = store.projects[projectId];
  
  if (!project) {
    return { success: false, generatedCount: 0, totalEpisodes: 0, error: t('lib.error.projectNotFound') };
  }
  
  const episodes = project.episodeRawScripts;
  const totalEpisodes = episodes.length;
  
  if (totalEpisodes === 0) {
    return { success: false, generatedCount: 0, totalEpisodes: 0, error: t('lib.error.noEpisodesData') };
  }
  
  // Get global background
  const background = project.projectBackground;
  const globalContext = {
    title: background?.title || project.scriptData?.title || 'Untitled Script',
    genre: background?.genre || '',
    era: background?.era || '',
    worldSetting: background?.worldSetting || '',
    themes: background?.themes || [],
    outline: background?.outline || '',
    characterBios: background?.characterBios || '',
    totalEpisodes,
  };
  
  onProgress?.(0, totalEpisodes, `Starting to generate synopses for ${totalEpisodes} episodes...`);
  
  try {
    // Prepare batch items
    type SynopsisItem = { index: number; title: string; contentSummary: string };
    type SynopsisResult = { synopsis: string; keyEvents: string[] };
    const items: SynopsisItem[] = episodes.map(ep => ({
      index: ep.episodeIndex,
      title: ep.title,
      contentSummary: extractEpisodeSummary(ep),
    }));
    
    const { results, failedBatches, totalBatches } = await processBatched<SynopsisItem, SynopsisResult>({
      items,
      feature: 'script_analysis',
      buildPrompts: (batch) => {
        const { title, genre, era, worldSetting, themes, outline, characterBios, totalEpisodes: total } = globalContext;
        const system = `You are a Hollywood script doctor, skilled at analyzing script structure and narrative pacing.

Your professional capabilities:
- Script structure analysis: Quickly extract core conflicts, turning points, and emotional climaxes of each episode
- Narrative rhythm control: Understand pacing characteristics of different genre series
- Key event extraction: Accurately identify key scenes and actions that drive plot development

Your task is to generate concise outlines and key events for each episode based on the global script background and each episode's content.

[Script Information]
Title: ${title}
Genre: ${genre || 'Unknown'}
${era ? `Era: ${era}` : ''}
${worldSetting ? `World Setting: ${worldSetting.slice(0, 200)}` : ''}
${themes && themes.length > 0 ? `Themes: ${themes.join(', ')}` : ''}
Total Episodes: ${total}

[Story Outline]
${outline.slice(0, 1000)}

[Main Characters]
${characterBios.slice(0, 800)}

[Requirements]
Generate for each episode:
1. synopsis: 100-200 word episode outline, summarizing main plot development
2. keyEvents: 3-5 key events, each 10-20 words

Notes:
- Outline should highlight core conflicts and turning points
- Key events should be specific and visualizable
- Maintain continuity between episodes

Return in JSON format:
{
  "synopses": {
    "1": {
      "synopsis": "Episode outline...",
      "keyEvents": ["Event 1", "Event 2", "Event 3"]
    }
  }
}` + getPromptLanguageSuffix();
        const episodeContents = batch.map(ep =>
          `Episode ${ep.index} "${ep.title}":\n${ep.contentSummary}`
        ).join('\n\n---\n\n');
        const user = `Please generate outline and key events for the following episodes:\n\n${episodeContents}`;
        return { system, user };
      },
      parseResult: (raw) => {
        const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(cleaned);
        const result = new Map<string, SynopsisResult>();
        if (parsed.synopses) {
          for (const [key, value] of Object.entries(parsed.synopses)) {
            const v = value as SynopsisResult;
            result.set(key, {
              synopsis: v.synopsis || '',
              keyEvents: v.keyEvents || [],
            });
          }
        }
        return result;
      },
      estimateItemOutputTokens: () => 200, // Synopsis + keyEvents about 200 tokens
      onProgress: (completed, total, message) => {
        onProgress?.(completed, total, `[Synopsis Generation] ${message}`);
      },
    });
    
    // Process results
    let generatedCount = 0;
    for (const ep of episodes) {
      const res = results.get(String(ep.episodeIndex));
      if (res) {
        store.updateEpisodeRawScript(projectId, ep.episodeIndex, {
          synopsis: res.synopsis,
          keyEvents: res.keyEvents,
          synopsisGeneratedAt: Date.now(),
        });
        generatedCount++;
      }
    }
    
    if (failedBatches > 0) {
      console.warn(`[Episode synopsis generation] ${failedBatches}/${totalBatches} batches failed`);
    }
    
    onProgress?.(generatedCount, totalEpisodes, `Generated ${generatedCount}/${totalEpisodes} episode synopses`);
    
    // Update project metadata MD after synopsis generation completes
    const updatedMetadata = exportProjectMetadata(projectId);
    store.setMetadataMarkdown(projectId, updatedMetadata);
    console.log('[generateSynopses] Metadata updated, including newly generated synopses');
    
    return {
      success: true,
      generatedCount,
      totalEpisodes,
    };
  } catch (error) {
    console.error('[generateSynopses] Error:', error);
    return {
      success: false,
      generatedCount: 0,
      totalEpisodes,
      error: error instanceof Error ? error.message : 'Synopsis generation failed',
    };
  }
}

// ==================== Export Project Metadata MD ====================

/**
 * Export project metadata to Markdown format
 * Similar to Cursor's .cursorrules, serves as project knowledge base
 */
export function exportProjectMetadata(projectId: string): string {
  const store = useScriptStore.getState();
  const project = store.projects[projectId];

  if (!project) {
    return '# Error\n\nProject does not exist';
  }
  
  const background = project.projectBackground;
  const episodes = project.episodeRawScripts;
  const scriptData = project.scriptData;
  
  const sections: string[] = [];
  
  // Title
  const title = background?.title || scriptData?.title || 'Untitled Script';
  sections.push(`# 《${title}》`);
  sections.push('');

  // Basic information
  sections.push('## Basic Information');
  if (background?.genre) sections.push(`- **Genre**: ${background.genre}`);
  if (background?.era) sections.push(`- **Era**: ${background.era}`);
  sections.push(`- **Total Episodes**: ${episodes.length}`);
  if (scriptData?.language) sections.push(`- **Language**: ${scriptData.language}`);
  sections.push('');

  // Story outline
  if (background?.outline) {
    sections.push('## Story Outline');
    sections.push(background.outline);
    sections.push('');
  }

  // World setting
  if (background?.worldSetting) {
    sections.push('## World/Style Setting');
    sections.push(background.worldSetting);
    sections.push('');
  }

  // Main characters
  if (background?.characterBios) {
    sections.push('## Main Characters');
    sections.push(background.characterBios);
    sections.push('');
  }

  // Character list (structured)
  if (scriptData?.characters && scriptData.characters.length > 0) {
    sections.push('## Character List');
    for (const char of scriptData.characters) {
      sections.push(`### ${char.name}`);
      if (char.gender) sections.push(`- Gender: ${char.gender}`);
      if (char.age) sections.push(`- Age: ${char.age}`);
      if (char.role) sections.push(`- Role: ${char.role}`);
      if (char.personality) sections.push(`- Personality: ${char.personality}`);
      if (char.traits) sections.push(`- Traits: ${char.traits}`);
      if (char.relationships) sections.push(`- Relationships: ${char.relationships}`);
      sections.push('');
    }
  }

  // Episode synopses
  sections.push('## Episode Synopses');
  for (const ep of episodes) {
    sections.push(`### Episode ${ep.episodeIndex}: ${ep.title.replace(/^Episode \d+[: ]?/, '')}`);
    if (ep.synopsis) {
      sections.push(ep.synopsis);
    }
    if (ep.keyEvents && ep.keyEvents.length > 0) {
      sections.push('**Key Events:**');
      for (const event of ep.keyEvents) {
        sections.push(`- ${event}`);
      }
    }
    // Show scene count
    sections.push(`> This episode contains ${ep.scenes.length} scenes`);
    sections.push('');
  }

  // Export time
  sections.push('---');
  sections.push(`*Exported: ${new Date().toLocaleString('en-US')}*`);
  
  return sections.join('\n');
}

/**
 * Get episodes missing synopses
 */
export function getMissingSynopsisEpisodes(projectId: string): EpisodeRawScript[] {
  const store = useScriptStore.getState();
  const project = store.projects[projectId];
  
  if (!project || !project.episodeRawScripts.length) {
    return [];
  }
  
  return project.episodeRawScripts.filter(ep => !ep.synopsis || ep.synopsis.trim() === '');
}
