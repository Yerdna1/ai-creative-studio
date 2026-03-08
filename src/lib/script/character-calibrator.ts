// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * AI Character Calibrator
 *
 * Use AI to intelligently calibrate character lists extracted from scripts
 *
 * Features:
 * 1. Count each character's appearance count, dialogue count, episode appearances
 * 2. AI analysis to identify real characters vs non-character words
 * 3. AI merge duplicate characters (e.g., President Wang = Investor President Wang)
 * 4. AI classify protagonist/supporting/minor/extra (based on appearance statistics)
 * 5. AI supplement character information (age, gender, relationships)
 */

import type { ScriptCharacter, ProjectBackground, EpisodeRawScript, CharacterIdentityAnchors, CharacterNegativePrompt } from '@/types/script';
import { callFeatureAPI } from '@/lib/ai/feature-router';
import { processBatched } from '@/lib/ai/batch-processor';
import { estimateTokens, safeTruncate } from '@/lib/ai/model-registry';
import { getPromptLanguageSuffix } from './prompt-language';

// ==================== Type Definitions ====================

export interface CharacterCalibrationResult {
  /** Calibrated character list */
  characters: CalibratedCharacter[];
  /** Filtered words (non-characters) */
  filteredWords: string[];
  /** Merge records (which were merged together) */
  mergeRecords: MergeRecord[];
  /** AI analysis notes */
  analysisNotes: string;
}

export interface CalibratedCharacter {
  id: string;
  name: string;
  /** Character importance: protagonist, supporting, minor, extra */
  importance: 'protagonist' | 'supporting' | 'minor' | 'extra';
  /** Episode range where character appears */
  episodeRange?: [number, number];
  /** Appearance count */
  appearanceCount: number;
  /** AI-supplemented character description */
  role?: string;
  /** AI-inferred age */
  age?: string;
  /** AI-inferred gender */
  gender?: string;
  /** Relationships with other characters */
  relationships?: string;
  /** Original extracted name variants */
  nameVariants: string[];
  // === Professional character design fields ===
  /** English visual prompt (for AI image generation) */
  visualPromptEn?: string;
  /** Chinese visual prompt */
  visualPromptZh?: string;
  /** Facial features description */
  facialFeatures?: string;
  /** Unique marks (scars, birthmarks, etc.) */
  uniqueMarks?: string;
  /** Clothing style */
  clothingStyle?: string;

  // === 6-layer identity anchors (character consistency) ===
  /** Identity anchor - 6-layer feature lock */
  identityAnchors?: CharacterIdentityAnchors;
  /** Negative prompt */
  negativePrompt?: CharacterNegativePrompt;
}

export interface MergeRecord {
  /** Final name used */
  finalName: string;
  /** Variants that were merged */
  variants: string[];
  /** Reason for merge */
  reason: string;
}

export interface CalibrationOptions {
  /** Previous calibration character list, for merging to ensure no characters are lost */
  previousCharacters?: CalibratedCharacter[];
}

// ==================== Extract Characters from Scripts ====================

/**
 * Re-extract all characters from episodeRawScripts
 * This traverses all episodes and all scenes, extracting scene characters and dialogue speakers
 */
export function extractAllCharactersFromEpisodes(
  episodeScripts: EpisodeRawScript[]
): ScriptCharacter[] {
  const characterSet = new Set<string>();

  if (!episodeScripts || !Array.isArray(episodeScripts)) {
    console.warn('[extractAllCharactersFromEpisodes] Invalid episodeScripts');
    return [];
  }

  // Traverse all episodes
  for (const ep of episodeScripts) {
    if (!ep || !ep.scenes) continue;

    for (const scene of ep.scenes) {
      if (!scene) continue;

      // Extract from scene character list
      const sceneChars = scene.characters || [];
      for (const name of sceneChars) {
        if (name && name.trim()) {
          characterSet.add(name.trim());
        }
      }

      // Extract speakers from dialogue
      const dialogues = scene.dialogues || [];
      for (const dialogue of dialogues) {
        if (dialogue && dialogue.character && dialogue.character.trim()) {
          characterSet.add(dialogue.character.trim());
        }
      }
    }
  }

  // Convert to ScriptCharacter array
  const characters: ScriptCharacter[] = Array.from(characterSet).map((name, index) => ({
    id: `char_raw_${index + 1}`,
    name,
  }));

  console.log(`[extractAllCharactersFromEpisodes] Extracted ${characters.length} characters from ${episodeScripts.length} episode scripts`);
  return characters;
}

// ==================== Appearance Statistics ====================

/** Character appearance statistics */
export interface CharacterStats {
  name: string;
  /** Scene appearance count */
  sceneCount: number;
  /** Dialogue count */
  dialogueCount: number;
  /** List of episode numbers where character appears */
  episodes: number[];
  /** First appearance episode */
  firstEpisode: number;
  /** Last appearance episode */
  lastEpisode: number;
  /** Dialogue samples (first 3) */
  dialogueSamples: string[];
  /** Scene appearance samples */
  sceneSamples: string[];
}

/**
 * Collect appearance statistics for each character
 */
