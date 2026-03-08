// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Character Stage Analyzer
 *
 * Analyze script outline to automatically identify major character stage changes, generate multi-stage variants
 *
 * Features:
 * 1. Analyze time span and character growth trajectory in the outline
 * 2. Generate stage variants for main characters (youth version, middle-aged version, etc.)
 * 3. Each variant contains episode range for automatic invocation during shot generation
 */

import type { ProjectBackground, ScriptCharacter } from '@/types/script';
import type { CharacterVariation } from '@/stores/character-library-store';
import { callFeatureAPI } from '@/lib/ai/feature-router';
import { getPromptLanguageSuffix } from './prompt-language';

// ==================== Type Definitions ====================

export interface CharacterStageAnalysis {
  characterName: string;
  needsMultiStage: boolean;        // Whether multi-stage is needed
  reason: string;                   // Judgment reason
  stages: StageVariationData[];     // Stage list
  consistencyElements: {            // Consistency elements
    facialFeatures: string;
    bodyType: string;
    uniqueMarks: string;
  };
}

export interface StageVariationData {
  name: string;                     // "Youth version", "Middle-aged version"
  episodeRange: [number, number];   // [1, 15]
  ageDescription: string;           // Age description (e.g., "25 years old")
  stageDescription: string;         // Life stage description (e.g., "Early career, ambitious and energetic")
  visualPromptEn: string;           // English prompt
  visualPromptZh: string;           // Chinese prompt (deprecated)
}

// AnalyzeOptions no longer needed, automatically obtained from service mapping

// ==================== Core Functions ====================

/**
 * Analyze script characters to identify roles needing multi-stage character designs
 *
 * @param background Project background (includes outline)
 * @param characters Character list
 * @param totalEpisodes Total episode count
 * @param options API configuration
 */
export async function analyzeCharacterStages(
  background: ProjectBackground,
  characters: ScriptCharacter[],
  totalEpisodes: number
): Promise<CharacterStageAnalysis[]> {
  
  // Only analyze main characters (first 5 or those with detailed descriptions)
  const mainCharacters = characters.slice(0, 5).filter(c =>
    c.role || c.personality || c.appearance
  );

  if (mainCharacters.length === 0) {
    console.log('[CharacterStageAnalyzer] No main characters found for analysis');
    return [];
  }
  
  const systemPrompt = `You are a professional film and television character design consultant, skilled in analyzing character image changes throughout long-form series.

Your task is to analyze the script outline and determine whether each main character requires multiple-stage character variants.

【Judgment Criteria】
Characters requiring multi-stage images:
1. Large time span (e.g., from age 25 to 50)
2. Status changes (from ordinary person to successful entrepreneur)
3. Significant appearance changes (young → mature → elderly)
4. High episode count (protagonists in 30+ episode series usually need this)

Multi-stage not needed when:
1. Supporting characters, characters with few appearances
2. Series with short time spans
3. No significant character appearance changes

【Stage Division Principles】
- Divide reasonably based on total episode count, at least 10 episodes per stage
- Clear visual distinctions between stages
- Maintain consistency elements like facial features, body type

Please return analysis results in JSON format.` + getPromptLanguageSuffix();

  const userPrompt = `【Script Information】
Title: "${background.title}"
Total Episodes: ${totalEpisodes} episodes
Genre: ${background.genre || 'Unknown'}
Era: ${background.era || 'Modern'}

【Story Outline】
${background.outline?.slice(0, 1500) || 'None'}

【Characters to Analyze】
${mainCharacters.map(c => `
Character: ${c.name}
Age: ${c.age || 'Unknown'}
Role: ${c.role || 'Unknown'}
Appearance: ${c.appearance || 'Unknown'}
`).join('\n')}

Please analyze for each character whether multi-stage character design is needed, and generate stage variant data.

Return JSON format:
{
  "analyses": [
    {
      "characterName": "Character Name",
      "needsMultiStage": true,
      "reason": "Time span of 25 years, from youth to middle age...",
      "stages": [
        {
          "name": "Young Adult Version",
          "episodeRange": [1, 15],
          "ageDescription": "25 years old",
          "stageDescription": "Fresh graduate, high-spirited, white shirt",
          "visualPromptEn": "25 year old male, clean-cut appearance, white dress shirt, confident and ambitious look, bright eyes, athletic build",
          "visualPromptZh": ""
        },
        {
          "name": "Middle-aged Version",
          "episodeRange": [16, 40],
          "ageDescription": "35-40 years old",
          "stageDescription": "Successful entrepreneur, more composed",
          "visualPromptEn": "35-40 year old male, mature businessman look, tailored suit, weathered but determined face, slight wrinkles, commanding presence",
          "visualPromptZh": ""
        }
      ],
      "consistencyElements": {
        "facialFeatures": "sharp jawline, deep-set eyes, straight nose",
        "bodyType": "tall, athletic build, broad shoulders",
        "uniqueMarks": "scar on left wrist"
      }
    }
  ]
}`;

  try {
    // Get configuration from service mapping uniformly
    const result = await callFeatureAPI('script_analysis', systemPrompt, userPrompt);

    // Parse JSON result
    let cleaned = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
    }

    const parsed = JSON.parse(cleaned);
    return parsed.analyses || [];
  } catch (error) {
    console.error('[CharacterStageAnalyzer] AI analysis failed:', error);
    return [];
  }
}

