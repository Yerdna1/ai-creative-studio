// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Script Parser Service
 * Uses AI chat APIs to parse screenplay text and extract structured data
 * Based on CineGen-AI geminiService.ts patterns
 */

import type { ScriptData, Shot, Keyframe } from "@/types/script";
import { retryOperation } from "@/lib/utils/retry";
import { cleanJsonString, safeParseJson } from "@/lib/utils/json-cleaner";
import { delay } from "@/lib/utils/rate-limiter";
import { ApiKeyManager } from "@/lib/api-key-manager";
import { getModelLimits, parseModelLimitsFromError, cacheDiscoveredLimits, estimateTokens } from "@/lib/ai/model-registry";
import { t } from '@/i18n';
import { getDefaultLanguage, getLanguage, getPromptLanguageSuffix } from './prompt-language';

/**
 * Normalize time value to match scene-store TIME_PRESETS
 * Maps time descriptions to standard time IDs
 */
function normalizeTimeValue(time: string | undefined): string {
  if (!time) return 'day';

  const timeMap: Record<string, string> = {
    'day': 'day',
    'daytime': 'day',
    'morning': 'day',
    'afternoon': 'day',
    'night': 'night',
    'nighttime': 'night',
    'midnight': 'midnight',
    'dusk': 'dusk',
    'sunset': 'dusk',
    'dawn': 'dawn',
    'sunrise': 'dawn',
    'noon': 'noon',
  };

  const normalized = time.toLowerCase().trim();
  return timeMap[normalized] || timeMap[time] || 'day';
}

const PARSE_SYSTEM_PROMPT = `You are a professional script analyst. Analyze the screenplay/story text provided by the user and extract structured information.

Return results strictly in the following JSON format (do not include any other text):
{
  "title": "Story title",
  "genre": "Genre (e.g.: romance, thriller, comedy, etc.)",
  "logline": "One-sentence summary",
  "characters": [
    {
      "id": "char_1",
      "name": "Character name",
      "gender": "Gender",
      "age": "Age",
      "role": "Detailed identity/background description including occupation, status, backstory, etc.",
      "personality": "Detailed personality description including behavior patterns, values, etc.",
      "traits": "Detailed description of core traits including notable abilities, characteristics, etc.",
      "skills": "Skills/abilities description (e.g. martial arts, magic, professional skills, etc.)",
      "keyActions": "Key actions/deeds description, important historical actions",
      "appearance": "Physical appearance (if available)",
      "relationships": "Relationships with other characters",
      "importance": "protagonist/supporting/minor/extra",
      "tags": ["Character tags, e.g.: warrior, lead, swordsman, villain, general"],
      "notes": "Character notes (plot context, e.g.: Main protagonist, triggers intense conflict in Act 3)"
    }
  ],
  "episodes": [
    {
      "id": "ep_1",
      "index": 1,
      "title": "Episode 1 title",
      "description": "Episode summary",
      "sceneIds": ["scene_1", "scene_2"]
    }
  ],
  "scenes": [
    {
      "id": "scene_1",
      "episodeId": "ep_1",
      "name": "Scene name (e.g.: City Main Street, Wilderness Temple, Palace Courtyard)",
      "location": "Detailed location description (including architectural features, environmental elements, geographical characteristics, etc.)",
      "time": "Time setting (day/night/dawn/dusk/noon/midnight)",
      "atmosphere": "Detailed atmosphere description (e.g.: tense and oppressive, warm and peaceful, mysterious and eerie, tragic and solemn)",
      "visualPrompt": "Detailed visual description of the scene for concept art generation (including lighting, weather, architectural style, special elements, in English)",
      "tags": ["Scene key element tags, e.g.: columns, windows, architecture, ruins, forest"],
      "notes": "Location notes (plot context, e.g.: Ancient hall where the final battle takes place)"
    }
  ],
  "storyParagraphs": [
    {
      "id": 1,
      "text": "Paragraph content",
      "sceneRefId": "scene_1"
    }
  ]
}

Important requirements:
1. [Character info must be detailed]: Do not simplify character information! Preserve all details from the source text:
   - role: Complete identity/background (e.g. "A righteous warrior from the north, wielder of the legendary sword, former guardian of the city...")
   - personality: Complete personality description (e.g. "Values justice, protects the innocent, indifferent to power, principled, disdains defending against false accusations...")
   - traits: Complete core traits (e.g. "Exceptional martial skills, compassionate, indifferent to fame")
   - skills: Skills description (e.g. "Master of the Phoenix Sword technique, able to suppress powerful enemies with a sheathed blade")
   - keyActions: Key deeds (e.g. "Guarded the city for twelve months, defeated thirteen enemy leaders...")
   - importance: Character importance (protagonist=lead, supporting=major supporting role, minor=minor role, extra=background)
   - tags: Character tags, 3-5, describing character type and traits (e.g.: warrior, lead, swordsman, guardian)
   - notes: Character notes explaining the character's role in the plot (e.g.: "Main protagonist, triggers conflict in Act 3")
2. [Scene design must be detailed]: Do not simplify scene information! Scenes are the foundation for visual generation:
   - name: Scene names should be specific and distinctive (not just "interior" or "exterior")
   - location: Detailed location description including architectural features, environmental elements
   - time: Use English time words (day/night/dawn/dusk/noon/midnight)
   - atmosphere: Detailed atmosphere, not just a single word
   - visualPrompt: Write visual description of the scene in English (lighting, weather, style, architectural features, etc.), for example:
     "Ancient Chinese city street at dawn, misty atmosphere, traditional wooden buildings with curved roofs, lanterns hanging, cobblestone path, golden morning light, dramatic clouds"
   - tags: Scene key element tags, 3-6, describing environmental features (e.g.: columns, windows, architecture, smoke, ruins)
   - notes: Location notes explaining the scene's role in the plot (e.g.: "Ancient hall where the final battle takes place")
3. Identify multi-episode structure. If the script contains markers like "Episode X", "Chapter X", "Part X", etc., split into multiple episodes
4. If there are no explicit episode markers, create a single episode containing all scenes
5. Character IDs use char_1, char_2 format
6. Scene IDs use scene_1, scene_2 format
7. Episode IDs use ep_1, ep_2 format`;

