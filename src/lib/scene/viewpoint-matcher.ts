// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Viewpoint Matcher Service
 *
 * Intelligently match viewpoint variants in scene library based on shot action descriptions
 * Strategy: Use keyword matching first, fall back to AI only when no match found
 */

import type { Scene } from '@/stores/scene-store';
import { getFeatureConfig } from '@/lib/ai/feature-router';

// ==================== Type Definitions ====================

export interface ViewpointMatchResult {
  sceneLibraryId: string;
  viewpointId?: string;
  sceneReferenceImage?: string;
  matchedSceneName: string;
  matchMethod: 'keyword' | 'ai' | 'fallback';
  confidence: number; // 0-1
}

// ==================== Keyword Mapping ====================

// Viewpoint keyword mapping (for quick matching)
const VIEWPOINT_KEYWORDS: Record<string, string[]> = {
  // Dining/table related
  'dining': [
    'eating', 'dinner', 'lunch', 'meal', 'food', 'table', 'dinner table', 'dining table',
    'serve food', 'dish', 'plate', 'bowl', 'utensils', 'chopsticks', 'drink',
    'toast', 'glass', 'wine', 'feast', 'banquet',
  ],
  // Sofa/living room rest area related
  'sofa': [
    'sofa', 'couch', 'tv', 'television', 'coffee table', 'tea table', 'sit',
    'sitting', 'lying down', 'remote', 'controller', 'living room', 'lounge',
  ],
  // Window related
  'window': [
    'window', 'outside window', 'window sill', 'balcony', 'curtain', 'view',
    'look out', 'gaze', 'lean on window', 'through window',
  ],
  // Entrance/door related
  'entrance': [
    'door', 'entrance', 'doorway', 'entry', 'exit', 'come in', 'go out',
    'welcome', 'hallway', 'foyer', 'doorbell', 'knock', 'porch',
  ],
  // Kitchen related
  'kitchen': [
    'kitchen', 'cook', 'cooking', 'stove', 'oven', 'fridge', 'refrigerator',
    'sink', 'counter', 'cabinet', 'pot', 'pan', 'cutting board',
  ],
  // Study/work related
  'study': [
    'desk', 'computer', 'pc', 'reading', 'writing', 'work', 'office',
    'bookshelf', 'bookcase', 'lamp', 'notebook', 'keyboard', 'study room',
  ],
  // Bedroom related
  'bedroom': [
    'bed', 'sleep', 'sleeping', 'lie down', 'wake up', 'bedside', 'pillow',
    'blanket', 'mattress', 'bedroom', 'resting',
  ],
  // Balcony/outdoor related
  'balcony': [
    'balcony', 'terrace', 'patio', 'railing', 'sunny', 'hanging clothes',
    'plants', 'flower pot',
  ],
  // Corridor/hallway related
  'corridor': [
    'corridor', 'hallway', 'passage', 'stairs', 'staircase', 'upstairs',
    'downstairs', 'steps', 'aisle',
  ],
  // Bathroom related
  'bathroom': [
    'bathroom', 'restroom', 'toilet', 'wash', 'sink', 'mirror', 'shower',
    'bath', 'tub', 'brush teeth',
  ],
};

// Reverse index: keyword -> viewpoint ID
const KEYWORD_TO_VIEWPOINT: Record<string, string> = {};
for (const [viewpointId, keywords] of Object.entries(VIEWPOINT_KEYWORDS)) {
  for (const keyword of keywords) {
    KEYWORD_TO_VIEWPOINT[keyword] = viewpointId;
  }
}

// ==================== Cache ====================