export function collectCharacterStats(
  characterNames: string[],
  episodeScripts: EpisodeRawScript[]
): Map<string, CharacterStats> {
  const stats = new Map<string, CharacterStats>();

  // Defensive checks
  if (!characterNames || !Array.isArray(characterNames)) {
    console.warn('[collectCharacterStats] Invalid characterNames');
    return stats;
  }
  if (!episodeScripts || !Array.isArray(episodeScripts)) {
    console.warn('[collectCharacterStats] Invalid episodeScripts');
    return stats;
  }

  // Initialize
  for (const name of characterNames) {
    if (!name) continue;
    stats.set(name, {
      name,
      sceneCount: 0,
      dialogueCount: 0,
      episodes: [],
      firstEpisode: Infinity,
      lastEpisode: 0,
      dialogueSamples: [],
      sceneSamples: [],
    });
  }

  // Traverse all scripts
  for (const ep of episodeScripts) {
    if (!ep || !ep.scenes) continue;
    const epIndex = ep.episodeIndex ?? 0;

    for (const scene of ep.scenes) {
      if (!scene) continue;

      // Check scene characters
      const sceneChars = scene.characters || [];
      for (const charName of sceneChars) {
        if (!charName) continue;
        // Exact match or contains match
        for (const name of characterNames) {
          if (!name) continue;
          if (charName === name || charName.includes(name) || name.includes(charName)) {
            const s = stats.get(name);
            if (!s) continue;
            s.sceneCount++;
            if (!s.episodes.includes(epIndex)) {
              s.episodes.push(epIndex);
            }
            s.firstEpisode = Math.min(s.firstEpisode, epIndex);
            s.lastEpisode = Math.max(s.lastEpisode, epIndex);
            if (s.sceneSamples.length < 3) {
              s.sceneSamples.push(`Ep ${epIndex}: ${scene.sceneHeader || 'Unknown scene'}`);
            }
          }
        }
      }

      // Check dialogue
      const dialogues = scene.dialogues || [];
      for (const dialogue of dialogues) {
        if (!dialogue || !dialogue.character) continue;
        for (const name of characterNames) {
          if (!name) continue;
          if (dialogue.character === name || dialogue.character.includes(name)) {
            const s = stats.get(name);
            if (!s) continue;
            s.dialogueCount++;
            if (s.dialogueSamples.length < 3) {
              const line = dialogue.line || '';
              s.dialogueSamples.push(`${dialogue.character}: ${line.slice(0, 30)}...`);
            }
          }
        }
      }
    }
  }

  // Fix Infinity
  for (const s of stats.values()) {
    if (s.firstEpisode === Infinity) s.firstEpisode = 0;
  }

  return stats;
}

// ==================== Core Functions ====================

/**
 * Use AI to calibrate character list
 *
 * @param rawCharacters Original extracted character list
 * @param background Project background (outline)
 * @param episodeScripts Episode scripts (provide context)
 * @param options API configuration
 */