// Per-scene shot generation prompt (based on CineGen-AI)
const SHOT_GENERATION_SYSTEM_PROMPT = `You are a professional storyboard artist / cinematographer. Generate a detailed, cinematic shot list (Camera Blocking) for a single scene.

Return results strictly in the following JSON array format (do not include any other text):
[
  {
    "sceneId": "scene_1",
    "shotSize": "Shot size (WS/MS/CU/ECU)",
    "duration": 4.0,
    "visualDescription": "Detailed visual description including scene, lighting, character actions, expressions, etc.",
    "actionSummary": "Brief action summary",
    "cameraMovement": "Camera movement",
    "dialogue": "Dialogue content (including speaker and tone)",
    "ambientSound": "Ambient sound description",
    "soundEffect": "Sound effect description",
    "characters": ["Character name"],
    "keyframes": [
      {
        "id": "kf-1-start",
        "type": "start",
        "visualPrompt": "Detailed English visual description (for image generation)"
      }
    ]
  }
]

Storyboarding principles:
1. [Important] Maximum 6-8 shots per scene to avoid JSON truncation
2. [Shot sizes] WS=Wide Shot, MS=Medium Shot, CU=Close-Up, ECU=Extreme Close-Up, FS=Full Shot
3. [Camera movement] Use professional terminology:
   - Static, Dolly In, Dolly Out, Pan Left/Right, Tilt Up/Down
   - Tracking, Crane, Handheld, Zoom In/Out
4. [Visual description] visualDescription should read like a cinematic screenplay, describing in detail:
   - Scene lighting (e.g. "A faint glow envelops the darkness")
   - Character state (e.g. "Wearing a bright yellow robe, standing tall and alert")
   - Atmosphere (e.g. "A tense standoff atmosphere")
   - Specific actions (e.g. "Camera slowly pushes in")
5. [Audio design] Consider for each shot:
   - ambientSound: Environmental sounds (wind, rain, crowd noise, silence, etc.)
   - soundEffect: Sound effects (footsteps, sword clash, door creaking, explosion, etc.)
   - dialogue: Dialogue should include speaker and tone (e.g. "Master (deep, solemn): The heavens are vast...")
6. [Duration] duration estimates seconds per shot (2-8 seconds, based on content complexity)
7. [visualPrompt] English description, under 40 words, for image generation, format:
   "[Scene setting], [lighting], [character appearance and action], [mood], [camera angle], [style keywords]"
   Example: "Ancient altar in darkness, dim candlelight, Taoist priest in yellow robe standing solemnly, mysterious atmosphere, wide shot, cinematic, dramatic lighting"`;

interface ParseOptions {
  apiKey: string; // Supports comma-separated multiple keys
  provider: string;
  baseUrl: string;
  model: string;
  language?: string;
  sceneCount?: number; // Limit number of scenes (e.g. for trailers)
  shotCount?: number; // Shots per scene hint (passed to shot generation)
  keyManager?: ApiKeyManager; // Optional: use existing key manager for rotation
  temperature?: number; // Custom temperature, default 0.7
  maxTokens?: number; // Custom max output tokens, default 4096
  /** Disable reasoning model deep thinking (e.g. GLM-4.7/4.5) to avoid reasoning exhausting tokens */
  disableThinking?: boolean;
}

interface ShotGenerationOptions extends ParseOptions {
  targetDuration: string;
  styleId: string;
  characterDescriptions?: Record<string, string>;
  shotCount?: number; // Limit total shot count (e.g. for trailers)
  concurrency?: number; // Number of scenes to process in parallel (default 1, can be higher with multiple keys)
}

// Use imported cleanJsonString from json-cleaner.ts

/**
 * Call chat API (Zhipu or OpenAI compatible) with multi-key rotation support
 */