// AI match result cache (avoid duplicate calls)
const aiMatchCache = new Map<string, { viewpointId: string | null; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 30; // 30-minute cache

// ==================== Core Functions ====================

/**
 * Use keywords for quick viewpoint matching
 */
function matchByKeyword(actionSummary: string): string | null {
  for (const [keyword, viewpointId] of Object.entries(KEYWORD_TO_VIEWPOINT)) {
    if (actionSummary.includes(keyword)) {
      return viewpointId;
    }
  }
  return null;
}

/**
 * Use AI for viewpoint matching
 */
async function matchByAI(
  actionSummary: string,
  availableViewpoints: Array<{ id: string; name: string }>
): Promise<string | null> {
  // Check cache
  const cacheKey = `${actionSummary}:${availableViewpoints.map(v => v.id).join(',')}`;
  const cached = aiMatchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.viewpointId;
  }

  // Get AI configuration
  const config = getFeatureConfig('chat');
  if (!config) {
    console.warn('[ViewpointMatcher] No chat API configured for AI matching');
    return null;
  }
  const _model = config.models?.[0];
  if (!_model) {
    console.warn('[ViewpointMatcher] No chat model configured for AI matching');
    return null;
  }
  const apiKey = config.apiKey;
  if (!apiKey) {
    console.warn('[ViewpointMatcher] No chat API key configured for AI matching');
    return null;
  }

  try {
    const viewpointList = availableViewpoints
      .map(v => `- ${v.id}: ${v.name}`)
      .join('\n');

    const prompt = `Based on the following action description, determine the most matching scene viewpoint.

[Action Description]
${actionSummary}

[Available Viewpoints]
${viewpointList}

Please only return the most matching viewpoint ID (e.g., dining, sofa, window, etc.), without any explanation.
If there is no suitable viewpoint, return null.`;

    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        provider: config.platform,
        apiKey,
        model: _model,
        temperature: 0.1, // Low temperature for more deterministic output
        maxTokens: 50,
      }),
    });

    if (!response.ok) {
      throw new Error(`AI API error: ${response.status}`);
    }

    const data = await response.json();
    const result = data.content?.trim().toLowerCase();

    // Verify returned value is a valid viewpoint ID
    const viewpointId = availableViewpoints.find(v => v.id === result)?.id || null;

    // Cache result
    aiMatchCache.set(cacheKey, { viewpointId, timestamp: Date.now() });

    return viewpointId;
  } catch (error) {
    console.error('[ViewpointMatcher] AI matching failed:', error);
    return null;
  }
}

/**
 * Find matching scene library scenes (parent scenes)
 */
function findMatchingParentScenes(
  sceneName: string,
  sceneLibraryScenes: Scene[]
): Scene[] {
  // Only look at parent scenes (non-viewpoint variants)
  const parentScenes = sceneLibraryScenes.filter(s =>
    !s.parentSceneId && !s.isViewpointVariant
  );

  // Bidirectional matching
  const matches = parentScenes.filter(s =>
    s.name.includes(sceneName) || sceneName.includes(s.name)
  );

  return matches;
}

/**
 * Get all viewpoint variants of a parent scene
 */
function getViewpointVariants(
  parentSceneId: string,
  sceneLibraryScenes: Scene[]
): Scene[] {
  return sceneLibraryScenes.filter(s => s.parentSceneId === parentSceneId);
}

/**
 * Use keyword fuzzy matching on viewpoint names to match action descriptions
 * Used for custom viewpoint names (e.g., "bus window viewpoint") matching with action descriptions
 */
function matchByViewpointNameKeywords(
  actionSummary: string,
  viewpointVariants: Scene[]
): Scene | null {
  if (!actionSummary || viewpointVariants.length === 0) return null;

  // For each viewpoint variant, extract keywords from name and check if they appear in action description
  for (const variant of viewpointVariants) {
    const viewpointName = variant.viewpointName || variant.name || '';

    // Extract keywords from viewpoint name (remove common words like "viewpoint", "angle", etc.)
    const cleanedName = viewpointName
      .replace(/viewpoint|angle|shot|scene|view|camera|perspective/gi, '')
      .trim();

    if (!cleanedName) continue;

    // Split name into keywords (by common separators and individual Chinese characters)
    const keywords = extractKeywords(cleanedName);

    // Check if action description contains these keywords
    for (const keyword of keywords) {
      if (keyword.length >= 2 && actionSummary.includes(keyword)) {
        console.log(`[ViewpointMatcher] Matched viewpoint "${viewpointName}" by keyword "${keyword}"`);
        return variant;
      }
    }
  }
  
  return null;
}

