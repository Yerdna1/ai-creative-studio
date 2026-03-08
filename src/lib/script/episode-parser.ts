// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Episode Parser - Script parser
 * Parses standard screenplay formats, extracting episodes, scenes,
 * dialogues, actions, and other structured information.
 *
 * Supported formats:
 * - Episode markers: Episode X
 * - Scene headers: **1-1 Day Int. Location**
 * - Character lines: Characters: Name1, Name2
 * - Subtitles: [Subtitle: Summer 2002]
 * - Action lines: △description...
 * - Dialogue: Character: (action) line
 * - Flashback: [Flashback]...[End Flashback]
 * - Voiceover: [VO:...]
 */

import type {
  EpisodeRawScript,
  SceneRawContent,
  DialogueLine,
  ProjectBackground,
  ScriptData,
  Episode,
  ScriptScene,
  ScriptCharacter,
} from "@/types/script";

/**
 * Clean location string by removing character/time metadata.
 * e.g. "Country Road/Bus Characters: John, Jane" -> "Country Road/Bus"
 * e.g. "Office Characters: John, Jane" -> "Office"
 */
function cleanLocationString(location: string): string {
  if (!location) return '';
  // Remove "Characters: XXX" patterns
  let cleaned = location.replace(/\s*Characters[:\uff1a:].*/gi, '');
  // Remove "Role: XXX" patterns
  cleaned = cleaned.replace(/\s*Role[:\uff1a:].*/g, '');
  // Remove "Time: XXX" patterns
  cleaned = cleaned.replace(/\s*Time[:\uff1a:].*/gi, '');
  return cleaned.trim();
}

/**
 * Parse full script text, extracting background info and episode content.
 */
export function parseFullScript(fullText: string): {
  background: ProjectBackground;
  episodes: EpisodeRawScript[];
} {
  // 1. Extract title: 《title》 / 「title」 / "title"
  const titleMatch = fullText.match(/[《「]([^》」]+)[》」]/) ||
    fullText.match(/^[*]{0,2}"([^"]+)"[*]{0,2}/m);
  const title = titleMatch ? titleMatch[1] : 'Untitled Script';

  // 2. Extract outline/synopsis (up to character bios or first episode)
  const outlineMatch = fullText.match(
    /(?:\*{0,2}(?:Synopsis|Outline)[：:] ?\*{0,2}|【Outline】)([\s\S]*?)(?=(?:\*{0,2}(?:Character Profiles|Characters)[：:]|【Characters|Episode\s+\d+))/i
  );
  const outline = outlineMatch ? outlineMatch[1].trim() : '';

  // 3. Extract character bios (up to first episode)
  const characterBiosMatch = fullText.match(
    /(?:\*{0,2}(?:Character Profiles|Characters)[：:]\*{0,2}|【Characters】)([\s\S]*?)(?=\*{0,2}(?:Episode\s+\d+))/i
  );
  const characterBios = characterBiosMatch ? characterBiosMatch[1].trim() : '';

  // 4. Extract era and timeline info
  const { era, timelineSetting, storyStartYear, storyEndYear } = extractTimelineInfo(outline, characterBios);

  // 5. Detect genre
  const genre = detectGenre(outline, characterBios);

  // 6. Extract world setting
  const worldSetting = extractWorldSetting(outline, characterBios);

  // 7. Extract theme keywords
  const themes = extractThemes(outline, characterBios);

  // 8. Parse episodes
  const episodes = parseEpisodes(fullText);

  return {
    background: {
      title,
      outline,
      characterBios,
      era,
      timelineSetting,
      storyStartYear,
      storyEndYear,
      genre,
      worldSetting,
      themes,
    },
    episodes,
  };
}

/**
 * Extract timeline information from outline and character bios.
 */