export async function calibrateCharacters(
  rawCharacters: ScriptCharacter[],
  background: ProjectBackground,
  episodeScripts: EpisodeRawScript[],
  options?: CalibrationOptions
): Promise<CharacterCalibrationResult> {
  const previousCharacters = options?.previousCharacters;

  // 1. First, collect appearance statistics for each character
  const characterNames = rawCharacters.map(c => c.name);
  const stats = collectCharacterStats(characterNames, episodeScripts);

  // 2. Build character list with statistics, sorted by intelligent priority
  const charsWithStats = rawCharacters.map(c => {
    const s = stats.get(c.name);
    const name = c.name;
    const hasSpecificName = (
      (name.length >= 2 && name.length <= 4) ||
      /^[A-Z][a-z]+$/.test(name) // English name
    );

    // Determine if this is a group extra (pure professional title, number designation, group description)
    const isGroupExtra = [
      'Security', 'Police', 'Employee', 'Nurse', 'Doctor', 'Reporter',
      'Lawyer', 'Passerby', 'Crowd', 'Group', 'People', 'Auntie',
    ].some(keyword =>
      name === keyword ||
      name === keyword + '1' ||
      name === keyword + '2' ||
      name.startsWith('Several') ||
      name.startsWith('Two') ||
      name.startsWith('Some')
    );

    return {
      name: c.name,
      sceneCount: s?.sceneCount || 0,
      dialogueCount: s?.dialogueCount || 0,
      episodeCount: s?.episodes.length || 0,
      isGroupExtra,
      hasSpecificName,
      // Intelligent priority: named characters first, then by appearance count
      priority: isGroupExtra ? -1000 : // Group extras lowest
                hasSpecificName ? 1000 + (s?.sceneCount || 0) + (s?.dialogueCount || 0) : // Named characters first
                (s?.sceneCount || 0) + (s?.dialogueCount || 0), // Unnamed by appearance count
    };
  }).sort((a, b) => b.priority - a.priority);

  // Limit number of characters sent to AI to avoid output truncation
  // Prioritize keeping named characters
  const maxCharsToSend = 150;
  const charsToProcess = charsWithStats.slice(0, maxCharsToSend);

  // 3. Prepare batch items (each character with statistics and dialogue samples)
  const batchItems = charsToProcess.map(c => ({
    name: c.name,
    sceneCount: c.sceneCount,
    dialogueCount: c.dialogueCount,
    episodeCount: c.episodeCount,
    dialogueSamples: stats.get(c.name)?.dialogueSamples || [],
  }));

  // Calculate total scene count for determining 10% threshold for core protagonists
  let totalSceneCount = 0;
  for (const ep of episodeScripts) {
    if (ep?.scenes) totalSceneCount += ep.scenes.length;
  }
  const coreThreshold = Math.max(Math.floor(totalSceneCount * 0.1), 10);
  
  const systemPrompt = `You are a professional film and television script analyst, skilled at identifying and calibrating characters from script data.

【Core Objective】
The calibrated character list will be used to generate character reference images.
- **Lenient retention: Keep all characters with names or titles**
- **Strict filtering: Only filter pure extras, groups, non-character words**

【Strict Execution - Retention Rules】

**1. Core Protagonist (protagonist)** - Must keep
   - Clear name, high appearance count, appears throughout the series
   - Examples: Zhang Ming, Lao Zhou, Su Qing

**2. Important Supporting (supporting)** - Must keep
   - Specific names or nicknames: Scar Brother, Dragon Brother, Li Qiang, Wang Yan, Xiao Le, Ah Qiang
   - Fixed titles: Director Lai, President Wang, President Zhou, Dr. Li
   - Appearance >=1 with dialogue, or appearance >=2

**3. Minor Character (minor)** - Must keep
   - Specific name, occasional appearances
   - Has some plot relevance
   - **Keep named characters even if they only appear once!**

**4. Extra/Background (extra)** - Try to keep
   - Has title but very few appearances, mark as extra
   - Examples: Old Man Li, Xiao Liu, Auntie Wang

【Extremely Important - Lenient Filtering Principle】
- **Keep all with names!** (Even if only appearing once)
- **Keep all with titles!** (e.g., Lao [X], Xiao [X], [X] Brother, [X] Sister, [X] President, [X] Director)
- **When in doubt, keep!** (Better to keep more than miss any)

【Strict Filtering - Only Filter These】

**Must filter (nameless pure extras):**
- Pure profession terms: Security, Police, Nurse, Doctor, Reporter, Employee, Lawyer, Waiter, Driver
- Number designations: Security 1, Police 2, Nurse 3, Employee A
- Group terms: Several people, Crowd, A few security guards, Two aunties, A group of people
- Non-character terms: All employees, Security Department, Core Team
- Descriptive terms: Slightly teary eyes, Capable and elegant, Calm gaze

**Must NOT filter:**
- Any with names: Zhang Ming, Li Qiang, Wang Yan, Lin Feng, Mark
- Any with nicknames: Scar Brother, Dragon Brother, Xiao Le, Ah Qiang, Old Li, Xiao Liu
- Surname + profession: Director Lai, President Wang, President Zhou, Dr. Li, Secretary Zhang, Master Lin
- Surname + title: Old Man Li, Auntie Wang, Sister Zhou

【Merge Rules】
Only merge different titles that are clearly the same person:
- Example: "President Wang" and "Investor President Wang" → Merge to "President Wang"
- Example: "Scar Brother" and "Li Qiang" if plot clearly indicates same person → Merge

【Quantity Constraints】
- Protagonists: 1-3
- Supporting: 5-30 (keep all with names, don't limit)
- Total characters: Suggest 15-40, better more than less

Please return analysis results in JSON format.` + getPromptLanguageSuffix();

  // Shared background context (included with every batch, truncated with safeTruncate)
  const outlineContext = safeTruncate(background.outline || '', 1500);
  const biosContext = safeTruncate(background.characterBios || '', 1000);

  // === Step 1: AI Character Analysis (automatic batching) ===
  let parsed: {
    characters: Array<{
      name: string;
      importance: string;
      appearanceCount: number;
      dialogueCount?: number;
      episodeSpan?: number[];
      role?: string;
      age?: string;
      gender?: string;
      relationships?: string;
    }>;
    filteredWords: string[];
    mergeRecords: Array<{
      finalName: string;
      variants: string[];
      reason: string;
    }>;
    analysisNotes: string;
  };
  try {
    console.log('[CharacterCalibrator] Starting AI character analysis...');

    // Closure to collect cross-batch aggregated fields
    const allFilteredWords: string[] = [];
    const allMergeRecords: MergeRecord[] = [];
    const allAnalysisNotes: string[] = [];
    
    const { results: charResults, failedBatches } = await processBatched<
      typeof batchItems[number],
      {
        name: string;
        importance?: string;
        appearanceCount?: number;
        dialogueCount?: number;
        episodeSpan?: number[];
        role?: string;
        age?: string;
        gender?: string;
        relationships?: string;
      }
    >({
      items: batchItems,
      feature: 'script_analysis',
      buildPrompts: (batch) => {
        // Build independent character list and dialogue samples for each batch
        const charList = batch.map((c, i) => {
          if (c.sceneCount === 0 && c.dialogueCount === 0) {
            return `${i + 1}. ${c.name} [No appearances recorded]`;
          }
          return `${i + 1}. ${c.name} [Appears in ${c.sceneCount} scenes, ${c.dialogueCount} dialogue lines, ${c.episodeCount} episodes]`;
        }).join('\n');

        const batchDialogues: string[] = [];
        for (const c of batch) {
          if (c.dialogueSamples.length > 0) {
            batchDialogues.push(`[${c.name}]`);
            batchDialogues.push(...c.dialogueSamples);
          }
        }

        const user = `【Script Information】
Title: "${background.title}"
${background.genre ? `Genre: ${background.genre}` : ''}
${background.era ? `Era: ${background.era}` : ''}
${background.timelineSetting ? `Timeline: ${background.timelineSetting}` : ''}
Total Episodes: ${episodeScripts.length}
Total Scenes: ${totalSceneCount}
Core Protagonist Threshold: Appears in >= ${coreThreshold} scenes

【Story Outline】
${outlineContext || 'None'}

【Character Biographies】
${biosContext || 'None'}

【Character List to Calibrate + Appearance Statistics】(Total: ${batch.length})
${charList}

【Character Dialogue Samples】
${batchDialogues.slice(0, 100).join('\n')}

Please calibrate characters according to classification rules, return JSON format:
{
  "characters": [
    {
      "name": "Character Name",
      "importance": "protagonist/supporting/minor/extra",
      "appearanceCount": 150,
      "dialogueCount": 200,
      "episodeSpan": [1, 60],
      "role": "Character description",
      "age": "Age",
      "gender": "Gender",
      "relationships": "Relationships"
    }
  ],
  "filteredWords": ["filtered non-character words"],
  "mergeRecords": [
    { "finalName": "final name", "variants": ["variant1", "variant2"], "reason": "reason" }
  ],
  "analysisNotes": "analysis notes"
}

【Extremely Important! Please Pay Special Attention】
1. Keep all with names! Keep all with titles! Keep when uncertain!
2. Only filter pure profession terms, number designations, group terms
3. Do not generate "extras group" labels`;
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
        
        let batchParsed: {
          characters?: Array<{
            name: string;
            importance: string;
            appearanceCount: number;
            dialogueCount?: number;
            episodeSpan?: number[];
            role?: string;
            age?: string;
            gender?: string;
            relationships?: string;
          }>;
          filteredWords?: string[];
          mergeRecords?: Array<{
            finalName: string;
            variants: string[];
            reason: string;
          }>;
          analysisNotes?: string;
        };
        try {
          batchParsed = JSON.parse(cleaned);
        } catch (jsonErr) {
          console.warn('[CharacterCalibrator] Batch JSON parsing failed, attempting repair...');
          const lastCompleteChar = cleaned.lastIndexOf('},');
          if (lastCompleteChar > 0) {
            const truncated = cleaned.slice(0, lastCompleteChar + 1);
            const fixedJson = truncated + '],"filteredWords":[],"mergeRecords":[],"analysisNotes":"Partial results"}';
            try {
              batchParsed = JSON.parse(fixedJson);
            } catch {
              const charsMatch = cleaned.match(/"characters"\s*:\s*\[(.*?)\]/s);
              if (charsMatch) {
                try {
                  const charsArray = JSON.parse('[' + charsMatch[1] + ']');
                  batchParsed = { characters: charsArray, filteredWords: [], mergeRecords: [], analysisNotes: 'Partial results' };
                } catch {
                  throw jsonErr;
                }
              } else {
                throw jsonErr;
              }
            }
          } else {
            throw jsonErr;
          }
        }

        // Collect aggregated fields
        allFilteredWords.push(...(batchParsed.filteredWords || []));
        allMergeRecords.push(...(batchParsed.mergeRecords || []));
        if (batchParsed.analysisNotes) allAnalysisNotes.push(batchParsed.analysisNotes);

        // Return Map<character name, character data>
        const map = new Map<string, {
          name: string;
          importance?: string;
          appearanceCount?: number;
          dialogueCount?: number;
          episodeSpan?: number[];
          role?: string;
          age?: string;
          gender?: string;
          relationships?: string;
        }>();
        for (const c of (batchParsed.characters || [])) {
          if (c.name) map.set(c.name, c);
        }
        return map;
      },
      estimateItemTokens: (item) => estimateTokens(
        `${item.name} [Appears in ${item.sceneCount} scenes, ${item.dialogueCount} dialogue lines] ` +
        item.dialogueSamples.join(' ')
      ),
      estimateItemOutputTokens: () => 200,
      apiOptions: {
        temperature: 0,
        maxTokens: 16384,
      },
    });

    if (failedBatches > 0) {
      console.warn(`[CharacterCalibrator] ${failedBatches} batches failed, using partial results`);
    }

    parsed = {
      characters: Array.from(charResults.values()).map(c => ({
        ...c,
        importance: c.importance || 'minor',
        appearanceCount: c.appearanceCount || 0,
      })),
      filteredWords: [...new Set(allFilteredWords)],
      mergeRecords: allMergeRecords,
      analysisNotes: allAnalysisNotes.join('; ') || 'Batch processing completed',
    };

    console.log('[CharacterCalibrator] AI character analysis successful, parsed', parsed.characters.length, 'characters');
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error('[CharacterCalibrator] AI character analysis failed:', err.message);
    console.error('[CharacterCalibrator] Error stack:', err.stack);
    // Return original data as fallback, with statistics
    return {
      characters: rawCharacters.map((c, i) => {
        const s = stats.get(c.name);
        return {
          id: c.id || `char_${i + 1}`,
          name: c.name,
          importance: (s && s.sceneCount > 20 ? 'supporting' :
                       s && s.sceneCount > 5 ? 'minor' : 'extra') as 'protagonist' | 'supporting' | 'minor' | 'extra',
          appearanceCount: s?.sceneCount || 1,
          role: c.role,
          nameVariants: [c.name],
        };
      }),
      filteredWords: [],
      mergeRecords: [],
      analysisNotes: `AI character analysis failed (${err.message}), returning statistics-based results`,
    };
  }

  // === Step 2: Convert to standard format and add IDs ===
  const characters: CalibratedCharacter[] = (parsed.characters || []).map((c: {
    name: string;
    importance?: string;
    appearanceCount?: number;
    dialogueCount?: number;
    episodeSpan?: number[];
    role?: string;
    age?: string;
    gender?: string;
    relationships?: string;
  }, i: number) => ({
    id: `char_${i + 1}`,
    name: c.name,
    importance: (c.importance || 'minor') as CalibratedCharacter['importance'],
    appearanceCount: c.appearanceCount || c.dialogueCount || 1,
    role: c.role,
    age: c.age,
    gender: c.gender,
    relationships: c.relationships,
    nameVariants: [c.name],
    episodeRange: c.episodeSpan as [number, number] | undefined,
  }));

  // === Step 3: Generate professional visual prompts for protagonists and important supporting characters (independent try/catch, failure doesn't affect calibration result) ===
  let enrichedCharacters = characters;
  try {
    enrichedCharacters = await enrichCharactersWithVisualPrompts(
      characters,
      background,
      episodeScripts
    );
    console.log('[CharacterCalibrator] Visual prompt generation completed');
  } catch (enrichError) {
    const err = enrichError instanceof Error ? enrichError : new Error(String(enrichError));
    console.warn('[CharacterCalibrator] Visual prompt generation failed (does not affect character calibration result):', err.message);
    // enrichment failure doesn't affect main calibration result, continue using characters
  }

  // === Step 4: Merge previous calibration result to prevent character loss ===
  let finalCharacters = enrichedCharacters;
  if (previousCharacters && previousCharacters.length > 0) {
    const currentNames = new Set(enrichedCharacters.map(c => c.name));

    // Find characters that were present last time but missing this time (exclude extras)
    const missingCharacters = previousCharacters.filter(pc => {
      if (currentNames.has(pc.name)) return false;
      // Only keep characters with specific names
      const isGroupExtra = [
        'Security', 'Police', 'Employee', 'Nurse', 'Doctor', 'Reporter',
        'Lawyer', 'Passerby', 'Crowd', 'Group', 'People', 'Auntie',
      ].some(keyword =>
        pc.name === keyword ||
        pc.name === keyword + '1' ||
        pc.name === keyword + '2' ||
        pc.name.startsWith('Several') ||
        pc.name.startsWith('Two') ||
        pc.name.startsWith('Some')
      );
      return !isGroupExtra && pc.importance !== 'extra';
    });

    if (missingCharacters.length > 0) {
      console.log(`[CharacterCalibrator] Merging ${missingCharacters.length} missing characters from previous calibration:`,
        missingCharacters.map(c => c.name));

      // Reassign IDs for missing characters
      const maxId = Math.max(...finalCharacters.map(c => {
        const match = c.id.match(/char_(\d+)/);
        return match ? parseInt(match[1]) : 0;
      }));

      const recoveredChars = missingCharacters.map((c, i) => ({
        ...c,
        id: `char_${maxId + i + 1}`,
      }));

      finalCharacters = [...finalCharacters, ...recoveredChars];
    }
  }

  return {
    characters: finalCharacters,
    filteredWords: parsed.filteredWords || [],
    mergeRecords: parsed.mergeRecords || [],
    analysisNotes: parsed.analysisNotes || '',
  };
}