export async function callChatAPI(
  systemPrompt: string,
  userPrompt: string,
  options: ParseOptions
): Promise<string> {
  const { apiKey, provider, baseUrl, model } = options;
  
  console.log('\n[callChatAPI] ==================== API Call Start ====================');
  console.log('[callChatAPI] provider:', provider);
  console.log('[callChatAPI] apiKey length:', apiKey?.length || 0);
  console.log('[callChatAPI] apiKey is empty:', !apiKey);
  console.log('[callChatAPI] baseUrl:', baseUrl);
  console.log('[callChatAPI] systemPrompt length:', systemPrompt.length);
  console.log('[callChatAPI] userPrompt length:', userPrompt.length);
  
  if (!apiKey) {
    console.error('[callChatAPI] API Key is empty!');
    throw new Error(t('lib.error.configureApiKey'));
  }
  
  // Create or use existing key manager for rotation
  const keyManager = options.keyManager || new ApiKeyManager(apiKey);
  
  const totalKeys = keyManager.getTotalKeyCount();
  console.log(`[callChatAPI] Using ${provider}, ${totalKeys} API key(s)`);

  if (!baseUrl) {
    throw new Error(t('lib.error.configureBaseUrl'));
  }
  if (!model) {
    throw new Error(t('lib.error.modelNotConfigured'));
  }
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const url = /\/v\d+$/.test(normalizedBaseUrl)
    ? `${normalizedBaseUrl}/chat/completions`
    : `${normalizedBaseUrl}/v1/chat/completions`;
  
  // Query model limits from Model Registry (three-tier lookup: cache → static → default)
  const modelLimits = getModelLimits(model);
  const requestedMaxTokens = options.maxTokens ?? 4096;
  const effectiveMaxTokens = Math.min(requestedMaxTokens, modelLimits.maxOutput);
  if (effectiveMaxTokens < requestedMaxTokens) {
    console.log(`[callChatAPI] max_tokens auto-clamped: ${requestedMaxTokens} -> ${effectiveMaxTokens} (${model} maxOutput=${modelLimits.maxOutput})`);
  }
  
  // === Token Budget Calculator ===
  const inputTokens = estimateTokens(systemPrompt + userPrompt);
  const safetyMargin = Math.ceil(modelLimits.contextWindow * 0.1);
  const availableForOutput = modelLimits.contextWindow - inputTokens - safetyMargin;
  const utilization = Math.round((inputTokens / modelLimits.contextWindow) * 100);
  
  console.log(
    `[Dispatch] ${model}: input≈${inputTokens} / ctx=${modelLimits.contextWindow}, ` +
    `output=${effectiveMaxTokens} (headroom ${100 - utilization}%)`
  );
  
  // Input exceeds 90% of context window → throw error (skip request, save cost)
  if (inputTokens > modelLimits.contextWindow * 0.9) {
    const err = new Error(
      `[TokenBudget] Input tokens (≈${inputTokens}) exceed 90% of ${model}'s context window ` +
      `(${modelLimits.contextWindow}). Please reduce input or use a model with a larger context window.`
    );
    (err as Error & { code?: string; inputTokens?: number; contextWindow?: number }).code = 'TOKEN_BUDGET_EXCEEDED';
    (err as Error & { code?: string; inputTokens?: number; contextWindow?: number }).inputTokens = inputTokens;
    (err as Error & { code?: string; inputTokens?: number; contextWindow?: number }).contextWindow = modelLimits.contextWindow;
    throw err;
  }
  
  // Available output space less than 50% of requested → print warning
  if (availableForOutput < requestedMaxTokens * 0.5) {
    console.warn(
      `[Dispatch] ⚠️ ${model}: Output space tight! Available≈${availableForOutput} tokens, ` +
      `requested=${requestedMaxTokens}, output may be truncated`
    );
  }

  console.log('[callChatAPI] Request URL:', url);

  // Use retryOperation with key rotation on rate limit
  return await retryOperation(async () => {
    // Get current key from rotation
    const currentKey = keyManager.getCurrentKey();
    if (!currentKey) {
      throw new Error('No API keys available');
    }
    
    console.log(`[callChatAPI] Using key index, available: ${keyManager.getAvailableKeyCount()}/${totalKeys}`);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${currentKey}`,
    };
    
    // Model selection: must use the configured model
    const modelName = model;
    console.log('[callChatAPI] Using model:', modelName);
    
    const body: Record<string, unknown> = {
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: options.temperature ?? 0.7,
      max_tokens: effectiveMaxTokens,
    };

    // Reasoning models (e.g. GLM-4.7/4.5) support disabling deep thinking via thinking.type
    if (options.disableThinking) {
      body.thinking = { type: 'disabled' };
      console.log('[callChatAPI] Deep thinking disabled (thinking: disabled)');
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      
      // Handle rate limit or auth error with key rotation
      if (keyManager.handleError(response.status)) {
        console.log(`[callChatAPI] Rotated to next API key due to error ${response.status}, available: ${keyManager.getAvailableKeyCount()}/${totalKeys}`);
      }
      
      // === Error-driven Discovery: auto-discover model limits from 400 errors and retry ===
      if (response.status === 400) {
        const discovered = parseModelLimitsFromError(errorText);
        if (discovered) {
          cacheDiscoveredLimits(model, discovered);
          
          // If maxOutput limit discovered and current request exceeds it, retry with correct value
          if (discovered.maxOutput && effectiveMaxTokens > discovered.maxOutput) {
            const correctedMaxTokens = Math.min(requestedMaxTokens, discovered.maxOutput);
            console.warn(
              `[callChatAPI] Discovered ${model} maxOutput=${discovered.maxOutput}, ` +
              `auto-retrying with max_tokens=${correctedMaxTokens}...`
            );
            const retryBody = { ...body, max_tokens: correctedMaxTokens };
            const retryResp = await fetch(url, {
              method: 'POST',
              headers,
              body: JSON.stringify(retryBody),
            });
            if (retryResp.ok) {
              const retryData = await retryResp.json();
              const retryContent = retryData.choices?.[0]?.message?.content;
              if (retryContent) {
                if (totalKeys > 1) keyManager.rotateKey();
                return retryContent;
              }
            } else {
              console.warn('[callChatAPI] Discovery retry still failed:', retryResp.status);
            }
          }
        }
      }
      
      const error = new Error(`API request failed: ${response.status} - ${errorText}`);
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      // Diagnostic log: record the actual structure returned by the API
      const finishReason = data.choices?.[0]?.finish_reason;
      const usage = data.usage;
      const reasoningContent = data.choices?.[0]?.message?.reasoning_content;
      console.error('[callChatAPI] API returned empty content! Diagnostics:');
      console.error('[callChatAPI]   finish_reason:', finishReason);
      console.error('[callChatAPI]   usage:', JSON.stringify(usage));
      console.error('[callChatAPI]   choices length:', data.choices?.length);
      console.error('[callChatAPI]   message keys:', data.choices?.[0]?.message ? Object.keys(data.choices[0].message) : 'N/A');
      console.error('[callChatAPI]   reasoning_content length:', reasoningContent?.length || 0);
      console.error('[callChatAPI]   raw response (first 500 chars):', JSON.stringify(data).slice(0, 500));
      
      // Content filter: try rotating key and retrying
      if (finishReason === 'sensitive' || finishReason === 'content_filter') {
        if (keyManager.handleError(403)) {
          console.warn(`[callChatAPI] Content filtered (${finishReason}), rotating key to retry`);
        }
        throw new Error(t('lib.error.contentFilterFailed', { reason: finishReason }));
      }
      
      // Reasoning model fallback: if reasoning_content exists but content is empty, the model exhausted tokens on thinking
      if (finishReason === 'length' && reasoningContent) {
        // Only extract from code-fenced JSON (bare JSON in reasoning is often draft/incomplete)
        const jsonMatch = reasoningContent.match(/```json\s*([\s\S]*?)```/);
        if (jsonMatch) {
          const extracted = jsonMatch[1] || jsonMatch[0];
          console.log('[callChatAPI] Extracted JSON from reasoning_content');
          return extracted;
        }
        // Don't try greedy regex on reasoning — it captures draft/incomplete JSON with ellipsis
        
        // Check reasoning token ratio — if reasoning used >80% of completion tokens,
        // the model spent too much budget on "thinking", auto-retry with doubled max_tokens
        const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens || 0;
        const completionTokens = usage?.completion_tokens || 0;
        const currentMaxTokens = body.max_tokens as number;
        const newMaxTokens = Math.min(currentMaxTokens * 2, modelLimits.maxOutput);

        if (reasoningTokens > 0 && completionTokens > 0 &&
            reasoningTokens / completionTokens > 0.8 &&
            newMaxTokens > currentMaxTokens) {
          console.warn(
            `[callChatAPI] Reasoning model token exhausted (reasoning: ${reasoningTokens}/${completionTokens}), ` +
            `auto-retrying with max_tokens=${newMaxTokens}...`
          );
          
          const retryBody = { ...body, max_tokens: newMaxTokens };
          const retryResp = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(retryBody),
          });
          
          if (retryResp.ok) {
            const retryData = await retryResp.json();
            const retryContent = retryData.choices?.[0]?.message?.content;
            const retryUsage = retryData.usage;
            console.log(
              `[callChatAPI] Retry result: content=${retryContent?.length || 0} chars, ` +
              `reasoning=${retryUsage?.completion_tokens_details?.reasoning_tokens || '?'}, ` +
              `completion=${retryUsage?.completion_tokens || '?'}`
            );
            if (retryContent) {
              if (totalKeys > 1) keyManager.rotateKey();
              return retryContent;
            }
          } else {
            console.warn('[callChatAPI] Retry request failed:', retryResp.status);
          }
        } else {
          console.warn(
            `[callChatAPI] Reasoning model token exhausted: reasoning ${reasoningContent.length} chars, content empty. ` +
            `(reasoning_tokens=${reasoningTokens}, completion_tokens=${completionTokens}, max_tokens=${currentMaxTokens})`
          );
        }
      }
      
      throw new Error(`Empty response from API (finish_reason: ${finishReason || 'unknown'})`);
    }

    // Rotate key after successful request to distribute load
    if (totalKeys > 1) {
      keyManager.rotateKey();
    }

    return content;
  }, { maxRetries: 3, baseDelay: 2000 });
}

/**
 * Parse screenplay text into structured data
 */
export async function parseScript(
  rawScript: string,
  options: ParseOptions
): Promise<ScriptData> {
  // Build scene count limit hint
  const sceneCountHint = options.sceneCount
    ? `\n\n[Important] Extract only the ${options.sceneCount} most important scenes — select the most representative and visually impactful scenes from the story.`
    : '';

  const userPrompt = `Please analyze the following screenplay/story content:

${rawScript}

Language: ${options.language || getDefaultLanguage()}${sceneCountHint}`;

  const langSuffix = getPromptLanguageSuffix(options.language);
  const parseOptions = { ...options, maxTokens: options.maxTokens ?? 8192 };
  const response = await callChatAPI(PARSE_SYSTEM_PROMPT + langSuffix, userPrompt, parseOptions);
  const cleaned = cleanJsonString(response);

  try {
    const parsed = JSON.parse(cleaned);

    // Validate and transform scenes with detailed visual design
    const scenes = (parsed.scenes || []).map((s: Record<string, unknown>, i: number) => ({
      id: s.id || `scene_${i + 1}`,
      name: s.name || s.location || `Scene ${i + 1}`,
      location: s.location || 'Unknown location',
      time: normalizeTimeValue(s.time as string | undefined),
      atmosphere: s.atmosphere || '',
      visualPrompt: s.visualPrompt || '', // For scene concept art generation
      tags: s.tags || [],        // Scene tags
      notes: s.notes || '',      // Scene notes
      episodeId: s.episodeId,
    }));

    // Validate and transform characters with ALL extended fields
    const characters = (parsed.characters || []).map((c: Record<string, unknown>, i: number) => ({
      id: c.id || `char_${i + 1}`,
      name: c.name || `Character ${i + 1}`,
      gender: c.gender,
      age: c.age,
      personality: c.personality,
      role: c.role,
      traits: c.traits,
      skills: c.skills,           // Skills field
      keyActions: c.keyActions,   // Key actions/deeds
      appearance: c.appearance,   // Appearance description
      relationships: c.relationships, // Character relationships
      tags: [c.importance || 'minor', ...(Array.isArray(c.tags) ? c.tags : [])], // importance as first tag
      notes: c.notes || '',       // Character notes
    }));

    // Parse episodes - use AI-generated if available, otherwise create default
    let episodes = (parsed.episodes || []).map((e: Record<string, unknown>, i: number) => ({
      id: e.id || `ep_${i + 1}`,
      index: e.index || i + 1,
      title: e.title || `Episode ${i + 1}`,
      description: e.description,
      sceneIds: e.sceneIds || [],
    }));

    // If no episodes from AI, create default episode with all scenes
    if (episodes.length === 0) {
      episodes = [{
        id: 'ep_1',
        index: 1,
        title: parsed.title || 'Episode 1',
        description: parsed.logline,
        sceneIds: scenes.map((s: { id: string }) => s.id),
      }];
    } else {
      // Ensure all scenes are assigned to an episode
      const assignedSceneIds = new Set(episodes.flatMap((e: { sceneIds: string[] }) => e.sceneIds));
      const unassignedScenes = scenes.filter((s: { id: string }) => !assignedSceneIds.has(s.id));
      if (unassignedScenes.length > 0 && episodes.length > 0) {
        // Add unassigned scenes to the last episode
        episodes[episodes.length - 1].sceneIds.push(...unassignedScenes.map((s: { id: string }) => s.id));
      }
    }

    const scriptData: ScriptData = {
      title: parsed.title || 'Untitled Script',
      genre: parsed.genre,
      logline: parsed.logline,
      language: options.language || getLanguage(),
      characters,
      scenes,
      episodes,
      storyParagraphs: (parsed.storyParagraphs || []).map((p: Record<string, unknown>, i: number) => ({
        id: p.id || i + 1,
        text: p.text || '',
        sceneRefId: p.sceneRefId || 'scene_1',
      })),
    };

    return scriptData;
  } catch (e) {
    console.error('[parseScript] Failed to parse JSON:', cleaned);
    throw new Error(t('lib.error.aiResponseParseFailed'));
  }
}

/**
 * Generate shot list from parsed script data
 * Uses per-scene generation with parallel processing support for multi-key
 */
export async function generateShotList(
  scriptData: ScriptData,
  options: ShotGenerationOptions,
  onSceneProgress?: (sceneIndex: number, total: number) => void,
  onShotsGenerated?: (newShots: Shot[], sceneIndex: number) => void // Streaming callback, notifies immediately after each scene completes
): Promise<Shot[]> {
  if (!scriptData.scenes || scriptData.scenes.length === 0) {
    return [];
  }

  const lang = options.language || scriptData.language || getDefaultLanguage();
  const allShots: Shot[] = [];
  
  // Calculate number of shots to generate per scene
  const totalScenes = scriptData.scenes.length;
  const targetShotCount = options.shotCount;
  const durationSec = options.targetDuration && options.targetDuration !== 'auto'
    ? (parseInt(options.targetDuration) || 0)
    : 0;

  // Determine shots per scene
  let shotsPerScene: number | undefined;
  let shotsPerSceneHint = '6-8';
  if (targetShotCount) {
    // User explicitly specified total shot count
    shotsPerScene = Math.max(1, Math.ceil(targetShotCount / totalScenes));
  } else if (durationSec > 0) {
    // Calculate reasonable shots per scene based on duration (ref: ~2-5 seconds per shot)
    const totalBudget = Math.max(2, Math.ceil(durationSec / 3));
    shotsPerScene = Math.max(1, Math.ceil(totalBudget / totalScenes));
    shotsPerSceneHint = `${shotsPerScene} (target duration ${durationSec}s, ~${totalBudget} total shots)`;
  }

  if (targetShotCount) {
    console.log(`[generateShotList] Target: ${targetShotCount} shots total, ${shotsPerScene} per scene (${totalScenes} scenes)`);
  } else if (durationSec > 0) {
    console.log(`[generateShotList] Duration-based: ~${shotsPerScene} shots/scene for ${durationSec}s (${totalScenes} scenes)`);
  }

  // Determine concurrency based on available keys
  const keyManager = new ApiKeyManager(options.apiKey);
  const keyCount = keyManager.getTotalKeyCount();
  const concurrency = options.concurrency || Math.min(keyCount, 4); // Max 4 parallel
  
  console.log(`[generateShotList] Processing ${totalScenes} scenes with concurrency ${concurrency} (${keyCount} keys)`);

  // Helper function to process a single scene
  const processScene = async (sceneIndex: number): Promise<Shot[]> => {
    const scene = scriptData.scenes[sceneIndex];
    const sceneShots: Shot[] = [];
    
    // Get paragraphs for this scene
    const paragraphs = scriptData.storyParagraphs
      .filter(p => String(p.sceneRefId) === String(scene.id))
      .map(p => p.text)
      .join('\n');

    const sceneContent = paragraphs.trim()
      ? paragraphs
      : `Scene ${sceneIndex + 1}: ${scene.name || scene.location}, ${scene.atmosphere || ''} environment`;

    const userPrompt = `Generate detailed cinematic shots for Scene ${sceneIndex + 1}.
Output language: ${lang}

=== Scene Information ===
Scene name: ${scene.name || scene.location}
Location: ${scene.location}
Time: ${scene.time}
Atmosphere: ${scene.atmosphere}
${(scene as { visualPrompt?: string }).visualPrompt ? `Scene visual reference: ${(scene as { visualPrompt?: string }).visualPrompt}` : ''}

=== Scene Content ===
"${sceneContent.slice(0, 5000)}"

=== Project Information ===
Genre: ${scriptData.genre || 'General'}
Target duration: ${options.targetDuration}
Visual style: ${options.styleId}

=== Character Information ===
${scriptData.characters.map(c => `- ${c.name}: ${c.personality || ''} ${c.appearance || ''}`).join('\n')}

=== Shot Requirements ===
1. Generate ${shotsPerScene ? `exactly ${shotsPerScene}` : shotsPerSceneHint} shots for this scene, selecting the most visually impactful compositions
2. Each shot must include:
   - shotSize: Shot size (WS/MS/CU/ECU)
   - duration: Duration (seconds)
   - visualDescription: Detailed visual description (as detailed as a cinematic screenplay)
   - actionSummary: Brief action summary
   - cameraMovement: Camera movement
   - ambientSound: Ambient sound
   - soundEffect: Sound effects
   - dialogue: Dialogue (including speaker and tone)
   - characters: List of character names present
   - keyframes: Include start keyframe with visualPrompt (English, under 40 words)
3. visualDescription should be detailed, including lighting, character state, atmosphere, camera movement
4. Audio design should be specific enough to recreate the scene atmosphere`;

    try {
      const shotLangSuffix = getPromptLanguageSuffix(options.language);
      const shotOptions = { ...options, maxTokens: options.maxTokens ?? 8192 };
      const response = await callChatAPI(SHOT_GENERATION_SYSTEM_PROMPT + shotLangSuffix, userPrompt, shotOptions);
      const cleaned = cleanJsonString(response);
      const shots = safeParseJson<unknown[]>(cleaned, []);

      // Validate and transform shots - FORCE TRUNCATE to shotsPerScene
      let validShots = Array.isArray(shots) ? shots : [];
      
      // Force truncate to per-scene limit (AI may return more)
      if (shotsPerScene && validShots.length > shotsPerScene) {
        console.log(`[generateShotList] Scene ${sceneIndex + 1}: truncating ${validShots.length} shots to ${shotsPerScene}`);
        validShots = validShots.slice(0, shotsPerScene);
      }
      
      for (const _s of validShots) {
        const s = _s as Record<string, unknown>;
        const sCharacters = (s.characters || s.characterNames || []) as string[];
        const characterIds = sCharacters
          .map((nameOrId: string) => {
            const char = scriptData.characters.find(
              c => c.name === nameOrId || c.id === nameOrId
            );
            return char?.id;
          })
          .filter(Boolean) as string[];

        const keyframes: Keyframe[] = [];
        if (s.keyframes && Array.isArray(s.keyframes)) {
          keyframes.push(...(s.keyframes as Record<string, unknown>[]).map((k: Record<string, unknown>) => ({
            id: k.id as string,
            type: k.type as Keyframe['type'],
            visualPrompt: (k.visualPrompt as string) || '',
            imageUrl: k.imageUrl as string | undefined,
            status: 'pending' as const,
          })));
        } else if (s.visualPrompt) {
          keyframes.push({
            id: `kf-${sceneIndex}-${sceneShots.length}-start`,
            type: 'start' as const,
            visualPrompt: s.visualPrompt as string,
            status: 'pending' as const,
          });
        }

        sceneShots.push({
          id: `shot_${sceneIndex}_${sceneShots.length}`,
          index: sceneShots.length + 1,
          sceneRefId: String(scene.id),
          actionSummary: (s.actionSummary as string) || '',
          visualDescription: (s.visualDescription as string) || '',
          cameraMovement: s.cameraMovement as string,
          shotSize: s.shotSize as string,
          duration: (s.duration as number) || 4,
          visualPrompt: (s.visualPrompt as string) || keyframes[0]?.visualPrompt || '',
          videoPrompt: (s.videoPrompt as string) || '',
          dialogue: s.dialogue as string,
          ambientSound: (s.ambientSound as string) || '',
          soundEffect: (s.soundEffect as string) || '',
          characterNames: (s.characters || s.characterNames || []) as string[],
          characterIds,
          characterVariations: {},
          keyframes,
          imageStatus: 'idle' as const,
          imageProgress: 0,
          videoStatus: 'idle' as const,
          videoProgress: 0,
        });
      }
      
      console.log(`[generateShotList] Scene ${sceneIndex + 1} generated ${sceneShots.length} shots`);
      
      // Streaming callback: immediately notify about newly generated shots
      if (onShotsGenerated && sceneShots.length > 0) {
        onShotsGenerated(sceneShots, sceneIndex);
      }
    } catch (e) {
      console.error(`[generateShotList] Failed for scene ${sceneIndex + 1}:`, e);
    }
    
    return sceneShots;
  };

  // Process scenes in parallel batches
  let completedCount = 0;
  for (let i = 0; i < scriptData.scenes.length; i += concurrency) {
    const batch = scriptData.scenes.slice(i, i + concurrency);
    const batchIndices = batch.map((_, idx) => i + idx);
    
    console.log(`[generateShotList] Processing batch ${Math.floor(i / concurrency) + 1}: scenes ${batchIndices.map(x => x + 1).join(', ')}`);
    
    // Process batch in parallel
    const batchResults = await Promise.all(
      batchIndices.map(idx => processScene(idx))
    );
    
    // Collect results
    batchResults.forEach(shots => allShots.push(...shots));
    
    // Update progress
    completedCount += batch.length;
    if (onSceneProgress) {
      onSceneProgress(completedCount, scriptData.scenes.length);
    }
    
    // Small delay between batches to avoid overwhelming the API
    if (i + concurrency < scriptData.scenes.length) {
      await delay(500);
    }
  }

  // Re-index shots to be sequential
  let finalShots = allShots.map((s, idx) => ({
    ...s,
    id: `shot-${idx + 1}`,
    index: idx + 1,
  }));

  // If shot count limit is set, truncate to specified count
  if (targetShotCount && finalShots.length > targetShotCount) {
    // Select evenly from each scene rather than simply taking the first N
    const sceneShotMap = new Map<string, Shot[]>();
    for (const shot of finalShots) {
      const sceneId = shot.sceneRefId;
      if (!sceneShotMap.has(sceneId)) {
        sceneShotMap.set(sceneId, []);
      }
      sceneShotMap.get(sceneId)!.push(shot);
    }

    // Select proportionally from each scene
    const selectedShots: Shot[] = [];
    const sceneIds = Array.from(sceneShotMap.keys());
    const shotsNeededPerScene = Math.ceil(targetShotCount / sceneIds.length);
    
    for (const sceneId of sceneIds) {
      const sceneShots = sceneShotMap.get(sceneId)!;
      // Take the first N (most important)
      selectedShots.push(...sceneShots.slice(0, shotsNeededPerScene));
    }

    // Truncate to target count and re-index
    finalShots = selectedShots.slice(0, targetShotCount).map((s, idx) => ({
      ...s,
      id: `shot-${idx + 1}`,
      index: idx + 1,
    }));
  }

  return finalShots;
}

/**
 * Generate a screenplay from creative input (idea, MV concept, ad brief, or storyboard script)
 * Output format is compatible with importFullScript() for seamless integration
 * 
 * Supports:
 * - One-liner ideas: "A love story in a coffee shop"
 * - MV concepts: "A music video about summer youth"
 * - Ad briefs: "30-second energy drink commercial"
 * - Detailed storyboard scripts: Scripts with shot descriptions
 */
// Base prompt (for creative inputs without storyboard structure: MV, ads, one-liner ideas, etc.)
const CREATIVE_SCRIPT_BASE_PROMPT = `You are a professional screenwriter and storyboard artist. Generate a complete screenplay based on the user's creative input.

The user may provide:
- A one-liner idea: "A love story in a coffee shop"
- An MV concept: "A music video about summer youth"
- An ad brief: "30-second energy drink commercial"

The output format must strictly follow this structure (this is the standard format for the import system):

---
"Script Title"

**Synopsis:**
[Brief description of the overall story/theme/concept]

**Character Profiles:**
Character A: [Age], [Identity/Occupation], [Personality traits], [Physical appearance]
Character B: [Age], [Identity/Occupation], [Personality traits], [Physical appearance]

**Episode 1**

**1-1 Day Int. Location Name**
Characters: Character A, Character B

△[Scene description including environment, lighting, atmosphere]

Character A: (action/expression) Dialogue content

Character B: (action/expression) Dialogue content

**1-2 Night Ext. Another Location**
...
---

Important requirements:
1. Must include "Title", **Synopsis:**, **Character Profiles:**, **Episode X**
2. Scene header format: **Number Day/Night Int./Ext. Location**
3. Each scene must have a "Characters:" line
4. Action descriptions start with △
5. Dialogue format: Character Name: (action) dialogue
6. MV/ads should also be split into scenes and shots, just with content focused on visuals and sound
7. Match the language of the user's input (English input → English output, Chinese input → Chinese output)`;

// Additional instructions for input with existing storyboard structure (e.g. [Shot 1] through [Shot 12])
const STORYBOARD_STRUCTURE_PROMPT = `

***** Existing storyboard structure detected — the following rules MUST be followed *****

1. Preserve every single shot/scene from the original — none may be omitted
2. If the user input has 12 shots, the output MUST have 12 scenes
3. Each original shot must be converted to a scene in **X-X Day/Night Int./Ext. Location** format
4. Absolutely no merging, omitting, or compressing the number of shots

***** Scene content format (critically important) *****

Each scene may only contain:
1. Characters line: Characters: Character A, Character B
2. One action line: △[Compress all visuals, actions, dialogue, sound effects of that shot into one complete visual description]

Do NOT write multiple lines within a scene! Do NOT list dialogue and sound effects separately! All content must be compressed into a single △ line.

Example:
If user input [Shot 1] contains visual description + dialogue + sound effects, your output should be:
**1-1 Day Int. Basketball Arena**
Characters: Ma Yihua, Shen Xingqing
△Scoreboard close-up shows 68:70, Ma Yihua dribbles under double-team with anxious expression, entire arena holds its breath, heartbeat sound gradually rises

NOT:
**1-1 Day Int. Basketball Arena**
Characters: Ma Yihua, Shen Xingqing
△Scoreboard close-up
Ma Yihua: (anxious)...
[SFX] Heartbeat

The latter is WRONG! It will cause multiple shots to be generated!`;

export interface ScriptGenerationOptions {
  apiKey: string;
  provider: string;
  baseUrl: string;
  model: string;
  language?: string;
  targetDuration?: string;
  sceneCount?: number;
  shotCount?: number;
  styleId?: string;
}

/**
 * Generate screenplay from creative input
 * Returns script text in import-compatible format
 */
export async function generateScriptFromIdea(
  idea: string,
  options: ScriptGenerationOptions
): Promise<string> {
  const { language = getDefaultLanguage(), targetDuration = '60s', sceneCount, shotCount, styleId } = options;
  
  // Generate reference range based on duration (not a hard limit, just guidance for AI)
  const durationSeconds = targetDuration === 'auto' ? 0 : (parseInt(targetDuration) || 60);
  let durationGuidance = '';
  if (durationSeconds > 0 && !sceneCount && !shotCount) {
    // Reference: ~2-5 seconds per shot
    const minShots = Math.max(2, Math.ceil(durationSeconds / 5));
    const maxShots = Math.max(3, Math.ceil(durationSeconds / 2));
    durationGuidance = `\n- Duration reference: A ${durationSeconds}s video typically contains ${minShots}-${maxShots} shots — adjust pacing based on content needs`;
  }

  // Detect input type
  const inputType = detectInputType(idea);

  // Count shots/scenes in the original input
  // Supports multiple formats: [Shot 1], **[Shot 1: ...]**, Shot 1, Scene 1, etc.
  const shotMatches = idea.match(/[*]?[*]?\[\[\s*shot\s*\d+/g) || [];
  const sceneMatches = idea.match(/scene\s*\d+/g) || [];
  const originalShotCount = Math.max(shotMatches.length, sceneMatches.length);
  
  console.log('[generateScriptFromIdea] Shot matches:', shotMatches);
  console.log('[generateScriptFromIdea] Scene matches:', sceneMatches);

  // If existing storyboard structure detected, emphasize preservation
  const preserveStructureNote = originalShotCount > 0
    ? `\n\n***** IMPORTANT *****
The user input contains ${originalShotCount} shots/scenes. Your output MUST have exactly ${originalShotCount} corresponding scenes (**1-1** through **1-${originalShotCount}**).

Important: Each scene may only have ONE △ action line! Compress all visuals, dialogue, and sound effects of that shot into a single sentence.
Do NOT list multiple lines of dialogue or sound effects separately — it will cause multiple shots to be generated!`
    : '';

  const userPrompt = `Generate a complete screenplay based on the following creative input:

[Input type] ${inputType}

[Creative content]
${idea}

[Requirements]
- Language: ${language}
- Target duration: ${targetDuration === 'auto' ? 'Decide based on content' : `approximately ${targetDuration}`}${durationGuidance}
${originalShotCount > 0 ? `- Scene count: Must have exactly ${originalShotCount} (one-to-one with original shots)` : sceneCount ? `- Scene count: approximately ${sceneCount}` : '- Scene count: Decide based on content and duration'}
${originalShotCount > 0 ? '' : shotCount ? `- Shot count: approximately ${shotCount}` : '- Shot count: Decide based on content and duration'}
${styleId ? `- Visual style: ${styleId}` : ''}

Generate a complete screenplay in the standard format, including:
1. Script title
2. Synopsis (brief description of theme/story)
3. Character profiles (basic info for each character)
4. Complete scenes and dialogue${preserveStructureNote}`;

  console.log('[generateScriptFromIdea] Input type:', inputType);
  console.log('[generateScriptFromIdea] Creative content:', idea.substring(0, 100));
  console.log('[generateScriptFromIdea] Detected original shot count:', originalShotCount);

  // Select system prompt based on whether storyboard structure exists
  // - With structure: base + storyboard structure instructions (one action line per scene)
  // - Without structure: base prompt (allows normal multi-action/dialogue expansion)
  const systemPrompt = originalShotCount > 0
    ? CREATIVE_SCRIPT_BASE_PROMPT + STORYBOARD_STRUCTURE_PROMPT
    : CREATIVE_SCRIPT_BASE_PROMPT;
  
  console.log('[generateScriptFromIdea] Prompt type:', originalShotCount > 0 ? 'storyboard structure mode' : 'creative mode');

  // Detailed storyboard scripts need higher max_tokens
  const extendedOptions = {
    ...options,
    maxTokens: originalShotCount > 5 ? 8192 : 4096, // Increase output length for multi-shot scripts
  };
  
  const response = await callChatAPI(systemPrompt, userPrompt, extendedOptions);
  
  console.log('[generateScriptFromIdea] Generated script length:', response.length);
  
  return response;
}

/**
 * Detect the type of creative input
 */
function detectInputType(input: string): string {
  const trimmed = input.trim();
  const lineCount = trimmed.split('\n').filter(l => l.trim()).length;
  
  // Detect existing storyboard structure: [Shot X] or **[Shot X]** or Shot X
  if (/(?:\[|\[)\s*shot\s*\d+/i.test(trimmed) || /\*\*.*shot.*\*\*/i.test(trimmed) || /\bshot\s*\d+/i.test(trimmed)) {
    return 'Detailed storyboard script';
  }

  // Detect MV concept
  if (/MV|music\s*video/i.test(trimmed)) {
    return 'MV concept';
  }

  // Detect ad brief
  if (/commercial|ad\s*brief|brand\s*brief/i.test(trimmed)) {
    return 'Ad brief';
  }

  // Detect trailer
  if (/trailer/i.test(trimmed)) {
    return 'Trailer script';
  }

  // Detect short video
  if (/short\s*video|tiktok|reels/i.test(trimmed)) {
    return 'Short video concept';
  }

  // Determine by length
  if (lineCount <= 3 && trimmed.length < 100) {
    return 'One-liner idea';
  } else if (lineCount <= 10) {
    return 'Story outline';
  } else {
    return 'Detailed story description';
  }
}

export type { ParseOptions, ShotGenerationOptions };
