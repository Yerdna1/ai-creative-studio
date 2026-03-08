// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * AI Scene Finder
 *
 * Search scripts for scenes based on user natural language descriptions and generate professional scene data
 *
 * Features:
 * 1. Parse user input (e.g., "Missing episode 5's Zhang family living room")
 * 2. Search scene information in scripts
 * 3. AI generates complete scene data (including visual prompts)
 */

import type { ScriptScene, ProjectBackground, EpisodeRawScript, SceneRawContent } from '@/types/script';
import { callFeatureAPI } from '@/lib/ai/feature-router';

// ==================== Type Definitions ====================

export interface SceneSearchResult {
  /** Whether scene was found */
  found: boolean;
  /** Scene name/location */
  name: string;
  /** Confidence 0-1 */
  confidence: number;
  /** Episode numbers where it appears */
  episodeNumbers: number[];
  /** Found context (scene content, etc.) */
  contexts: string[];
  /** AI generated complete scene data */
  scene?: ScriptScene;
  /** Search explanation */
  message: string;
}

/** @deprecated No longer needed to manually pass, automatically obtained from service mapping */
export interface SceneFinderOptions {
  apiKey?: string;
  provider?: string;
  baseUrl?: string;
}

// ==================== Core Functions ====================

/**
 * Parse user input to extract scene name and episode number information
 */