function extractTimelineInfo(outline: string, characterBios: string): {
  era: string;
  timelineSetting?: string;
  storyStartYear?: number;
  storyEndYear?: number;
} {
  const fullText = `${outline}\n${characterBios}`;

  let storyStartYear: number | undefined;
  let storyEndYear: number | undefined;
  let timelineSetting: string | undefined;

  // Match year ranges - regex matches patterns like "2000-2020" or "2000 to 2020"
  const rangeMatch = fullText.match(/(\d{4})\s*[-~to]+\s*(\d{4})/);
  if (rangeMatch) {
    storyStartYear = parseInt(rangeMatch[1]);
    storyEndYear = parseInt(rangeMatch[2]);
    timelineSetting = `${storyStartYear} - ${storyEndYear}`;
  } else {
    // Match single year (with optional season/era context)
    const singleYearMatchCN = fullText.match(/(\d{4})\s+(spring|summer|autumn|fall|winter)/i);
    if (singleYearMatchCN) {
      storyStartYear = parseInt(singleYearMatchCN[1]);
      const season = singleYearMatchCN[2] || '';
      timelineSetting = season ? `${storyStartYear} ${season}` : `${storyStartYear}`;
    } else {
      // Match single year (English context)
      const singleYearMatchEN = fullText.match(/\b(1[0-9]{3}|2[0-9]{3})\b/);
      if (singleYearMatchEN) {
        storyStartYear = parseInt(singleYearMatchEN[1]);
        timelineSetting = `${storyStartYear}`;
      }
    }
  }

  // Detect era from keywords
  const eraPatterns: Array<{ pattern: RegExp; label: string }> = [
    // Era keywords
    { pattern: /\bModern\b|\bContemporary\b|\bPresent Day\b/i, label: 'Modern' },
    { pattern: /\bAncient\b|\bAntiquity\b/i, label: 'Ancient' },
    { pattern: /\bMedieval\b|\bMiddle Ages\b/i, label: 'Medieval' },
    { pattern: /\bFuture\b|\bFuturistic\b|\bSci-Fi\b/i, label: 'Future' },
    { pattern: /\bPrehistoric\b/i, label: 'Prehistoric' },
    { pattern: /\bQing Dynasty\b/i, label: 'Qing Dynasty' },
    { pattern: /\bMing Dynasty\b/i, label: 'Ming Dynasty' },
    { pattern: /\bSong Dynasty\b/i, label: 'Song Dynasty' },
    { pattern: /\bTang Dynasty\b/i, label: 'Tang Dynasty' },
    { pattern: /\bHan Dynasty\b/i, label: 'Han Dynasty' },
    { pattern: /\bThree Kingdoms\b/i, label: 'Three Kingdoms' },
    { pattern: /\bRepublic\b|Republic of China/i, label: 'Republic of China' },
    { pattern: /\b20th Century\b|twentieth century/i, label: '20th Century' },
    { pattern: /\b21st Century\b|twenty-first century/i, label: '21st Century' },
    { pattern: /(\d{2})s?\s+era/i, label: '' }, // 80s era -> handled below
  ];

  let era = 'Modern';
  for (const { pattern, label } of eraPatterns) {
    const eraMatch = fullText.match(pattern);
    if (eraMatch) {
      era = label || `${eraMatch[1]}s`;
      break;
    }
  }

  // Infer era from year
  if (storyStartYear) {
    if (storyStartYear >= 2000) {
      era = 'Modern';
    } else if (storyStartYear >= 1949) {
      era = 'Modern';
    } else if (storyStartYear >= 1912) {
      era = 'Early 20th Century';
    } else if (storyStartYear >= 1840) {
      era = 'Late 19th Century';
    }
  }

  return {
    era,
    timelineSetting,
    storyStartYear,
    storyEndYear,
  };
}

/**
 * Detect script genre from outline and character bios via keyword matching.
 */
