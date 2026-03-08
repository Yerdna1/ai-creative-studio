// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Character Prompt Generation Service
 *
 * Professional character design service, aligned with existing character library (character-library-store).
 *
 * Features:
 * 1. Read script metadata to understand character growth arcs
 * 2. Generate different character appearances based on story stages
 * 3. Generated stages can be converted to CharacterVariation in character library
 * 4. Use world-class professional character profiles to improve AI generation quality
 *
 * Note: This is an auxiliary service and does not modify any existing character library functionality.
 */

import { useScriptStore, type ScriptProjectData } from '@/stores/script-store';
import { callFeatureAPI } from '@/lib/ai/feature-router';
import type { CharacterVariation } from '@/stores/character-library-store';
import type { ScriptCharacter } from '@/types/script';
import { t } from '@/i18n';
import { getPromptLanguageSuffix } from '@/lib/script/prompt-language';

// ==================== Type Definitions ====================

/**
 * Character Stage Appearance
 * A character may have different appearances/states at different story stages
 */
export interface CharacterStageAppearance {
  stageId: string;           // Stage ID
  stageName: string;         // Stage name (e.g., "Youth Period", "After Becoming Tycoon")
  episodeRange: string;      // Episode range (e.g., "1-5", "10-20")
  description: string;       // Character description for this stage
  visualPromptEn: string;    // English visual prompt
  visualPromptZh: string;    // Chinese visual prompt
  ageDescription?: string;   // Age description
  clothingStyle?: string;    // Clothing style
  keyChanges?: string;       // Key changes from previous stage
}

/**
 * Complete Character Design
 */
export interface CharacterDesign {
  characterId: string;
  characterName: string;
  // Basic information
  baseDescription: string;      // Base character description
  baseVisualPromptEn: string;   // Base English prompt
  baseVisualPromptZh: string;   // Base Chinese prompt
  // Multi-stage appearances
  stages: CharacterStageAppearance[];
  // Consistency elements (shared across all stages)
  consistencyElements: {
    facialFeatures: string;     // Facial features (unchanging)
    bodyType: string;           // Body type
    uniqueMarks: string;        // Unique marks (birthmarks, scars, etc.)
  };
  // Metadata
  generatedAt: number;
  sourceProjectId: string;
}

/** @deprecated No longer needed to manually pass, automatically obtained from service mapping */
export interface CharacterDesignOptions {
  apiKey?: string;
  provider?: string;
  baseUrl?: string;
  styleId?: string;
}

// ==================== AI Character Design Service ====================

/**
 * Generate professional multi-stage character design for script characters
 *
 * @param characterId Character ID in script
 * @param projectId Project ID
 * @param options API configuration
 */
export async function generateCharacterDesign(
  characterId: string,
  projectId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options?: CharacterDesignOptions // No longer needed, kept for compatibility
): Promise<CharacterDesign> {
  const store = useScriptStore.getState();
  const project = store.projects[projectId];
  
  if (!project) {
    throw new Error(t('lib.error.projectNotFound'));
  }
  
  const scriptData = project.scriptData;
  if (!scriptData) {
    throw new Error(t('lib.error.scriptDataNotFound'));
  }
  
  // Find target character
  const character = scriptData.characters.find(c => c.id === characterId);
  if (!character) {
    throw new Error(t('lib.error.characterNotFound'));
  }

  // Collect character-related context information
  const context = buildCharacterContext(project as unknown as ScriptProjectData, character);

  // Call AI to generate character design
  const design = await callAIForCharacterDesign(
    character,
    context
  );
  
  return design;
}

/**
 * Build character context information
 */