/**
 * Extract keywords from name
 */
function extractKeywords(name: string): string[] {
  const keywords: string[] = [];

  // 1. Use entire name as keyword
  if (name.length >= 2) {
    keywords.push(name);
  }

  // 2. Split by space/slash/dash
  const parts = name.split(/[\s/\-—|]+/);
  for (const part of parts) {
    if (part.length >= 2) {
      keywords.push(part);
    }
  }

  // 3. Extract common location phrases
  const locationPatterns = [
    /window/i, /door/i, /entrance/i, /exit/i,
    /seat/i, /chair/i, /sofa/i, /bed/i,
    /kitchen/i, /bedroom/i, /bathroom/i, /living room/i, /study/i,
    /balcony/i, /terrace/i, /patio/i, /corridor/i, /hallway/i,
    /stairs/i, /garden/i, /yard/i,
    /front/i, /back/i, /left/i, /right/i, /center/i, /middle/i,
    /corner/i, /aisle/i, /passage/i,
  ];

  for (const pattern of locationPatterns) {
    const match = name.match(pattern);
    if (match) {
      keywords.push(match[0]);
    }
  }

  return [...new Set(keywords)]; // Deduplicate
}

// ==================== Main Entry ====================

/**
 * Intelligently match scenes and viewpoints in scene library
 *
 * @param sceneName Script scene name (e.g., "Zhang Family Living Room")
 * @param actionSummary Shot action description (e.g., "At dining table, Zhang Ming eating with parents")
 * @param sceneLibraryScenes All scenes in scene library
 * @param useAI Whether to enable AI fallback (default true)
 */
export async function matchSceneAndViewpoint(
  sceneName: string,
  actionSummary: string,
  sceneLibraryScenes: Scene[],
  useAI: boolean = true
): Promise<ViewpointMatchResult | null> {
  // 1. Find matching parent scenes
  const parentScenes = findMatchingParentScenes(sceneName, sceneLibraryScenes);
  if (parentScenes.length === 0) {
    return null;
  }

  // 2. First try predefined keyword matching for viewpoints (e.g., dining, sofa, window, etc.)
  const keywordViewpointId = matchByKeyword(actionSummary);

  if (keywordViewpointId) {
    // Find corresponding viewpoint variant in parent scenes
    for (const parent of parentScenes) {
      const variants = getViewpointVariants(parent.id, sceneLibraryScenes);
      const matchedVariant = variants.find(v => v.viewpointId === keywordViewpointId);
      
      if (matchedVariant) {
        return {
          sceneLibraryId: matchedVariant.id,
          viewpointId: matchedVariant.viewpointId,
          sceneReferenceImage: matchedVariant.referenceImage || matchedVariant.referenceImageBase64,
          matchedSceneName: matchedVariant.name,
          matchMethod: 'keyword',
          confidence: 0.9,
        };
      }
    }
  }

  // 2.5 Try keyword matching with custom viewpoint names
  for (const parent of parentScenes) {
    const variants = getViewpointVariants(parent.id, sceneLibraryScenes);
    if (variants.length > 0) {
      const matchedVariant = matchByViewpointNameKeywords(actionSummary, variants);
      if (matchedVariant) {
        return {
          sceneLibraryId: matchedVariant.id,
          viewpointId: matchedVariant.viewpointId,
          sceneReferenceImage: matchedVariant.referenceImage || matchedVariant.referenceImageBase64,
          matchedSceneName: matchedVariant.viewpointName || matchedVariant.name,
          matchMethod: 'keyword',
          confidence: 0.85,
        };
      }
    }
  }

  // 3. Keyword matching failed, try AI matching
  if (useAI) {
    for (const parent of parentScenes) {
      const variants = getViewpointVariants(parent.id, sceneLibraryScenes);
      
      if (variants.length > 0) {
        const availableViewpoints = variants
          .filter(v => v.viewpointId && v.viewpointName)
          .map(v => ({ id: v.viewpointId!, name: v.viewpointName! }));
        
        if (availableViewpoints.length > 0) {
          const aiViewpointId = await matchByAI(actionSummary, availableViewpoints);
          
          if (aiViewpointId) {
            const matchedVariant = variants.find(v => v.viewpointId === aiViewpointId);
            if (matchedVariant) {
              return {
                sceneLibraryId: matchedVariant.id,
                viewpointId: matchedVariant.viewpointId,
                sceneReferenceImage: matchedVariant.referenceImage || matchedVariant.referenceImageBase64,
                matchedSceneName: matchedVariant.name,
                matchMethod: 'ai',
                confidence: 0.7,
              };
            }
          }
        }
      }
    }
  }

  // 4. All matching failed, return first parent scene as fallback
  const bestParent = parentScenes[0];
  return {
    sceneLibraryId: bestParent.id,
    viewpointId: undefined,
    sceneReferenceImage: bestParent.referenceImage || bestParent.referenceImageBase64,
    matchedSceneName: bestParent.name,
    matchMethod: 'fallback',
    confidence: 0.5,
  };
}