function detectGenre(outline: string, characterBios: string): string {
  const fullText = `${outline}\n${characterBios}`;

  const genrePatterns: Array<{ keywords: RegExp; genre: string }> = [
    // Genre patterns
    { keywords: /wuxia|martial arts|kung fu|sword|jianghu|sect|skill/i, genre: 'Wuxia' },
    { keywords: /xianxia|cultivation|spiritual|flying|immortal/i, genre: 'Xianxia' },
    { keywords: /fantasy|magic|dragon|elf|otherworld/i, genre: 'Fantasy' },
    { keywords: /sci-fi|space|robot|alien|future|AI/i, genre: 'Sci-Fi' },
    { keywords: /mystery|murder|detective|case|police/i, genre: 'Mystery' },
    { keywords: /horror|ghost|haunted|curse/i, genre: 'Horror' },
    { keywords: /business|startup|corporate|company|IPO/i, genre: 'Business' },
    { keywords: /palace|harem|emperor|selection/i, genre: 'Palace Drama' },
    { keywords: /intrigue|family|manor|inner/i, genre: 'Family Intrigue' },
    { keywords: /spy|espionage|agent|intelligence/i, genre: 'Espionage' },
    { keywords: /military|war|soldier|battle|army/i, genre: 'Military' },
    { keywords: /crime|criminal|forensic|police/i, genre: 'Crime' },
    { keywords: /medical|hospital|doctor|surgery/i, genre: 'Medical' },
    { keywords: /legal|lawyer|court|trial/i, genre: 'Legal' },
    { keywords: /school|campus|college|university/i, genre: 'Campus' },
    { keywords: /romance|love|relationship/i, genre: 'Romance' },
    { keywords: /family|parent|sibling/i, genre: 'Family' },
    { keywords: /comedy|funny|humor/i, genre: 'Comedy' },
    { keywords: /historical|dynasty|emperor/i, genre: 'Historical' },
    { keywords: /rural|village|countryside/i, genre: 'Rural' },
  ];

  for (const { keywords, genre } of genrePatterns) {
    if (keywords.test(fullText)) {
      return genre;
    }
  }

  return '';
}

/**
 * Extract world/setting description from outline and character bios.
 */
function extractWorldSetting(outline: string, characterBios: string): string {
  const fullText = `${outline}\n${characterBios}`;

  const patterns = [
    /(?:World Setting|Setting|Background)[：:] *([^\n]{10,200})/i,
    /(?:The story takes place) *([^\n]{10,200})/i,
  ];

  for (const pattern of patterns) {
    const match = fullText.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return '';
}

/**
 * Extract theme keywords from outline and character bios.
 */
function extractThemes(outline: string, characterBios: string): string[] {
  const fullText = `${outline}\n${characterBios}`;
  const themes: string[] = [];

  const themePatterns: Array<{ keywords: RegExp; theme: string }> = [
    // Theme patterns
    { keywords: /struggle|ambition|growth|underdog/i, theme: 'Ambition' },
    { keywords: /revenge|vengeance/i, theme: 'Revenge' },
    { keywords: /love|romance|passion/i, theme: 'Love' },
    { keywords: /family|kinship|parent/i, theme: 'Family' },
    { keywords: /friendship|loyalty|brotherhood/i, theme: 'Friendship' },
    { keywords: /power|intrigue|conspiracy/i, theme: 'Power' },
    { keywords: /justice|truth|fairness/i, theme: 'Justice' },
    { keywords: /freedom|liberation|independence/i, theme: 'Freedom' },
    { keywords: /redemption|forgiveness|atonement/i, theme: 'Redemption' },
    { keywords: /betrayal|trust|treachery/i, theme: 'Betrayal & Trust' },
    { keywords: /fate|destiny/i, theme: 'Fate' },
    { keywords: /war|peace|anti-war/i, theme: 'War & Peace' },
    { keywords: /legacy|heritage|mission/i, theme: 'Legacy' },
    { keywords: /life|death|sacrifice/i, theme: 'Life & Death' },
  ];

  for (const { keywords, theme } of themePatterns) {
    if (keywords.test(fullText) && !themes.includes(theme)) {
      themes.push(theme);
    }
  }

  return themes.slice(0, 5);
}

/**
 * Parse episode markers and split text into episodes.
 */
export function parseEpisodes(text: string): EpisodeRawScript[] {
  const episodes: EpisodeRawScript[] = [];

  // Match English: Episode X / **Episode X: title**
  const episodeRegex = /[*]{0,2}(?:Episode\s+(\d+))[：:]?\s*([^\n*]*?)[*]{0,2}(?=\n|$)/gi;
  const matches = [...text.matchAll(episodeRegex)];

  if (matches.length === 0) {
    // No episode markers found — treat entire text as episode 1
    const scenes = parseScenes(text);
    return [{
      episodeIndex: 1,
      title: 'Episode 1',
      rawContent: text,
      scenes,
      shotGenerationStatus: 'idle',
    }];
  }

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const episodeIndex = parseInt(match[1], 10);
    const rawTitle = match[2]?.trim().replace(/^\*+|\*+$/g, '').trim() || '';
    const episodeTitle = rawTitle
      ? `Episode ${episodeIndex}: ${rawTitle}`
      : `Episode ${episodeIndex}`;

    const startIndex = match.index! + match[0].length;
    const endIndex = i < matches.length - 1 ? matches[i + 1].index! : text.length;
    const rawContent = text.slice(startIndex, endIndex).trim();

    const scenes = parseScenes(rawContent);
    const season = extractSeasonFromScenes(scenes);

    episodes.push({
      episodeIndex,
      title: episodeTitle,
      rawContent,
      scenes,
      shotGenerationStatus: 'idle',
      season,
    });
  }

  return episodes;
}