function buildCharacterContext(
  project: ScriptProjectData,
  character: ScriptCharacter
): {
  projectTitle: string;
  genre: string;
  era: string;
  outline: string;
  totalEpisodes: number;
  characterBio: string;
  characterAppearances: Array<{
    episodeIndex: number;
    episodeTitle: string;
    scenes: string[];
    actions: string[];
    dialogues: string[];
  }>;
} {
  const background = project.projectBackground;
  const episodes = project.episodeRawScripts || [];
  const shots = project.shots || [];

  // Collect character appearance info across episodes
  const characterAppearances: Array<{
    episodeIndex: number;
    episodeTitle: string;
    scenes: string[];
    actions: string[];
    dialogues: string[];
  }> = [];

  for (const ep of episodes) {
    const epShots = shots.filter((s) =>
      s.characterNames?.includes(String(character.name))
    );

    if (epShots.length > 0) {
      characterAppearances.push({
        episodeIndex: ep.episodeIndex,
        episodeTitle: ep.title,
        scenes: [...new Set(epShots.map((s) => s.sceneRefId).filter((x): x is string => Boolean(x)))],
        actions: epShots.map((s) => s.actionSummary).filter((x): x is string => Boolean(x)).slice(0, 5),
        dialogues: epShots.map((s) => s.dialogue).filter((x): x is string => Boolean(x)).slice(0, 5),
      });
    }
  }

  // Build character biography
  const characterBio = [
    character.name,
    character.gender ? `Gender: ${character.gender}` : '',
    character.age ? `Age: ${character.age}` : '',
    character.personality ? `Personality: ${character.personality}` : '',
    character.role ? `Role: ${character.role}` : '',
    character.traits ? `Traits: ${character.traits}` : '',
    character.appearance ? `Appearance: ${character.appearance}` : '',
    character.relationships ? `Relationships: ${character.relationships}` : '',
    character.keyActions ? `Key Actions: ${character.keyActions}` : '',
  ].filter(Boolean).join('\n');

  return {
    projectTitle: background?.title || project.scriptData?.title || 'Untitled Script',
    genre: background?.genre || '',
    era: background?.era || '',
    outline: background?.outline || '',
    totalEpisodes: episodes.length,
    characterBio,
    characterAppearances,
  };
}

/**
 * Call AI to generate character design
 */
async function callAIForCharacterDesign(
  character: ScriptCharacter,
  context: {
    projectTitle: string;
    genre: string;
    era: string;
    outline: string;
    totalEpisodes: number;
    characterBio: string;
    characterAppearances: Array<{
      episodeIndex: number;
      episodeTitle: string;
      scenes: string[];
      actions: string[];
      dialogues: string[];
    }>;
  }
): Promise<CharacterDesign> {

  const systemPrompt = `You are a top-tier Hollywood character designer who has created countless classic characters for Marvel, Disney, and Pixar.

Your Expertise:
- **Character Visual Design**: Accurately capture character appearance, clothing style, and body language
- **Character Growth Arcs**: Understand character appearance changes across different story stages (from youth to adulthood, from ordinary to hero)
- **AI Image Generation Experience**: Deep understanding of how AI drawing models work (Midjourney, DALL-E, Stable Diffusion) and ability to write high-quality prompts
- **Consistency Maintenance**: Know how to describe unchanging features like facial characteristics and body type to ensure recognizability across stages

Your task is to design **multi-stage visual appearances** for characters based on script information.

[Script Information]
Title: "${context.projectTitle}"
Genre: ${context.genre || 'Unknown'}
Era: ${context.era || 'Modern'}
Total Episodes: ${context.totalEpisodes}

[Story Synopsis]
${context.outline?.slice(0, 800) || 'None'}

[Character Information]
${context.characterBio}

[Character Appearance Statistics]
${context.characterAppearances.length > 0
  ? context.characterAppearances.map((a) =>
      `Episode ${a.episodeIndex} "${a.episodeTitle}": ${a.actions.length} appearances`
    ).join('\n')
  : 'No appearance data'
}

[Task Requirements]
1. **Analyze Character Growth Arc**: Determine if the character has significant stage changes based on the plot
   - Age changes: child → teen → adult → elderly
   - Identity changes: ordinary → tycoon, apprentice → martial arts master
   - State changes: healthy → injured, normal → post-cultivation form

2. **Design Multi-Stage Appearances**: Generate independent visual prompts for each stage
   - If the character has no obvious stage changes, design only 1 stage
   - If there are changes, design 2-4 stages

3. **Maintain Consistency Elements**: Identify the character's unchanging features
   - Facial features (eye shape, facial proportions)
   - Body type (height, build)
   - Unique marks (birthmarks, scars, signature features)

4. **Prompt Requirements**:
   - English prompt: 40-60 words, suitable for AI image generation
   - Chinese prompt: Detailed description including details

Please return in JSON format:
{
  "characterName": "Character Name",
  "baseDescription": "Base character description (one sentence)",
  "baseVisualPromptEn": "Base English prompt",
  "baseVisualPromptZh": "Base Chinese prompt",
  "consistencyElements": {
    "facialFeatures": "Facial feature description (English)",
    "bodyType": "Body type description (English)",
    "uniqueMarks": "Unique mark description (English, leave empty if none)"
  },
  "stages": [
    {
      "stageId": "stage_1",
      "stageName": "Stage name (e.g., Youth Period)",
      "episodeRange": "1-5",
      "description": "Character state description for this stage",
      "visualPromptEn": "English visual prompt for this stage",
      "visualPromptZh": "Chinese visual prompt for this stage",
      "ageDescription": "Age description",
      "clothingStyle": "Clothing style",
      "keyChanges": "Changes from previous stage (empty for first stage)"
    }
  ]
}` + getPromptLanguageSuffix();

  const userPrompt = `Please design multi-stage visual appearances for the character "${character.name}".`;

  // Get configuration from service mapping
  const result = await callFeatureAPI('script_analysis', systemPrompt, userPrompt);

  // Parse result
  try {
    let cleaned = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
    }
    
    const parsed = JSON.parse(cleaned);
    
    return {
      characterId: character.id,
      characterName: parsed.characterName || character.name,
      baseDescription: parsed.baseDescription || '',
      baseVisualPromptEn: parsed.baseVisualPromptEn || '',
      baseVisualPromptZh: parsed.baseVisualPromptZh || '',
      stages: parsed.stages || [],
      consistencyElements: parsed.consistencyElements || {
        facialFeatures: '',
        bodyType: '',
        uniqueMarks: '',
      },
      generatedAt: Date.now(),
      sourceProjectId: context.projectTitle,
    };
  } catch (e) {
    console.error('[CharacterDesign] Failed to parse AI response:', result);
    throw new Error(t('lib.error.characterDesignParseFailed'));
  }
}

