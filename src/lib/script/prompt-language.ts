// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Prompt Language Helper
 *
 * Provides language-aware suffix for AI system prompts.
 * Instead of rewriting every Chinese prompt, we append an instruction
 * telling the AI to respond in the user's chosen language.
 */

import { useLanguageStore } from '@/stores/language-store';

const LANGUAGE_MAP: Record<string, string> = {
  en: 'English',
  ja: 'Japanese',
};

/**
 * Get the full language name from the store (e.g. "English", "Chinese", "Japanese")
 */
export function getLanguage(): string {
  const lang = useLanguageStore.getState().language;
  return LANGUAGE_MAP[lang] || 'English';
}

/**
 * Get the current language code from the store, defaulting to "en"
 */
export function getDefaultLanguage(): string {
  return useLanguageStore.getState().language || 'en';
}

/**
 * Returns a suffix to append to AI system prompts instructing the model
 * to output all text in the user's chosen language.
 *
 * When lang is "zh" (Chinese), returns empty string since prompts are already in Chinese.
 */
export function getPromptLanguageSuffix(lang?: string): string {
  const code = lang || getDefaultLanguage();
  const name = LANGUAGE_MAP[code] || 'English';

  return `\n\nIMPORTANT: All text output (descriptions, titles, dialogue, summaries, analysis notes, field values) MUST be in ${name}.`;
}
