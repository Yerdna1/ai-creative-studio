// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Shot Utilities - Common utility functions
 * Extracted from duplicate code in episode-tree.tsx, property-panel.tsx, context-panel.tsx
 */

import type { CompletionStatus, Shot } from "@/types/script";
import type { ShotSizeType } from "@/stores/director-store";

/**
 * Calculate completion status based on Shot's imageStatus/videoStatus
 */
export function getShotCompletionStatus(shot: Shot): CompletionStatus {
  if (shot.imageStatus === "completed" && shot.videoStatus === "completed") {
    return "completed";
  }
  if (shot.imageStatus === "completed" || shot.videoStatus === "completed") {
    return "in_progress";
  }
  return "pending";
}

/**
 * Calculate progress string for a group of items with status field
 */
export function calculateProgress(items: { status?: CompletionStatus }[]): string {
  const completed = items.filter((i) => i.status === "completed").length;
  return `${completed}/${items.length}`;
}

/**
 * Shot size name → ShotSizeType mapping table
 * Used to convert shot size descriptions in script to standardized IDs
 */
export const SHOT_SIZE_MAP: Record<string, ShotSizeType> = {
  'ECU': 'ecu', 'Extreme Close-Up': 'ecu',
  'CU': 'cu', 'Close-Up': 'cu',
  'MCU': 'mcu', 'Medium Close-Up': 'mcu',
  'MS': 'ms', 'Medium Shot': 'ms',
  'MLS': 'mls', 'Medium Long Shot': 'mls',
  'LS': 'ls', 'Long Shot': 'ls',
  'WS': 'ws', 'Wide Shot': 'ws',
  'POV': 'pov', 'POV Shot': 'pov',
};

/**
 * Convert shot size string to standardized ShotSizeType
 */
export function normalizeShotSize(shotSize: string | undefined | null): ShotSizeType | null {
  if (!shotSize) return null;
  return (SHOT_SIZE_MAP[shotSize] || null) as ShotSizeType | null;
}