/**
 * Synchronous version (keyword matching only, no AI calls)
 * Used for scenarios requiring immediate response
 */
export function matchSceneAndViewpointSync(
  sceneName: string,
  actionSummary: string,
  sceneLibraryScenes: Scene[]
): ViewpointMatchResult | null {
  // 1. Find matching parent scenes
  const parentScenes = findMatchingParentScenes(sceneName, sceneLibraryScenes);
  if (parentScenes.length === 0) {
    return null;
  }

  // 2. Use predefined keyword matching for viewpoints
  const keywordViewpointId = matchByKeyword(actionSummary);
  
  if (keywordViewpointId) {
    for (const parent of parentScenes) {
      const variants = getViewpointVariants(parent.id, sceneLibraryScenes);
      const matchedVariant = variants.find(v => v.viewpointId === keywordViewpointId);
      
      if (matchedVariant) {
        return {
          sceneLibraryId: matchedVariant.id,
          viewpointId: matchedVariant.viewpointId,
          sceneReferenceImage: matchedVariant.referenceImage || matchedVariant.referenceImageBase64,
          matchedSceneName: matchedVariant.name,
          matchMethod: 'keyword',
          confidence: 0.9,
        };
      }
    }
  }

  // 2.5 Try keyword matching with custom viewpoint names
  for (const parent of parentScenes) {
    const variants = getViewpointVariants(parent.id, sceneLibraryScenes);
    if (variants.length > 0) {
      const matchedVariant = matchByViewpointNameKeywords(actionSummary, variants);
      if (matchedVariant) {
        return {
          sceneLibraryId: matchedVariant.id,
          viewpointId: matchedVariant.viewpointId,
          sceneReferenceImage: matchedVariant.referenceImage || matchedVariant.referenceImageBase64,
          matchedSceneName: matchedVariant.viewpointName || matchedVariant.name,
          matchMethod: 'keyword',
          confidence: 0.85,
        };
      }
    }
  }

  // 3. Keyword matching failed, return parent scene
  const bestParent = parentScenes[0];
  return {
    sceneLibraryId: bestParent.id,
    viewpointId: undefined,
    sceneReferenceImage: bestParent.referenceImage || bestParent.referenceImageBase64,
    matchedSceneName: bestParent.name,
    matchMethod: 'fallback',
    confidence: 0.5,
  };
}

/**
 * Clear AI matching cache
 */
export function clearAIMatchCache(): void {
  aiMatchCache.clear();
}
