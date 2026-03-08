// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * AI Character Finder
 *
 * Finds characters from script based on user natural language descriptions and generates professional character data
 *
 * Features:
 * 1. Parse user input (e.g., "Missing Brother Wang from episode 10")
 * 2. Search for character information in script
 * 3. AI generates complete character data (including visual prompts)
 */

import type { ScriptCharacter, ProjectBackground, EpisodeRawScript } from '@/types/script';
import { callFeatureAPI } from '@/lib/ai/feature-router';
import { t } from '@/i18n';
import { getPromptLanguageSuffix } from './prompt-language';

// ==================== Type Definitions ====================

export interface CharacterSearchResult {
  /** Whether character was found */
  found: boolean;
  /** Character name */
  name: string;
  /** Confidence 0-1 */
  confidence: number;
  /** Episode numbers where character appears */
  episodeNumbers: number[];
  /** Found contexts (dialogues, scenes, etc.) */
  contexts: string[];
  /** AI-generated complete character data */
  character?: ScriptCharacter;
  /** Search description message */
  message: string;
}

/** @deprecated No longer needed to manually pass, automatically obtained from service mapping */
export interface FinderOptions {
  apiKey?: string;
  provider?: string;
  baseUrl?: string;
}

// ==================== Core Functions ====================

/**
 * Parse user input and extract character name and episode number information
 */