/**
 * Parse scenes within a single episode.
 */
export function parseScenes(episodeText: string): SceneRawContent[] {
  const scenes: SceneRawContent[] = [];

  // Standard scene header formats:
  // English: **1-1 Day Int. Location** / 1-1 Day Int. Location
  const sceneHeaderRegex = /[*]{0,2}(\d+-\d+)\s*(Day|Night|Dawn|Dusk|Morning|Evening)\s*(Int\.?\/?Ext\.?|Int\.?|Ext\.?)\s+([^*\n]+)[*]{0,2}/gi;
  const sceneMatches = [...episodeText.matchAll(sceneHeaderRegex)];

  if (sceneMatches.length === 0) {
    // No standard scene headers — try loose "number-number description" format
    const looseSceneRegex = /^[*]{0,2}(\d+-\d+)\s+([^*\n]+)[*]{0,2}$/gm;
    const looseMatches = [...episodeText.matchAll(looseSceneRegex)];

    if (looseMatches.length > 0) {
      for (let i = 0; i < looseMatches.length; i++) {
        const match = looseMatches[i];
        const sceneNumber = match[1];
        const rawDesc = match[2].replace(/\*{1,2}/g, '').trim();

        // Extract time-of-day from end of description
        const timeWords = [
          'Day', 'Night', 'Dawn', 'Dusk', 'Morning', 'Evening',
        ];
        let timeOfDay = 'Day';
        let locationDesc = rawDesc;

        for (const tw of timeWords) {
          const endPattern = new RegExp(`[，,\\s]${tw}\\s*$`, 'i');
          if (endPattern.test(rawDesc)) {
            timeOfDay = tw;
            locationDesc = rawDesc.replace(endPattern, '').trim();
            break;
          }
          if (rawDesc.toLowerCase() === tw.toLowerCase()) {
            timeOfDay = tw;
            locationDesc = 'Unknown';
            break;
          }
        }

        // Extract Int./Ext. marker
        let interior = '';
        const interiorMatch = locationDesc.match(/[,\s](Int\.?\/?Ext\.?|Int\.?|Ext\.?)\s*/i);
        if (interiorMatch) {
          interior = interiorMatch[1];
          locationDesc = locationDesc.replace(interiorMatch[0], '').trim();
        }

        const location = locationDesc.replace(/[，,]/g, ' ').replace(/\s+/g, ' ').trim() || 'Unknown';

        const sceneHeader = interior
          ? `${sceneNumber} ${timeOfDay} ${interior} ${location}`
          : `${sceneNumber} ${timeOfDay} ${location}`;

        const startIndex = match.index! + match[0].length;
        const endIndex = i < looseMatches.length - 1 ? looseMatches[i + 1].index! : episodeText.length;
        const content = episodeText.slice(startIndex, endIndex).trim();

        const characters = parseCharacters(content);
        const dialogues = parseDialogues(content);
        const actions = parseActions(content);
        const subtitles = parseSubtitles(content);
        const weather = detectWeather(content, actions);

        scenes.push({
          sceneHeader,
          characters,
          content,
          dialogues,
          actions,
          subtitles,
          weather,
          timeOfDay,
        });
      }
      return scenes;
    }

    // Fallback to alternative scene format
    return parseAlternativeSceneFormat(episodeText);
  }

  for (let i = 0; i < sceneMatches.length; i++) {
    const match = sceneMatches[i];
    const sceneNumber = match[1];
    const timeOfDay = match[2];
    const interior = match[3];
    const location = match[4]?.trim() || 'Unknown';

    const startIndex = match.index! + match[0].length;
    const endIndex = i < sceneMatches.length - 1 ? sceneMatches[i + 1].index! : episodeText.length;
    const content = episodeText.slice(startIndex, endIndex).trim();

    const characters = parseCharacters(content);
    const dialogues = parseDialogues(content);
    const actions = parseActions(content);
    const subtitles = parseSubtitles(content);
    const weather = detectWeather(content, actions);

    scenes.push({
      sceneHeader: `${sceneNumber} ${timeOfDay} ${interior} ${location}`,
      characters,
      content,
      dialogues,
      actions,
      subtitles,
      weather,
      timeOfDay,
    });
  }

  return scenes;
}