/**
 * Collect character appearance context (for AI analysis)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function collectCharacterContexts(
  characters: ScriptCharacter[],
  episodeScripts: EpisodeRawScript[]
): string {
  const contexts: string[] = [];
  const characterNames = new Set(characters.map(c => c.name));

  // Traverse scripts, collect scenes and dialogues where characters appear
  for (const ep of episodeScripts.slice(0, 5)) { // Only take first 5 episodes as samples
    for (const scene of ep.scenes.slice(0, 10)) { // Max 10 scenes per episode
      // Check if scene contains characters we care about
      const relevantChars = scene.characters.filter(c =>
        characterNames.has(c) || characters.some(char => c.includes(char.name))
      );

      if (relevantChars.length > 0) {
        contexts.push(`[Ep ${ep.episodeIndex}-${scene.sceneHeader}]`);
        contexts.push(`Characters: ${relevantChars.join(', ')}`);

        // Collect relevant dialogues (first 3)
        const relevantDialogues = scene.dialogues
          .filter(d => characterNames.has(d.character) || characters.some(c => d.character.includes(c.name)))
          .slice(0, 3);

        for (const d of relevantDialogues) {
          contexts.push(`${d.character}: ${d.line.slice(0, 50)}...`);
        }
        contexts.push('');
      }
    }
  }

  return contexts.join('\n');
}

/**
 * Convert calibration result back to ScriptCharacter format
 * Note: Preserve all fields of original characters, only supplement/update AI-calibrated fields
 */