function parseSceneQuery(query: string): { name: string | null; episodeNumber: number | null } {
  let name: string | null = null;
  let episodeNumber: number | null = null;

  // Extract episode number: EP.X, EpX, episode X
  const episodeMatch = query.match(/EP\.?\s*(\d+)|episode\s*(\d+)/i);
  if (episodeMatch) {
    episodeNumber = parseInt(episodeMatch[1] || episodeMatch[2]);
  }

  // Remove episode number related text
  const cleanQuery = query
    .replace(/EP\.?\s*\d+/gi, '')
    .replace(/episode\s*\d+/gi, '')
    .trim();

  // Pattern 1: "Add scene coffee shop" / "Missing scene coffee shop"
  let nameMatch = cleanQuery.match(/^(?:add|missing|find|need|create)\s+(?:scene\s+)?["']?(.+?)["']?\s*$/i);
  if (nameMatch) {
    name = nameMatch[1].trim();
  }

  // Pattern 2: "scene: coffee shop" / "location: coffee shop"
  if (!name) {
    nameMatch = cleanQuery.match(/^(?:scene|location|place|background)[:\s]+["']?(.+?)["']?\s*$/i);
    if (nameMatch) {
      name = nameMatch[1].trim();
    }
  }

  // Pattern 3: "coffee shop scene" / "coffee shop location"
  if (!name) {
    nameMatch = cleanQuery.match(/^(.+?)\s+(?:scene|location|place|background)\s*$/i);
    if (nameMatch) {
      name = nameMatch[1].trim();
    }
  }

  // Pattern 4: Direct scene name (2-30 characters)
  if (!name) {
    const pureQuery = cleanQuery.replace(/^(?:add|missing|find|need|create|show|display)+/gi, '').trim();
    if (pureQuery.length >= 2 && pureQuery.length <= 30 && /^[A-Za-z\s\-'']+$/.test(pureQuery)) {
      name = pureQuery;
    }
  }

  return { name, episodeNumber };
}

/**
 * Search scenes from scripts
 */
function searchSceneInScripts(
  name: string,
  episodeScripts: EpisodeRawScript[],
  targetEpisode?: number
): {
  found: boolean;
  episodeNumbers: number[];
  contexts: string[];
  matchedScenes: { episodeIndex: number; scene: SceneRawContent }[];
} {
  const episodeNumbers: number[] = [];
  const contexts: string[] = [];
  const matchedScenes: { episodeIndex: number; scene: SceneRawContent }[] = [];

  // Iterate through scripts to search
  const scriptsToSearch = targetEpisode
    ? episodeScripts.filter(ep => ep.episodeIndex === targetEpisode)
    : episodeScripts;

  for (const ep of scriptsToSearch) {
    if (!ep || !ep.scenes) continue;

    for (const scene of ep.scenes) {
      if (!scene) continue;

      // Check if scene header matches (scene header usually contains location information)
      const sceneHeader = scene.sceneHeader || '';
      const isMatch =
        sceneHeader.includes(name) ||
        name.includes(sceneHeader.split(/\s+/).slice(-1)[0] || '') || // Match last word (usually location)
        sceneHeader.split(/\s+/).some(word => word.includes(name) || name.includes(word));

      if (isMatch) {
        if (!episodeNumbers.includes(ep.episodeIndex)) {
          episodeNumbers.push(ep.episodeIndex);
        }

        matchedScenes.push({ episodeIndex: ep.episodeIndex, scene });

        // Collect context
        if (contexts.length < 5) {
          const sceneContext = [
            `【Episode ${ep.episodeIndex} - ${sceneHeader}】`,
            scene.characters?.length ? `Characters: ${scene.characters.join(', ')}` : '',
            scene.actions?.slice(0, 2).join('\n') || '',
            scene.dialogues?.slice(0, 2).map(d => `${d.character}: ${d.line.slice(0, 30)}...`).join('\n') || '',
          ].filter(Boolean).join('\n');
          contexts.push(sceneContext);
        }
      }
    }
  }

  return {
    found: matchedScenes.length > 0,
    episodeNumbers,
    contexts,
    matchedScenes,
  };
}

/**
 * Use AI to generate complete scene data
 */
async function generateSceneData(
  name: string,
  background: ProjectBackground,
  contexts: string[],
  matchedScenes: { episodeIndex: number; scene: SceneRawContent }[]
): Promise<ScriptScene> {

  // Extract information from matched scenes
  const sceneHeaders = matchedScenes.map(s => s.scene.sceneHeader).filter(Boolean);
  const allActions = matchedScenes.flatMap(s => s.scene.actions || []).slice(0, 5);
  const allCharacters = [...new Set(matchedScenes.flatMap(s => s.scene.characters || []))];

  const systemPrompt = `You are a professional film and television scene designer, skilled at extracting scene features from script information and generating professional scene data.

Please generate complete scene data based on the provided script information and scene context.

【Output Format】
Please return in JSON format, containing the following fields:
{
  "name": "Scene name (short)",
  "location": "Detailed location description",
  "time": "Time (e.g., 'day', 'night', 'dusk', 'morning')",
  "atmosphere": "Atmosphere description (e.g., 'tense', 'warm', 'oppressive', 'lively')",
  "visualPrompt": "English visual prompt for AI image generation, describing scene environment, lighting, color tone, architectural style, etc.",
  "visualPromptZh": "Chinese visual description",
  "tags": ["tag1", "tag2"],
  "notes": "Scene notes (plot function)"
}`;

  const userPrompt = `【Script Information】
Title: "${background.title}"
Genre: ${background.genre || 'Drama'}
Era: ${background.era || 'Modern'}

【Story Outline】
${background.outline?.slice(0, 800) || 'None'}

【World/Style Setting】
${background.worldSetting?.slice(0, 500) || 'None'}

【Scene to Analyze】
${name}

【Scene Headers Where Scene Appears】
${sceneHeaders.slice(0, 5).join('\n')}

【Action Descriptions Within Scene】
${allActions.join('\n')}

【Characters Appearing in Scene】
${allCharacters.join(', ')}

【Scene Context】
${contexts.slice(0, 3).join('\n\n')}

Please generate complete data for scene "${name}" based on the above information. If information is insufficient, please make reasonable inferences based on script type and era background.`;

  try {
    // Uniformly get configuration from service mapping
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
        if (Array.isArray(val)) {
          return val.join(', ');
        }
        return Object.entries(val)
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ');
      }
      return String(val);
    };

    // Ensure tags is a string array
    const ensureTags = (val: unknown): string[] | undefined => {
      if (!val) return undefined;
      if (Array.isArray(val)) {
        return val.map(t => String(t));
      }
      if (typeof val === 'string') {
        return val.split(/[,，、]/).map(t => t.trim()).filter(Boolean);
      }
      return undefined;
    };

    return {
      id: `scene_${Date.now()}`,
      name: ensureString(parsed.name) || name,
      location: ensureString(parsed.location) || name,
      time: ensureString(parsed.time) || 'day',
      atmosphere: ensureString(parsed.atmosphere) || '',
      visualPrompt: ensureString(parsed.visualPrompt),
      tags: ensureTags(parsed.tags),
      notes: ensureString(parsed.notes),
    };
  } catch (error) {
    console.error('[generateSceneData] AI generation failed:', error);
    // Return basic data
    return {
      id: `scene_${Date.now()}`,
      name,
      location: name,
      time: 'day',
      atmosphere: '',
    };
  }
}

/**
 * Main function: Find and generate scenes based on user descriptions
 */
export async function findSceneByDescription(
  userQuery: string,
  background: ProjectBackground,
  episodeScripts: EpisodeRawScript[],
  existingScenes: ScriptScene[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _options?: SceneFinderOptions // No longer needed, kept for compatibility
): Promise<SceneSearchResult> {
  console.log('[findSceneByDescription] User query:', userQuery);

  // 1. Parse user input
  const { name, episodeNumber } = parseSceneQuery(userQuery);

  if (!name) {
    return {
      found: false,
      name: '',
      confidence: 0,
      episodeNumbers: [],
      contexts: [],
      message: 'Unable to recognize scene name. Please use a format like "Missing episode 5 Zhang family living room" or "Add hospital corridor scene".',
    };
  }

  console.log('[findSceneByDescription] Parse result:', { name, episodeNumber });

  // 2. Check if already exists
  const existing = existingScenes.find(s =>
    s.name === name ||
    s.location === name ||
    (s.name && (s.name.includes(name) || name.includes(s.name))) ||
    s.location.includes(name) ||
    name.includes(s.location)
  );

  if (existing) {
    return {
      found: true,
      name: existing.name || existing.location,
      confidence: 1,
      episodeNumbers: [],
      contexts: [],
      message: `Scene "${existing.name || existing.location}" already exists in scene list.`,
      scene: existing,
    };
  }

  // 3. Search from scripts
  const searchResult = searchSceneInScripts(name, episodeScripts, episodeNumber || undefined);

  if (!searchResult.found) {
    // Not found but user can confirm whether to create
    return {
      found: false,
      name,
      confidence: 0.3,
      episodeNumbers: [],
      contexts: [],
      message: episodeNumber
        ? `Scene "${name}" not found in episode ${episodeNumber}. Still want to create this scene?`
        : `Scene "${name}" not found in script. Still want to create this scene?`,
    };
  }

  // 4. Use AI to generate complete scene data
  console.log('[findSceneByDescription] Generating scene data...');

  const scene = await generateSceneData(
    name,
    background,
    searchResult.contexts,
    searchResult.matchedScenes
  );

  // Calculate confidence
  const confidence = Math.min(
    0.5 + searchResult.matchedScenes.length * 0.1 + searchResult.episodeNumbers.length * 0.05,
    1
  );

  return {
    found: true,
    name: scene.name || scene.location,
    confidence,
    episodeNumbers: searchResult.episodeNumbers,
    contexts: searchResult.contexts,
    message: `Found scene "${scene.name || scene.location}", appears in episodes ${searchResult.episodeNumbers.join(', ')}.`,
    scene,
  };
}

/**
 * Quick search only (no AI call), for fast preview
 */
export function quickSearchScene(
  userQuery: string,
  episodeScripts: EpisodeRawScript[],
  existingScenes: ScriptScene[]
): { name: string | null; found: boolean; message: string; existingScene?: ScriptScene } {
  const { name, episodeNumber } = parseSceneQuery(userQuery);

  if (!name) {
    return { name: null, found: false, message: 'Please enter scene name' };
  }

  // Check if already exists
  const existing = existingScenes.find(s =>
    s.name === name ||
    s.location === name ||
    (s.name && (s.name.includes(name) || name.includes(s.name))) ||
    s.location.includes(name) ||
    name.includes(s.location)
  );

  if (existing) {
    return {
      name: existing.name || existing.location,
      found: true,
      message: `Scene "${existing.name || existing.location}" already exists`,
      existingScene: existing,
    };
  }

  // Quick search
  const searchResult = searchSceneInScripts(name, episodeScripts, episodeNumber || undefined);

  if (searchResult.found) {
    return {
      name,
      found: true,
      message: `Found "${name}", appears in episodes ${searchResult.episodeNumbers.join(', ')}`,
    };
  }

  return {
    name,
    found: false,
    message: `"${name}" not found in script`,
  };
}