/**
 * Parse alternative scene formats when standard headers don't match.
 */
function parseAlternativeSceneFormat(text: string): SceneRawContent[] {
  const scenes: SceneRawContent[] = [];

  // Try: Scene X / [Scene: description]
  const altRegex = /(?:(?:Scene)\s*(\d+)|\[Scene[：:]?\s*([^\]]+)])/gi;
  const matches = [...text.matchAll(altRegex)];

  if (matches.length > 0) {
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const startIndex = match.index! + match[0].length;
      const endIndex = i < matches.length - 1 ? matches[i + 1].index! : text.length;
      const content = text.slice(startIndex, endIndex).trim();

      scenes.push({
        sceneHeader: match[0].replace(/[【】]/g, ''),
        characters: parseCharacters(content),
        content,
        dialogues: parseDialogues(content),
        actions: parseActions(content),
        subtitles: parseSubtitles(content),
      });
    }
  } else {
    // Treat as single scene
    scenes.push({
      sceneHeader: 'Main Scene',
      characters: parseCharacters(text),
      content: text,
      dialogues: parseDialogues(text),
      actions: parseActions(text),
      subtitles: parseSubtitles(text),
    });
  }

  return scenes;
}

/**
 * Detect weather from scene content and action descriptions.
 */
function detectWeather(content: string, actions: string[]): string | undefined {
  const fullText = `${content} ${actions.join(' ')}`;

  if (/heavy rain|downpour|torrential/i.test(fullText)) return 'Heavy Rain';
  if (/drizzle|light rain/i.test(fullText)) return 'Light Rain';
  if (/\brain\b/i.test(fullText)) return 'Rain';
  if (/blizzard/i.test(fullText)) return 'Blizzard';
  if (/\bsnow\b|snowing/i.test(fullText)) return 'Snow';
  if (/dense fog/i.test(fullText)) return 'Dense Fog';
  if (/\bfog\b|\bmist\b/i.test(fullText)) return 'Fog';
  if (/\bgale\b/i.test(fullText)) return 'Gale';
  if (/\bwind\b|\bwindy\b|\bbreeze\b/i.test(fullText)) return 'Wind';
  if (/cloudy|overcast/i.test(fullText)) return 'Cloudy';
  if (/sunny|clear sky/i.test(fullText)) return 'Sunny';
  if (/thunder|lightning|thunderstorm/i.test(fullText)) return 'Thunderstorm';

  return undefined;
}

/**
 * Extract season info from scene subtitles.
 */
function extractSeasonFromScenes(scenes: SceneRawContent[]): string | undefined {
  for (const scene of scenes) {
    for (const subtitle of scene.subtitles) {
      // English season keywords
      const seasonMatchEN = subtitle.match(/\b(Spring|Summer|Fall|Autumn|Winter)\b/i);
      if (seasonMatchEN) {
        const s = seasonMatchEN[1].toLowerCase();
        if (s === 'spring') return 'Spring';
        if (s === 'summer') return 'Summer';
        if (s === 'fall' || s === 'autumn') return 'Fall';
        if (s === 'winter') return 'Winter';
      }
    }
  }
  return undefined;
}

/**
 * Parse character names from scene content.
 */