export function convertToScriptCharacters(
  calibrated: CalibratedCharacter[],
  originalCharacters?: ScriptCharacter[]
): ScriptCharacter[] {
  return calibrated.map(c => {
    // Find original character data
    const original = originalCharacters?.find(orig => orig.name === c.name);

    // Merge: preserve original data, only supplement/update AI-generated fields
    return {
      // Preserve original fields
      ...original,
      // Update/supplement AI-calibrated fields
      id: c.id,
      name: c.name,
      role: c.role || original?.role,
      age: c.age || original?.age,
      gender: c.gender || original?.gender,
      relationships: c.relationships || original?.relationships,
      // === Professional character design fields (world-class master generated) ===
      visualPromptEn: c.visualPromptEn || original?.visualPromptEn,
      visualPromptZh: c.visualPromptZh || original?.visualPromptZh,
      appearance: c.facialFeatures || c.uniqueMarks || c.clothingStyle
        ? [c.facialFeatures, c.uniqueMarks, c.clothingStyle].filter(Boolean).join(', ')
        : original?.appearance,
      // === 6-layer identity anchors (character consistency) ===
      identityAnchors: c.identityAnchors || original?.identityAnchors,
      negativePrompt: c.negativePrompt || original?.negativePrompt,
      // Tag importance for UI display
      tags: [c.importance, `Appears ${c.appearanceCount} times`, ...(original?.tags || [])],
    };
  });
}