/**
 * Convert stage analysis result to CharacterVariation format
 * Can be used directly for addVariation()
 */
export function convertStagesToVariations(
  analysis: CharacterStageAnalysis
): Omit<CharacterVariation, 'id'>[] {
  if (!analysis.needsMultiStage || analysis.stages.length === 0) {
    return [];
  }

  return analysis.stages.map(stage => ({
    name: stage.name,
    visualPrompt: [
      analysis.consistencyElements.facialFeatures,
      analysis.consistencyElements.bodyType,
      analysis.consistencyElements.uniqueMarks,
      stage.visualPromptEn,
    ].filter(Boolean).join(', '),
    visualPromptZh: stage.visualPromptZh,
    isStageVariation: true,
    episodeRange: stage.episodeRange,
    ageDescription: stage.ageDescription,
    stageDescription: stage.stageDescription,
  }));
}

/**
 * Get the variant that should be used for a given episode number
 *
 * @param variations Character's variation list
 * @param episodeIndex Current episode number
 * @returns Matching variant, undefined if no stage variant exists
 */
export function getVariationForEpisode(
  variations: CharacterVariation[],
  episodeIndex: number
): CharacterVariation | undefined {
  // Only find stage variants
  const stageVariations = variations.filter(v => v.isStageVariation && v.episodeRange);

  if (stageVariations.length === 0) {
    return undefined;
  }

  // Find variant matching episode range
  return stageVariations.find(v => {
    const [start, end] = v.episodeRange!;
    return episodeIndex >= start && episodeIndex <= end;
  });
}

/**
 * Quickly detect if outline contains multi-stage clues
 * Used to prompt users when importing scripts
 */
export function detectMultiStageHints(outline: string, totalEpisodes: number): {
  hasTimeSpan: boolean;
  hasAgeChange: boolean;
  suggestMultiStage: boolean;
  hints: string[];
} {
  const hints: string[] = [];

  // Detect time span (multiple formats)
  const yearPatterns = [
    /(\d{4})\s*[-~toto]+\s*(\d{4})/,      // 2000-2020, 2000 to 2020, 2000~2020
    /from\s+(\d{4})\s+to\s+(\d{4})/i,     // from 2000 to 2020
    /between\s+(\d{4})\s+and\s+(\d{4})/i, // between 2000 and 2020
  ];
  let hasTimeSpan = false;
  for (const pattern of yearPatterns) {
    const yearMatch = outline.match(pattern);
    if (yearMatch) {
      const span = parseInt(yearMatch[2]) - parseInt(yearMatch[1]);
      if (span >= 5) {
        hasTimeSpan = true;
        hints.push(`Time span: ${span} years (${yearMatch[1]}-${yearMatch[2]})`);
        break;
      }
    }
  }

  // Detect age change (multiple formats)
  const agePatterns = [
    /(\d+)\s*(?:years?|years? old|yo)\s*[-~toto]+\s*(\d+)\s*(?:years?|years? old|yo)/i,  // 25-50 years, 25 to 50 years
    /from\s+(\d+)\s*(?:years?|years? old|yo)\s+to\s+(\d+)\s*(?:years?|years? old|yo)/i,  // from 25 to 50 years
    /aged?\s+(\d+)\s*[-~toto]+\s*(\d+)/i,  // aged 25-50
  ];
  let hasAgeChange = false;
  for (const pattern of agePatterns) {
    const ageMatch = outline.match(pattern);
    if (ageMatch) {
      const ageSpan = parseInt(ageMatch[2]) - parseInt(ageMatch[1]);
      if (ageSpan >= 10) { // Age span at least 10 years
        hasAgeChange = true;
        hints.push(`Age span: from ${ageMatch[1]} to ${ageMatch[2]} years old`);
        break;
      }
    }
  }

  // Detect stage keywords (expanded list)
  const stageKeywords = [
    'youth', 'middle-aged', 'elderly', 'young', 'adult', 'late-life',
    'early', 'late', 'early-period', 'final-period',
    'young', 'aged', 'growth', 'years', 'time',
    'early-career', 'career-peak', 'successful', 'accomplished',
  ];
  const foundKeywords = stageKeywords.filter(k => outline.includes(k));
  if (foundKeywords.length > 0) {
    hints.push(`Contains stage keywords: ${foundKeywords.join(', ')}`);
  }

  // Comprehensive judgment - lower threshold
  // 1. 20+ episodes and any clues
  // 2. Or 40+ episode protagonist dramas default to need multi-stage
  const suggestMultiStage = (
    (totalEpisodes >= 20 && (hasTimeSpan || hasAgeChange || foundKeywords.length >= 1)) ||
    (totalEpisodes >= 40) // 40+ episode protagonist dramas default to need
  );

  console.log('[detectMultiStageHints]', {
    totalEpisodes,
    hasTimeSpan,
    hasAgeChange,
    foundKeywords,
    suggestMultiStage,
    hints,
  });

  return {
    hasTimeSpan,
    hasAgeChange,
    suggestMultiStage,
    hints,
  };
}