/**
 * Get character's current stage prompt based on episode number
 *
 * @param design Character design
 * @param episodeIndex Current episode number
 */
export function getCharacterPromptForEpisode(
  design: CharacterDesign,
  episodeIndex: number
): { promptEn: string; promptZh: string; stageName: string } {
  // Find corresponding stage
  for (const stage of design.stages) {
    const [start, end] = stage.episodeRange.split('-').map(Number);
    if (episodeIndex >= start && episodeIndex <= end) {
      // Combine consistency elements and stage prompt
      const consistencyPrefix = [
        design.consistencyElements.facialFeatures,
        design.consistencyElements.bodyType,
        design.consistencyElements.uniqueMarks,
      ].filter(Boolean).join(', ');

      return {
        promptEn: consistencyPrefix
          ? `${consistencyPrefix}, ${stage.visualPromptEn}`
          : stage.visualPromptEn,
        promptZh: stage.visualPromptZh,
        stageName: stage.stageName,
      };
    }
  }

  // Default return base prompt
  return {
    promptEn: design.baseVisualPromptEn,
    promptZh: design.baseVisualPromptZh,
    stageName: 'Default',
  };
}

/**
 * Convert character design to character library variation format (CharacterVariation)
 * Can be directly used with addVariation() method
 *
 * @param design Character design
 * @returns Array of variations that can be directly added to character library
 */
export function convertDesignToVariations(design: CharacterDesign): Array<Omit<CharacterVariation, 'id'>> {
  return design.stages.map(stage => ({
    name: stage.stageName,
    // Combine consistency elements + stage prompt
    visualPrompt: [
      design.consistencyElements.facialFeatures,
      design.consistencyElements.bodyType,
      design.consistencyElements.uniqueMarks,
      stage.visualPromptEn,
    ].filter(Boolean).join(', '),
    // Leave referenceImage empty, waiting for user generation
    referenceImage: undefined,
    generatedAt: undefined,
  }));
}

/**
 * Generate variations for character library characters (Wardrobe System)
 * Based on different stages of character design
 *
 * @deprecated Use convertDesignToVariations instead
 */
export function generateVariationsFromDesign(design: CharacterDesign): Array<{
  name: string;
  visualPrompt: string;
}> {
  return design.stages.map(stage => ({
    name: stage.stageName,
    visualPrompt: `${design.consistencyElements.facialFeatures}, ${stage.visualPromptEn}`,
  }));
}

/**
 * Update base description and visual features for character library character
 *
 * @param design Character design
 * @returns Update object that can be used with updateCharacter()
 */
export function getCharacterUpdatesFromDesign(design: CharacterDesign): {
  description: string;
  visualTraits: string;
} {
  return {
    description: design.baseVisualPromptZh,
    visualTraits: design.baseVisualPromptEn,
  };
}