/**
 * Sort characters by importance
 */
export function sortByImportance(characters: CalibratedCharacter[]): CalibratedCharacter[] {
  const order = { protagonist: 0, supporting: 1, minor: 2, extra: 3 };
  return [...characters].sort((a, b) => {
    // First by importance
    const importanceOrder = order[a.importance] - order[b.importance];
    if (importanceOrder !== 0) return importanceOrder;
    // Then by appearance count
    return b.appearanceCount - a.appearanceCount;
  });
}

// ==================== Professional Character Design ====================

/**
 * Generate professional visual prompts for protagonists and important supporting characters
 * Call world-class character design master AI
 */
async function enrichCharactersWithVisualPrompts(
  characters: CalibratedCharacter[],
  background: ProjectBackground,
  episodeScripts: EpisodeRawScript[]
): Promise<CalibratedCharacter[]> {
  // Only generate detailed prompts for protagonists and important supporting characters
  const keyCharacters = characters.filter(c =>
    c.importance === 'protagonist' || c.importance === 'supporting'
  );

  if (keyCharacters.length === 0) {
    return characters;
  }

  console.log(`[enrichCharactersWithVisualPrompts] Generating professional prompts for ${keyCharacters.length} key characters...`);

  // Build era fashion guidance
  const getEraFashionGuidance = () => {
    const startYear = background.storyStartYear;
    const timeline = background.timelineSetting || background.era || 'Modern';

    if (startYear) {
      if (startYear >= 2020) {
        return `【${startYear}s Fashion Guidance】
- Young adults: Casual fashion, sporty, trendy elements, hoodies, jeans, sneakers
- Middle-aged: Business casual, modern simple, polo shirts, casual blazers, khakis
- Elderly: Comfortable leisure, cardigans, knit shirts, cloth or sports shoes`;
      } else if (startYear >= 2010) {
        return `【${startYear}s Fashion Guidance】
- Young adults: Korean-style fashion, fresh style, t-shirts, jeans, canvas shoes
- Middle-aged: Business formal or business casual, suits, shirts, leather shoes
- Elderly: Traditional leisure, cardigans, cloth shoes`;
      } else if (startYear >= 2000) {
        return `【${startYear}s Fashion Guidance】
- Young adults: Millennium fashion, tight pants, loose jackets, skate shoes
- Middle-aged: Formal business wear, suit sets, ties, leather shoes
- Elderly: Mao suits or simple cardigans, cloth shoes`;
      } else if (startYear >= 1990) {
        return `[${startYear}s Fashion Guidance]
- Young adults: Bell-bottom pants, denim jackets, broad-shouldered blazers, canvas sneakers
- Middle-aged: Suits or business casual, simple leather shoes
- Elderly: Simple cardigans, cotton-padded jackets, cloth shoes`;
      } else {
        return `[${startYear}s Fashion Guidance]
Please design according to actual fashion of that era, avoid costume or era-inappropriate clothing`;
      }
    }

    // If no precise year, judge by era
    if (timeline.includes('Modern') || timeline.includes('Contemporary')) {
      return `[Modern Fashion Guidance]
Please design clothing styles fitting contemporary society: young adults in fashion casual, middle-aged in business casual, elderly in comfortable traditional wear.
Absolutely do not design as costume or period clothing.`;
    }

    return '';
  };

  const eraFashionGuidance = getEraFashionGuidance();

  // System prompt: Character design master + background info + output format (without specific characters)
  const systemPrompt = `You are a Hollywood top-tier character design master, having designed countless classic characters for Marvel, Disney, and Pixar.

Your professional capabilities:
- **Character Visual Design**: Can accurately capture character appearance, clothing style, body language
- **Era Costume Expert**: Master of fashion trends across different eras, can accurately restore historical period clothing features
- **AI Image Generation Expert**: Deeply knowledgeable in Midjourney, DALL-E, Stable Diffusion and other AI drawing models
- **Character Consistency Expert**: Master of "6-layer feature locking" technique to ensure same character remains consistent across different scenes

[Script Information]
Title: "${background.title}"
Genre: ${background.genre || 'Unknown'}
Era: ${background.era || 'Modern'}
Precise Timeline: ${background.timelineSetting || 'Not specified'}
Story Years: ${background.storyStartYear ? `${background.storyStartYear}` : 'Not specified'}${background.storyEndYear && background.storyEndYear !== background.storyStartYear ? ` - ${background.storyEndYear}` : ''}
Total Episodes: ${episodeScripts.length}

${eraFashionGuidance}

[Story Outline]
${background.outline?.slice(0, 1200) || 'None'}

[Character Biographies]
${background.characterBios?.slice(0, 1200) || 'None'}

[Core Output: 6-Layer Identity Anchors]
This is the key technology for maintaining character consistency in AI generation, must be filled in detail:

① Bone Structure Layer (facial bone structure)
   - faceShape: Face shape (oval/square/heart/round/diamond/oblong)
   - jawline: Jaw line (sharp angular/soft rounded/prominent)
   - cheekbones: Cheekbones (high prominent/subtle/wide set)

② Facial Features Layer (precise description)
   - eyeShape: Eye shape (almond/round/hooded/monolid/upturned)
   - eyeDetails: Eye details (double eyelids, slight epicanthic fold, deep-set)
   - noseShape: Nose shape (straight bridge, rounded tip, button nose)
   - lipShape: Lip shape (full lips, thin lips, defined cupid's bow)

③ Identification Marks Layer (strongest anchor!)
   - uniqueMarks: Required array! At least 2-3 unique marks
   - Example: ["small mole 2cm below left eye", "faint scar on right eyebrow", "dimple on left cheek"]
   - This is the strongest character recognition feature, must be precise in location

④ Color Anchor Layer (Hex color values)
   - colorAnchors.iris: Iris color (e.g., #3D2314 dark brown)
   - colorAnchors.hair: Hair color (e.g., #1A1A1A jet black)
   - colorAnchors.skin: Skin tone (e.g., #E8C4A0 warm beige)
   - colorAnchors.lips: Lip color (e.g., #C4727E dusty rose)

- **Color Anchor Layer** (Hex color values)
   - colorAnchors.iris: Iris color (e.g., #3D2314 dark brown)
   - colorAnchors.hair: Hair color (e.g., #1A1A1A jet black)
   - colorAnchors.skin: Skin tone (e.g., #E8C4A0 warm beige)
   - colorAnchors.lips: Lip color (e.g., #C4727E dusty rose)

⑤ **Skin Texture Layer**
   - skinTexture: Skin texture (visible pores, light freckles, smile lines)

⑥ **Hairstyle Anchor Layer**
   - hairStyle: Hairstyle (shoulder-length layered, buzz cut, bob)
   - hairlineDetails: Hairline (natural, widow's peak, receding)

[Negative Prompt]
Generate negativePrompt for character, excluding features that don't fit the setting:
- avoid: Features to avoid (e.g., blonde hair, blue eyes for dark-haired characters)
- styleExclusions: Style exclusions (e.g., anime style, cartoon, painting)

[Clothing Requirements]
- Clothing must fit the era when story occurs (${background.storyStartYear || background.era || 'Modern'})
- Design appropriate clothing according to character age
- Absolutely do not design as costume, Hanfu, or era-inappropriate attire

Please return JSON format (note: only return single character object, don't wrap in array):
{
  "name": "Character Name",
  "detailedDescription": "Detailed character description (100-200 words)",
  "visualPromptEn": "English visual prompt, 40-60 words",
  "visualPromptZh": "Chinese visual prompt",
  "clothingStyle": "Era-appropriate clothing style",
  "identityAnchors": {
    "faceShape": "oval",
    "jawline": "soft rounded",
    "cheekbones": "subtle",
    "eyeShape": "almond",
    "eyeDetails": "double eyelids, warm gaze",
    "noseShape": "straight bridge, rounded tip",
    "lipShape": "full lips",
    "uniqueMarks": ["small mole below left eye", "dimple on right cheek"],
    "colorAnchors": {
      "iris": "#3D2314",
      "hair": "#1A1A1A",
      "skin": "#E8C4A0",
      "lips": "#C4727E"
    },
    "skinTexture": "smooth with light smile lines",
    "hairStyle": "short neat business cut",
    "hairlineDetails": "natural hairline"
  },
  "negativePrompt": {
    "avoid": ["blonde hair", "blue eyes", "beard", "tattoos"],
    "styleExclusions": ["anime", "cartoon", "painting", "sketch"]
  }
}` + getPromptLanguageSuffix();

  // Call AI for each character individually to avoid excessive JSON output causing reasoning model token exhaustion
  const designMap = new Map<string, {
    name?: string;
    detailedDescription?: string;
    visualPromptEn?: string;
    visualPromptZh?: string;
    clothingStyle?: string;
    facialFeatures?: string;
    uniqueMarks?: string;
    identityAnchors?: {
      faceShape?: string;
      jawline?: string;
      cheekbones?: string;
      eyeShape?: string;
      eyeDetails?: string;
      noseShape?: string;
      lipShape?: string;
      uniqueMarks?: string[] | string;
      colorAnchors?: {
        iris?: string;
        hair?: string;
        skin?: string;
        lips?: string;
      };
      skinTexture?: string;
      hairStyle?: string;
      hairlineDetails?: string;
    };
    negativePrompt?: {
      avoid?: string[];
      styleExclusions?: string[];
    };
  }>();
  
  for (let i = 0; i < keyCharacters.length; i++) {
    const c = keyCharacters[i];
    const charLabel = `${c.name} (${c.importance === 'protagonist' ? 'Protagonist' : 'Important Supporting'})`;
    console.log(`[enrichCharactersWithVisualPrompts] [${i + 1}/${keyCharacters.length}] Generating: ${charLabel}`);

    const userPrompt = `Please generate professional visual prompts and 6-layer identity anchors for the following character:

${c.name} (${c.importance === 'protagonist' ? 'Protagonist' : 'Important Supporting'})
- Role: ${c.role || 'Unknown'}
- Age: ${c.age || 'Unknown'}
- Gender: ${c.gender || 'Unknown'}
- Appearances: ${c.appearanceCount} times`;

    try {
      const result = await callFeatureAPI('script_analysis', systemPrompt, userPrompt, {
        maxTokens: 4096, // 4096 sufficient for single character output
      });

      // Parse single character JSON
      let cleaned = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const jsonStart = cleaned.indexOf('{');
      const jsonEnd = cleaned.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
      }

      const parsed = JSON.parse(cleaned);
      // Compatibility: AI may return { characters: [...] } or directly return single character object
      const design = parsed.characters ? parsed.characters[0] : parsed;
      if (design) {
        designMap.set(design.name || c.name, design);
        console.log(`[enrichCharactersWithVisualPrompts] ${c.name} generation successful`);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.warn(`[enrichCharactersWithVisualPrompts] ${c.name} generation failed (does not affect other characters):`, err.message);
      // Single character failure doesn't affect overall, continue processing next
    }
  }

  console.log(`[enrichCharactersWithVisualPrompts] Completed: ${designMap.size}/${keyCharacters.length} characters generated successfully`);

  // Merge into character data
  return characters.map(c => {
    const design = designMap.get(c.name);
    if (design) {
      // Extract identityAnchors
      const anchors = design.identityAnchors;

      // Extract compatible fields from new identityAnchors
      const facialFeatures = anchors ? [
        anchors.faceShape && `Face: ${anchors.faceShape}`,
        anchors.eyeShape && `Eyes: ${anchors.eyeShape}`,
        anchors.eyeDetails,
        anchors.noseShape && `Nose: ${anchors.noseShape}`,
        anchors.lipShape && `Lips: ${anchors.lipShape}`,
      ].filter(Boolean).join(', ') : design.facialFeatures;

      // uniqueMarks converted from anchors.uniqueMarks array to string (backward compatible)
      const uniqueMarks = anchors?.uniqueMarks
        ? (Array.isArray(anchors.uniqueMarks) ? anchors.uniqueMarks.join('; ') : anchors.uniqueMarks)
        : design.uniqueMarks;

      return {
        ...c,
        role: design.detailedDescription || c.role,
        visualPromptEn: design.visualPromptEn,
        visualPromptZh: design.visualPromptZh,
        facialFeatures,
        uniqueMarks,
        clothingStyle: design.clothingStyle,
        // New: 6-layer identity anchors
        identityAnchors: anchors ? {
          ...anchors,
          uniqueMarks: Array.isArray(anchors.uniqueMarks)
            ? anchors.uniqueMarks
            : anchors.uniqueMarks ? [anchors.uniqueMarks] : [],
        } as CharacterIdentityAnchors : undefined,
        // New: Negative prompt
        negativePrompt: design.negativePrompt ? {
          avoid: design.negativePrompt.avoid || [],
          styleExclusions: design.negativePrompt.styleExclusions,
        } as CharacterNegativePrompt : undefined,
      } satisfies CalibratedCharacter;
    }
    return c;
  });
}