function parseCharacters(text: string): string[] {
  const characters: Set<string> = new Set();

  // 1. From "Characters:" line
  const charLineMatch = text.match(/Characters[:\uff1a]\s*([^\n]+)/i);
  if (charLineMatch) {
    const charList = charLineMatch[1].split(/[,]/);
    charList.forEach(c => {
      const name = c.trim();
      if (name) characters.add(name);
    });
  }

  // 2. From dialogue lines (speaker before colon)
  const dialogueRegex = /^([^:(\n△]{1,10})[:](?:\s*\([^\)]+\))?/gm;
  const dialogueMatches = [...text.matchAll(dialogueRegex)];
  dialogueMatches.forEach(m => {
    const name = m[1].trim();
    // Filter out non-character content
    if (name && !name.match(/^[△[]/) && !name.match(/^(Subtitle|Narration|Scene|Characters|VO)/i)) {
      characters.add(name);
    }
  });

  return Array.from(characters);
}

/**
 * Parse dialogue lines from scene content.
 */
function parseDialogues(text: string): DialogueLine[] {
  const dialogues: DialogueLine[] = [];

  // Format: CharacterName: (action) dialogue line
  const dialogueRegex = /^([^:(\n△]{1,10})[:]\s*(?:\(([^)]+)\))?\s*(.+)$/gm;

  const matches = [...text.matchAll(dialogueRegex)];

  for (const match of matches) {
    const character = match[1].trim();
    const parenthetical = match[2]?.trim();
    const line = match[3]?.trim();

    // Filter out non-dialogue content
    if (character && line && !character.match(/^(Subtitle|Narration|Scene|Characters|VO)/i)) {
      dialogues.push({
        character,
        parenthetical,
        line,
      });
    }
  }

  return dialogues;
}

/**
 * Parse action lines (△ prefix).
 */
function parseActions(text: string): string[] {
  const actions: string[] = [];

  const actionRegex = /^△(.+)$/gm;
  const matches = [...text.matchAll(actionRegex)];

  matches.forEach(m => {
    const action = m[1].trim();
    if (action) actions.push(action);
  });

  return actions;
}

/**
 * Parse subtitles ([Subtitle: ...], [VO: ...], etc.).
 */
function parseSubtitles(text: string): string[] {
  const subtitles: string[] = [];

  const subtitleRegex = /\[([^\]]+)\]/g;
  const matches = [...text.matchAll(subtitleRegex)];

  matches.forEach(m => {
    subtitles.push(m[1]);
  });

  return subtitles;
}

/**
 * Convert Chinese numeral string to Arabic number.
 */
function parseNumericInput(input: string): number {
  const match = input.match(/\d+/);
  return match ? parseInt(match[0], 10) : 1;
}

/**
 * Extract character info from character bios text.
 */
export function parseCharacterBios(bios: string): ScriptCharacter[] {
  const characters: ScriptCharacter[] = [];

  // Match: Name (age): description
  const charRegex = /([^:\n,]+?)(?:[(](\d+)(?:\s*(?:years?\s*old))?[)])[,:]\s*([^\n]+(?:\n(?![^:\n]+[:])[^\n]+)*)/g;
  const matches = [...bios.matchAll(charRegex)];

  let index = 1;
  for (const match of matches) {
    const name = match[1].trim();
    const age = match[2] || '';
    const description = match[3].trim();

    // Skip non-character content
    if (name.length > 10 || name.match(/^\d/) || name.match(/^Episode/i)) continue;

    characters.push({
      id: `char_${index}`,
      name,
      age,
      role: description,
      personality: extractPersonality(description),
      traits: extractTraits(description),
    });
    index++;
  }

  return characters;
}

/**
 * Extract personality traits from description.
 */
function extractPersonality(description: string): string {
  // English personality keywords
  const enMatch = description.match(/(?:personality|temperament|character)[:\s]+([^.,;]+)/i);
  if (enMatch) return enMatch[1].trim();
  return '';
}

/**
 * Extract core traits from description.
 */
function extractTraits(description: string): string {
  const traits: string[] = [];

  // English trait patterns
  const enTraitPatterns = [
    /\b(intelligent|smart|clever)\b/i,
    /\b(resilient|determined|strong-willed)\b/i,
    /\b(diligent|hardworking)\b/i,
    /\b(honest|humble)\b/i,
    /\b(grateful|kind|compassionate)\b/i,
  ];

  for (const pattern of enTraitPatterns) {
    const match = description.match(pattern);
    if (match) traits.push(match[1]);
  }

  return traits.join(', ');
}