function parseUserQuery(query: string): { name: string | null; episodeNumber: number | null } {
  let name: string | null = null;
  let episodeNumber: number | null = null;

  // Extract episode number: e.g., "EP.X", "EpX", "episode X", "from episode X"
  const episodeMatch = query.match(/EP\.?\s*(\d+)|(?:from\s+)?episode\s*(\d+)/i);
  if (episodeMatch) {
    episodeNumber = parseInt(episodeMatch[1] || episodeMatch[2]);
  }

  // Remove episode number related text
  const cleanQuery = query
    .replace(/EP\.?\s*\d+/gi, '')
    .replace(/(?:from\s+)?episode\s*\d+/gi, '')
    .trim();

  // English patterns for character name extraction
  // "Add character Elena Voss" / "Missing Elena Voss" / "Find Elena Voss"
  let nameMatch = cleanQuery.match(/^(?:add|missing|find|need|search|look\s*up|get|show)\s+(?:character\s+)?["']?(.+?)["']?\s*$/i);
  if (nameMatch) {
    name = nameMatch[1].trim();
  }

  // "character Elena Voss" / "character: Elena Voss"
  if (!name) {
    nameMatch = cleanQuery.match(/^character[:\s]+["']?(.+?)["']?\s*$/i);
    if (nameMatch) {
      name = nameMatch[1].trim();
    }
  }

  // "Who is Elena Voss" / "Show me Elena Voss"
  if (!name) {
    nameMatch = cleanQuery.match(/^(?:who\s+is|show\s+me|display)\s+(.+?)\s*$/i);
    if (nameMatch) {
      name = nameMatch[1].trim();
    }
  }

  // Pattern: "Elena Voss character" / "Elena Voss" (just name, 2+ chars)
  if (!name) {
    const pureQuery = cleanQuery.replace(/^(?:add|missing|find|need|search|look\s+up|get|show|who\s+is|show\s+me)+/gi, '').trim();
    if (pureQuery.length >= 2 && /^[A-Za-z\s\-']+$/.test(pureQuery)) {
      name = pureQuery;
    }
  }

  return { name, episodeNumber };
}

/**
 * Search for characters in scripts
 */
function searchCharacterInScripts(
  name: string,
  episodeScripts: EpisodeRawScript[],
  targetEpisode?: number
): {
  found: boolean;
  episodeNumbers: number[];
  contexts: string[];
  dialogueSamples: string[];
  sceneSamples: string[];
} {
  const episodeNumbers: number[] = [];
  const contexts: string[] = [];
  const dialogueSamples: string[] = [];
  const sceneSamples: string[] = [];
  
  // Iterate through scripts to search
  const scriptsToSearch = targetEpisode 
    ? episodeScripts.filter(ep => ep.episodeIndex === targetEpisode)
    : episodeScripts;
  
  for (const ep of scriptsToSearch) {
    if (!ep || !ep.scenes) continue;
    
    let foundInEpisode = false;
    
    for (const scene of ep.scenes) {
      if (!scene) continue;
      
      // Check scene character list
      const hasInCharacters = scene.characters?.some(c => 
        c === name || c.includes(name) || name.includes(c)
      );
      
      // Check dialogues
      const relevantDialogues = scene.dialogues?.filter(d => 
        d.character === name || d.character.includes(name) || name.includes(d.character)
      ) || [];
      
      if (hasInCharacters || relevantDialogues.length > 0) {
        if (!foundInEpisode) {
          episodeNumbers.push(ep.episodeIndex);
          foundInEpisode = true;
        }
        
        // Collect scene information
        if (sceneSamples.length < 3) {
          sceneSamples.push(`Episode ${ep.episodeIndex} - ${scene.sceneHeader || 'Scene'}`);
        }

      // Collect dialogue samples
        for (const d of relevantDialogues.slice(0, 3)) {
          if (dialogueSamples.length < 5) {
            dialogueSamples.push(`${d.character}: ${d.line.slice(0, 50)}${d.line.length > 50 ? '...' : ''}`);
          }
        }

        // Collect contexts
        if (contexts.length < 5) {
          const sceneContext = [
            `[${scene.sceneHeader || 'Scene'}]`,
            scene.characters?.length ? `Characters: ${scene.characters.join(', ')}` : '',
            ...relevantDialogues.slice(0, 2).map(d => `${d.character}: ${d.line.slice(0, 30)}...`),
          ].filter(Boolean).join('\n');
          contexts.push(sceneContext);
        }
      }
    }
  }
  
  return {
    found: episodeNumbers.length > 0,
    episodeNumbers,
    contexts,
    dialogueSamples,
    sceneSamples,
  };
}

/**
 * Use AI to generate complete character data
 */
async function generateCharacterData(
  name: string,
  background: ProjectBackground,
  contexts: string[],
  dialogueSamples: string[]
): Promise<ScriptCharacter> {
  
  // Detect script type: ancient/future/modern
  const detectStoryType = () => {
    const era = (background.era || '');
    const timeline = (background.timelineSetting || '');
    const genre = (background.genre || '');
    const outline = (background.outline || '');
    const startYear = background.storyStartYear;

    console.log('[detectStoryType] background:', {
      era,
      timeline,
      genre,
      storyStartYear: startYear,
    });
    
    // If storyStartYear is explicitly set and is modern era year (after 1800), directly classify as modern
    if (startYear && startYear >= 1800) {
      console.log('[detectStoryType] Detection result: modern (based on storyStartYear:', startYear, ')');
      return 'modern';
    }

    // If storyStartYear doesn't exist, try to extract year from outline/era/timeline
    const textForYearExtraction = `${era} ${timeline} ${outline}`;
    const yearMatch = textForYearExtraction.match(/(19\d{2}|20\d{2})/);
    if (yearMatch) {
      const extractedYear = parseInt(yearMatch[1]);
      console.log('[detectStoryType] Detection result: modern (extracted year from text:', extractedYear, ')');
      return 'modern';
    }

    // Ancient drama keywords (explicit ancient settings)
    const ancientKeywords = ['ancient', 'period drama', 'costume drama', 'wuxia', 'martial arts', 'xianxia', 'fantasy', 'myth', 'legend', 'dynasty', 'imperial', 'palace', 'emperor', 'court', 'cultivation', 'Tang Dynasty', 'Song Dynasty', 'Ming Dynasty', 'Qing Dynasty', 'Han Dynasty', 'Three Kingdoms'];
    // Future/Sci-Fi keywords
    const futureKeywords = ['future', 'sci-fi', 'science fiction', 'space', 'interstellar', 'robot', 'cyberpunk', 'apocalypse', 'post-apocalyptic', 'dystopian', 'artificial intelligence', 'AI', '2100', '2200', '2300'];
    
    const allText = `${era} ${timeline} ${genre} ${outline}`;

    if (ancientKeywords.some(kw => allText.includes(kw))) {
      console.log('[detectStoryType] Detection result: ancient (based on keywords)');
      return 'ancient';
    }
    if (futureKeywords.some(kw => allText.includes(kw))) {
      console.log('[detectStoryType] Detection result: future (based on keywords)');
      return 'future';
    }
    console.log('[detectStoryType] Detection result: modern (default)');
    return 'modern';
  };
  
  const storyType = detectStoryType();
  
  // Build clothing guidance based on script type
  const getEraFashionGuidance = () => {
    // Ancient drama
    if (storyType === 'ancient') {
      const era = background.era || background.timelineSetting || 'Ancient';
      return `[${era} Costume Guidance]
Design costumes according to the historical era:
- If martial arts/wuxia: Ancient Hanfu, warrior attire, cloth clothes and straw sandals
- If palace: Palace attire, court dress, official uniforms
- If xianxia/fantasy: Cultivation-style robes, flowing long robes
Design appropriate ancient costumes based on character status (commoner/noble/warrior/official).`;
    }

    // Future/Sci-Fi drama
    if (storyType === 'future') {
      return `[Future/Sci-Fi Costume Guidance]
Design future-style costumes according to script settings:
- Tech-style clothing, functional gear, smart wearables
- Can be utopian or dystopian style based on setting
- Pay attention to character status (commoner/scientist/soldier/mechanic)`;
    }

    // Modern drama - based on specific era
    const startYear = background.storyStartYear;

    if (startYear) {
      if (startYear >= 2020) {
        return `[${startYear}s Costume Guidance]
- Young people: Casual fashion, sporty, trendy elements, often wear hoodies, jeans, sneakers
- Middle-aged: Business casual, simple modern, often wear polo shirts, casual blazers, khakis
- Elderly: Comfortable casual, often wear cardigans, shirts, cloth shoes or sneakers`;
      } else if (startYear >= 2010) {
        return `[${startYear}s Costume Guidance]
- Young people: Korean fashion, fresh style, often wear T-shirts, jeans, canvas shoes
- Middle-aged: Business formal or business casual, often wear suits, shirts, leather shoes
- Elderly: Traditional casual, often wear cardigans, cloth shoes`;
      } else if (startYear >= 2000) {
        return `[${startYear}s Costume Guidance]
- Young people: Millennium fashion, often wear tight pants, loose jackets, skate shoes
- Middle-aged: Formal business wear, often wear suits, ties, leather shoes
- Elderly: Zhongshan suit or simple cardigans, cloth shoes`;
      } else if (startYear >= 1990) {
        return `[${startYear}s Costume Guidance]
- Young people: Bell-bottoms, polyester jackets, broad-shouldered blazers
- Middle-aged: Zhongshan suit or suits, liberation shoes or simple leather shoes
- Elderly: Zhongshan suit, cotton jackets, cloth shoes`;
      } else {
        return `[${startYear}s Costume Guidance]
Design according to actual Chinese fashion styles of that era`;
      }
    }

    // Default modern
    return `[Modern Costume Guidance]
Design contemporary Chinese fashion styles, choosing appropriate modern clothing based on character age and status.`;
  };
  
  // Build era information string
  const getEraInfo = () => {
    if (storyType === 'ancient') {
      return `Era: ${background.era || background.timelineSetting || 'Ancient'}`;
    }
    if (storyType === 'future') {
      return `Era: ${background.era || background.timelineSetting || 'Future'}`;
    }
    if (background.storyStartYear) {
      return `Story year: ${background.storyStartYear}${background.storyEndYear && background.storyEndYear !== background.storyStartYear ? ` - ${background.storyEndYear}` : ''}`;
    }
    return `Era: ${background.era || background.timelineSetting || 'Modern'}`;
  };
  
  const eraInfo = getEraInfo();
  const eraFashionGuidance = getEraFashionGuidance();
  
  const systemPrompt = `You are a professional film/TV character designer, expert at extracting character traits from script information and generating professional character data.

Please generate complete character data based on the provided script information and character context.

[Costume Design Requirements]
${eraFashionGuidance}

Costumes must be consistent with the script's era. Do not mix costume styles from different eras.

[Output Format]
Please return in JSON format with the following fields:
{
  "name": "Character Name",
  "gender": "Male/Female",
  "age": "Age description, e.g., 'around 30' or 'middle-aged'",
  "personality": "Personality traits, 2-3 words",
  "role": "Character identity/profession/role in the story",
  "appearance": "Appearance description (costume must match the era)",
  "relationships": "Relationships with other characters",
  "visualPromptEn": "English visual prompts for AI image generation, describing appearance, costume (must match era), temperament",
  "visualPromptZh": "Chinese visual prompts",
  "importance": "protagonist/supporting/minor"
}` + getPromptLanguageSuffix();

  const userPrompt = `[Script Information]
Title: "${background.title}"
Genre: ${background.genre || 'Drama'}
${eraInfo}

[Story Outline]
${background.outline?.slice(0, 1000) || 'None'}

[Character Bios]
${background.characterBios?.slice(0, 800) || 'None'}

[Character to Analyze]
${name}

[Character Appearance Contexts]
${contexts.slice(0, 3).join('\n\n')}

[Character Dialogue Samples]
${dialogueSamples.join('\n')}

Please generate complete data for character "${name}" based on the above information.

[IMPORTANT] Costume must match the story era (${eraInfo})!`;

  try {
    // Get configuration from service mapping
    const result = await callFeatureAPI('script_analysis', systemPrompt, userPrompt);

    // Parse JSON
    let cleaned = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
    }

    const parsed = JSON.parse(cleaned);

    // Ensure all fields are string type (AI may return objects)
    const ensureString = (val: unknown): string | undefined => {
      if (val === null || val === undefined) return undefined;
      if (typeof val === 'string') return val;
      if (typeof val === 'object') {
        // If object, try to convert to string
        if (Array.isArray(val)) {
          return val.join(', ');
        }
        // Convert object to key-value pair string
        return Object.entries(val)
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ');
      }
      return String(val);
    };
    
    return {
      id: `char_${Date.now()}`,
      name: ensureString(parsed.name) || name,
      gender: ensureString(parsed.gender),
      age: ensureString(parsed.age),
      personality: ensureString(parsed.personality),
      role: ensureString(parsed.role),
      appearance: ensureString(parsed.appearance),
      relationships: ensureString(parsed.relationships),
      visualPromptEn: ensureString(parsed.visualPromptEn),
      visualPromptZh: ensureString(parsed.visualPromptZh),
      tags: [parsed.importance || 'minor', 'AI-generated'],
    };
  } catch (error) {
    console.error('[generateCharacterData] AI generation failed:', error);
    // Return basic data
    return {
      id: `char_${Date.now()}`,
      name,
      tags: ['AI-generated'],
    };
  }
}

/**
 * Main function: Find and generate character based on user description
 */
export async function findCharacterByDescription(
  userQuery: string,
  background: ProjectBackground,
  episodeScripts: EpisodeRawScript[],
  existingCharacters: ScriptCharacter[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options?: FinderOptions // No longer needed, kept for compatibility
): Promise<CharacterSearchResult> {
  console.log('[findCharacterByDescription] User query:', userQuery);

  // 1. Parse user input
  const { name, episodeNumber } = parseUserQuery(userQuery);

  if (!name) {
    return {
      found: false,
      name: '',
      confidence: 0,
      episodeNumbers: [],
      contexts: [],
      message: t('script.characterFinder.unableToIdentifyName'),
    };
  }

  console.log('[findCharacterByDescription] Parse result:', { name, episodeNumber });

  // 2. Check if already exists
  const existing = existingCharacters.find(c =>
    c.name === name || c.name.includes(name) || name.includes(c.name)
  );

  if (existing) {
    return {
      found: true,
      name: existing.name,
      confidence: 1,
      episodeNumbers: [],
      contexts: [],
      message: t('script.characterFinder.alreadyExists', { name: existing.name }),
      character: existing,
    };
  }

  // 3. Search in scripts
  const searchResult = searchCharacterInScripts(name, episodeScripts, episodeNumber || undefined);

  if (!searchResult.found) {
    // Not found but allow user to confirm whether to create
    return {
      found: false,
      name,
      confidence: 0.3,
      episodeNumbers: [],
      contexts: [],
      message: episodeNumber
        ? t('script.characterFinder.notFoundInEpisodeCreate', { episode: episodeNumber, name })
        : t('script.characterFinder.notFoundInScriptCreate', { name }),
    };
  }

  // 4. Use AI to generate complete character data
  console.log('[findCharacterByDescription] Generating character data...');
  
  const character = await generateCharacterData(
    name,
    background,
    searchResult.contexts,
    searchResult.dialogueSamples
  );

  // Calculate confidence
  const confidence = Math.min(
    0.5 + searchResult.dialogueSamples.length * 0.1 + searchResult.episodeNumbers.length * 0.05,
    1
  );

  return {
    found: true,
    name: character.name,
    confidence,
    episodeNumbers: searchResult.episodeNumbers,
    contexts: searchResult.contexts,
    message: t('script.characterFinder.foundInEpisodes', {
      name: character.name,
      episodes: searchResult.episodeNumbers.join(', ')
    }),
    character,
  };
}

/**
 * Search only (no AI call), for quick preview
 */
export function quickSearchCharacter(
  userQuery: string,
  episodeScripts: EpisodeRawScript[],
  existingCharacters: ScriptCharacter[]
): { name: string | null; found: boolean; message: string; existingChar?: ScriptCharacter } {
  const { name, episodeNumber } = parseUserQuery(userQuery);
  
  if (!name) {
    return { name: null, found: false, message: t('script.characterFinder.pleaseEnterName') };
  }

  // Check if already exists
  const existing = existingCharacters.find(c =>
    c.name === name || c.name.includes(name) || name.includes(c.name)
  );

  if (existing) {
    return {
      name: existing.name,
      found: true,
      message: t('script.characterFinder.alreadyExistsSimple', { name: existing.name }),
      existingChar: existing,
    };
  }

  // Quick search
  const searchResult = searchCharacterInScripts(name, episodeScripts, episodeNumber || undefined);
  
  if (searchResult.found) {
    return {
      name,
      found: true,
      message: t('script.characterFinder.foundInEpisodesSimple', {
        name,
        episodes: searchResult.episodeNumbers.join(', ')
      }),
    };
  }

  return {
    name,
    found: false,
    message: t('script.characterFinder.notFoundInScriptSimple', { name }),
  };
}