/**
 * Clean character name by removing markdown marks and extra symbols.
 */
function cleanCharacterName(rawName: string): string {
  let name = rawName.trim();
  name = name.replace(/\*+/g, "");
  name = name.replace(/[\uff08(][^\uff09)]*[)]?/g, "");
  name = name.replace(/[\uff09)]/g, "");
  name = name.replace(/["\u201c\u201d'\u2018\u2019\u201d\u2019]/g, "");
  name = name.replace(/(VO|os)$/i, "");
  name = name.replace(/^[\s,\uff0c\u3001\uff1b;\uff1a:\u3000]+|[\s,\uff0c\u3001\uff1b;\uff1a:\u3000]+$/g, "");
  return name.trim();
}

/**
 * Split combined character names, e.g. "John, Jane" -> ["John", "Jane"]
 */
function splitMultipleCharacters(rawName: string): string[] {
  // Strip markdown
  const name = rawName.replace(/\*+/g, '').trim();
  // Split by common delimiters
  const parts = name.split(/[,]\s+/).filter(p => p.length > 0);
  return parts;
}

/**
 * Check if a string is a valid character name (loose filter, AI handles refinement).
 */
function isValidCharacterName(name: string): boolean {
  // Skip empty names
  if (!name || name.length < 1) return false;
  // Skip overly long names (relaxed to 20 chars for English names)
  if (name.length > 20) return false;
  // Skip pure numbers
  if (/^\d+$/.test(name)) return false;
  // Skip names with special symbols
  if (/[*\-+<>|[\]{}]/.test(name)) return false;
  // Skip obvious non-character words
  const obviousNonCharacters = [
    'VO', 'Narrator', 'os', 'Left', 'Right', 'Center', 'Back', 'Distance',
    'Efficiency', 'Rate', 'Sort', 'Customer', 'Eye', 'Holding', 'Straight',
    'Document', 'Gaze', 'Voice', 'TV', 'Phone'
  ];
  if (obviousNonCharacters.includes(name)) return false;
  return true;
}

/**
 * Process a single character name and add to the set.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function processAndAddCharacter(
  rawName: string,
  existingNames: Set<string>,
  newCharacters: ScriptCharacter[],
  index: { value: number },
  role: string
): void {
  // Split combined names first
  const parts = splitMultipleCharacters(rawName);

  for (const part of parts) {
    const name = cleanCharacterName(part);
    if (!isValidCharacterName(name)) continue;
    if (existingNames.has(name)) continue;

    existingNames.add(name);
    newCharacters.push({
      id: `char_${index.value}`,
      name,
      role,
    });
    index.value++;
  }
}

/**
 * Extract characters from all scenes (supplements characters not in bios).
 */
function extractCharactersFromScenes(
  episodeScripts: EpisodeRawScript[],
  existingCharacters: ScriptCharacter[]
): ScriptCharacter[] {
  const existingNames = new Set(existingCharacters.map(c => c.name));
  const newCharacters: ScriptCharacter[] = [];
  const index = { value: existingCharacters.length + 1 };

  // Count appearances per character
  const appearanceCount = new Map<string, number>();

  for (const ep of episodeScripts) {
    for (const scene of ep.scenes) {
      for (const charName of scene.characters) {
        const parts = splitMultipleCharacters(charName);
        for (const part of parts) {
          const name = cleanCharacterName(part);
          if (isValidCharacterName(name)) {
            appearanceCount.set(name, (appearanceCount.get(name) || 0) + 1);
          }
        }
      }

      for (const dialogue of scene.dialogues) {
        const parts = splitMultipleCharacters(dialogue.character);
        for (const part of parts) {
          const name = cleanCharacterName(part);
          if (isValidCharacterName(name)) {
            appearanceCount.set(name, (appearanceCount.get(name) || 0) + 1);
          }
        }
      }
    }
  }

  // Sort by appearance count, add new characters
  const sortedNames = [...appearanceCount.entries()]
    .filter(([name]) => !existingNames.has(name))
    .sort((a, b) => b[1] - a[1]);

  for (const [name, count] of sortedNames) {
    existingNames.add(name);
    newCharacters.push({
      id: `char_${index.value}`,
      name,
      role: count > 5 ? `Supporting role (${count} appearances)` : `Minor role (${count} appearances)`,
    });
    index.value++;
  }

  return newCharacters;
}

/**
 * Convert parsed script to ScriptData format (for system display).
 */
export function convertToScriptData(
  background: ProjectBackground,
  episodeScripts: EpisodeRawScript[]
): ScriptData {
  // 1. Extract main characters from bios
  const mainCharacters = parseCharacterBios(background.characterBios);

  // 2. Supplement with characters from scenes
  const additionalCharacters = extractCharactersFromScenes(episodeScripts, mainCharacters);

  // 3. Merge character lists (bio characters first)
  const characters = [...mainCharacters, ...additionalCharacters];

  console.log(`[convertToScriptData] Characters: ${mainCharacters.length} from bios, ${additionalCharacters.length} from scenes, ${characters.length} total`);

  const episodes: Episode[] = [];
  const scenes: ScriptScene[] = [];

  let sceneIndex = 1;

  for (const ep of episodeScripts) {
    const episodeId = `ep_${ep.episodeIndex}`;
    const sceneIds: string[] = [];

    for (const scene of ep.scenes) {
      const sceneId = `scene_${sceneIndex}`;
      sceneIds.push(sceneId);

      // Parse scene header for time and location
      // Standard: "1-1 Day Int. Location"
      // Loose: "1-1 Day Location"
      const headerParts = scene.sceneHeader.split(/\s+/);
      const timeOfDay = headerParts[1] || 'Day';
      const hasInterior = headerParts[2] && /^(Int\.?\/?Ext\.?|Int\.?|Ext\.?)$/i.test(headerParts[2]);
      const locationStartIndex = hasInterior ? 3 : 2;
      const rawLocation = headerParts.slice(locationStartIndex).join(' ') || headerParts[headerParts.length - 1] || 'Unknown';

      const location = cleanLocationString(rawLocation);

      scenes.push({
        id: sceneId,
        name: `${ep.episodeIndex}-${sceneIndex} ${location}`,
        location: location,
        time: normalizeTime(timeOfDay),
        atmosphere: detectAtmosphere(scene.content),
      });

      sceneIndex++;
    }

    episodes.push({
      id: episodeId,
      index: ep.episodeIndex,
      title: ep.title,
      description: extractEpisodeDescription(ep.rawContent),
      sceneIds,
    });
  }

  // Detect language from content - default to English
  const language = 'en';

  return {
    title: background.title,
    genre: detectGenre(background.outline, background.characterBios),
    logline: extractLogline(background.outline),
    language,
    characters,
    episodes,
    scenes,
    storyParagraphs: [],
  };
}

/**
 * Normalize time-of-day string to standard values.
 */
function normalizeTime(time: string): string {
  // English time mappings
  const timeMap: Record<string, string> = {
    'Day': 'day',
    'Night': 'night',
    'Dawn': 'dawn',
    'Dusk': 'dusk',
    'Morning': 'dawn',
    'Evening': 'dusk',
  };
  return timeMap[time] || timeMap[time.charAt(0).toUpperCase() + time.slice(1).toLowerCase()] || 'day';
}

/**
 * Detect scene atmosphere from content.
 */
function detectAtmosphere(content: string): string {
  if (/tense|danger|conflict|fight|angry/i.test(content)) return 'Tense';
  if (/warm|happy|laugh|joy/i.test(content)) return 'Warm';
  if (/sad|cry|pain|tears/i.test(content)) return 'Sad';
  if (/mysterious|dark|eerie/i.test(content)) return 'Mysterious';
  return 'Calm';
}

// detectGenre is defined above, supports full genre detection

/**
 * Extract logline from outline (first sentence).
 */
function extractLogline(outline: string): string {
  // English sentence ending: .!?
  const firstSentence = outline.match(/^[^.!?\n]+[.!?]/);
  return firstSentence ? firstSentence[0] : outline.slice(0, 100);
}

/**
 * Extract episode description (first 100 characters).
 */
function extractEpisodeDescription(content: string): string {
  return content.replace(/\*{1,2}/g, '').slice(0, 100).trim() + '...';
}
