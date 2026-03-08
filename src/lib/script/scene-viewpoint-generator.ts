// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Scene Viewpoint Generator
 *
 * Extract viewpoint requirements from scene calibration data and shot action descriptions,
 * Generate multi-viewpoint contact sheet prompts for generating 6-panel contact sheets.
 */

import type { ScriptScene, Shot } from '@/types/script';

// ==================== Type Definitions ====================

/**
 * Scene viewpoint definition
 */
export interface SceneViewpoint {
  id: string;           // Viewpoint ID, e.g., 'dining', 'sofa', 'window'
  name: string;         // Localized name (e.g., Dining Area, Sofa Area, Window)
  nameEn: string;       // English name (e.g., Dining Area, Sofa Area, Window)
  shotIds: string[];    // Associated shot ID list
  keyProps: string[];   // Key props needed for this viewpoint (localized)
  keyPropsEn: string[]; // Key props needed for this viewpoint (English)
  description: string;  // Viewpoint description (localized)
  descriptionEn: string; // Viewpoint description (English)
  gridIndex: number;    // Position in contact sheet (0-5)
}

/**
 * Contact sheet generation configuration
 */
export interface ContactSheetConfig {
  scene: ScriptScene;
  shots: Shot[];
  styleTokens: string[];
  aspectRatio: '16:9' | '9:16';
  maxViewpoints?: number; // Default 6
}

/**
 * Contact sheet generation result
 */
export interface ContactSheetPromptResult {
  prompt: string;           // English prompt
  promptZh: string;         // Chinese prompt
  viewpoints: SceneViewpoint[];
  gridLayout: {
    rows: number;
    cols: number;
  };
}

// ==================== Environment Type Definitions ====================

/**
 * Scene environment type
 */
export type SceneEnvironmentType =
  | 'vehicle'        // Modern vehicles (bus, car, train, plane, etc.)
  | 'outdoor'        // Modern outdoor (road, street, park, etc.)
  | 'indoor_home'    // Modern indoor home
  | 'indoor_work'    // Modern indoor office/commercial
  | 'indoor_public'  // Modern indoor public (hospital, school, restaurant, etc.)
  | 'ancient_indoor' // Ancient indoor (palace, mansion, inn, temple, etc.)
  | 'ancient_outdoor'// Ancient outdoor (official road, market, city gate, etc.)
  | 'ancient_vehicle'// Ancient transport (carriage, sedan, boat, etc.)
  | 'unknown';       // Unknown

/**
 * Environment type keyword detection
 * Used to infer environment type from scene location
 */
const ENVIRONMENT_KEYWORDS: Record<SceneEnvironmentType, string[]> = {
  // === Ancient Scenes (Priority Detection) ===
  ancient_indoor: [
    // Palace/Royal
    'palace', 'temple', 'hall', 'royal palace', 'palace gate', 'inner court', 'imperial study', 'imperial garden', 'throne room', 'royal chamber',
    'side palace', 'cold palace', 'east palace', 'west palace', 'harem',
    // Mansion/Residence
    'mansion', 'manor', 'house', 'residence', 'estate', 'old house', 'inner quarter', 'outer quarter',
    'main hall', 'central hall', 'great hall', 'reception hall',
    'boudoir', 'inner chamber', 'embroidery building', 'library', 'flower hall',
    // Public Buildings
    'inn', 'restaurant', 'tavern', 'teahouse', 'temple', 'shrine', 'monastery', 'meditation room',
    'daoist temple', 'nunnery', 'dragon inn', 'happy inn',
    'ancestral hall', 'mourning hall', 'ancestral shrine',
    'magistrate office', 'court', 'high court',
    // Ancient Specific Rooms
    'study', 'music room', 'inner hall', 'accounting room', 'tea room', 'storage',
  ],
  ancient_outdoor: [
    // City
    'city gate', 'city wall', 'tower', 'outside city', 'inside city', 'royal city',
    'market', 'bazaar', 'trade market', 'temple fair', 'night market', 'east market', 'west market',
    'street', 'long street', 'lane', 'alley', 'alley entrance',
    'archway', 'square', 'inspection platform', 'drill ground',
    // Roads/Travel
    'official road', 'relay station', 'post road', 'mountain road', 'ancient road', 'trade route', 'highway',
    'south road', 'north road',
    // Nature/Courtyard
    'courtyard', 'yard', 'front yard', 'back yard', 'inner yard', 'outer yard',
    'garden', 'back garden', 'pond', 'lotus pond',
    'wilderness', 'forest', 'riverbank', 'bridge', 'ferry crossing', 'dock',
  ],
  ancient_vehicle: [
    'carriage', 'cart', 'sedan chair', 'palanquin', 'ox cart', 'horse', 'riding',
    'boat', 'passenger boat', 'merchant ship', 'fishing boat', 'pleasure boat', 'small boat', 'sailing boat',
    'inside carriage', 'inside sedan', 'cabin', 'boat cabin',
  ],

  // === Modern Scenes ===
  vehicle: [
    'bus', 'coach', 'transit', 'car', 'taxi', 'cab', 'uber',
    'train', 'high-speed rail', 'bullet train', 'subway', 'railway',
    'airplane', 'flight', 'cabin',
    'yacht', 'ferry', 'ship', 'cruise ship',
    'inside vehicle', 'on vehicle', 'carriage',
  ],
  outdoor: [
    'highway', 'road', 'street', 'street corner', 'roadside', 'intersection',
    'park', 'square', 'playground', 'sports field',
    'countryside', 'field', 'mountain', 'river', 'seaside', 'beach', 'forest', 'woods',
    'yard', 'courtyard', 'garden', 'rooftop', 'terrace', 'roof',
    'parking lot', 'gas station',
  ],
  indoor_home: [
    'home', 'residence', 'apartment', 'villa', 'dorm',
    'living room', 'bedroom', 'kitchen', 'dining room', 'study', 'bathroom', 'shower', 'balcony',
    'room', 'inside', 'indoors',
  ],
  indoor_work: [
    'office', 'company', 'office building', 'conference room', 'factory', 'workshop', 'warehouse',
    'shop', 'store', 'supermarket', 'mall',
  ],
  indoor_public: [
    'hospital', 'clinic', 'ward', 'operating room',
    'school', 'classroom', 'library', 'cafeteria',
    'restaurant', 'hotel', 'guesthouse', 'lodge', 'cafe', 'bar', 'karaoke',
    'police station', 'police department', 'court', 'prison',
    'bank', 'post office', 'airport', 'station', 'dock',
  ],
  unknown: [],
};

/**
 * Clean scene location string, remove irrelevant content like character information
 */
function cleanLocationString(location: string): string {
  // Remove "Characters: XXX" part
  let cleaned = location.replace(/\s*Characters[:\uff1a:].*/g, '');
  // Remove "Role: XXX" part
  cleaned = cleaned.replace(/\s*Role[:\uff1a:].*/g, '');
  // Remove "Time: XXX" part
  cleaned = cleaned.replace(/\s*Time[:\uff1a:].*/g, '');
  // Remove leading/trailing whitespace
  return cleaned.trim();
}

/**
 * Infer environment type from scene location
 */
export function detectEnvironmentType(location: string): SceneEnvironmentType {
  // First clean location string
  const cleanedLocation = cleanLocationString(location);
  const normalizedLocation = cleanedLocation.toLowerCase();

  console.log(`[detectEnvironmentType] Original: "${location}" -> Cleaned: "${cleanedLocation}"`);

  // Detect by priority: Ancient > Modern vehicle > Outdoor > Indoor public > Indoor work > Indoor home
  const priorities: SceneEnvironmentType[] = [
    'ancient_vehicle', 'ancient_indoor', 'ancient_outdoor',  // Ancient priority
    'vehicle', 'outdoor', 'indoor_public', 'indoor_work', 'indoor_home'
  ];

  for (const envType of priorities) {
    const keywords = ENVIRONMENT_KEYWORDS[envType];
    for (const keyword of keywords) {
      if (normalizedLocation.includes(keyword)) {
        console.log(`[detectEnvironmentType] Matched keyword "${keyword}" -> Environment type: ${envType}`);
        return envType;
      }
    }
  }

  console.log(`[detectEnvironmentType] No keyword matched -> unknown`);
  return 'unknown';
}

// ==================== Viewpoint Keyword Mapping ====================

/**
 * Viewpoint configuration (with environment compatibility)
 */
interface ViewpointConfig {
  id: string;
  name: string;
  nameEn: string;
  propsZh: string[];
  propsEn: string[];
  /** Compatible environment types, empty array means universal */
  environments: SceneEnvironmentType[];
}

/**
 * Action keyword -> Viewpoint mapping
 * Identify required viewpoints from shot action descriptions
 * Extended keywords to cover more scenarios
 *
 * 【IMPORTANT】environments field controls which environment types this viewpoint applies to
 * - Empty array [] means universal viewpoint, applies to all environments
 * - Specified environment type list means only match in these environments
 */
const VIEWPOINT_KEYWORDS: Record<string, ViewpointConfig> = {
  // ========== Ancient Indoor Viewpoints ==========
  // Main Hall
  'main hall': { id: 'ancient_hall', name: 'Main Hall', nameEn: 'Main Hall', propsZh: [] },
  'reception hall': { id: 'ancient_hall', name: 'Reception Hall', nameEn: 'Main Hall', propsZh: [] },
  'grand hall': { id: 'ancient_hall', name: 'Grand Hall', nameEn: 'Grand Hall', propsZh: [] },
  // Table/Seating
  'table': { id: 'ancient_table', name: 'Table', nameEn: 'Ancient Table', propsZh: [] },
  'writing desk': { id: 'ancient_table', name: 'Writing Desk', nameEn: 'Writing Desk', propsZh: [] },
  'at table': { id: 'ancient_table', name: 'At Table', nameEn: 'At the Table', propsZh: [] },
  'tavern hall': { id: 'ancient_table', name: 'Tavern Hall', nameEn: 'Tavern Hall', propsZh: [] },
  // Screen/Curtain
  'screen': { id: 'ancient_screen', name: 'Screen View', nameEn: 'Screen View', propsZh: [] },
  'curtain': { id: 'ancient_screen', name: 'Curtain', nameEn: 'Gauze Curtain', propsZh: [] },
  'behind curtain': { id: 'ancient_screen', name: 'Behind Curtain', nameEn: 'Behind the Curtain', propsZh: [] },
  // Boudoir/Bedroom
  'boudoir': { id: 'ancient_boudoir', name: 'Boudoir', nameEn: 'Boudoir', propsZh: [] },
  'dressing table': { id: 'ancient_boudoir', name: 'Dressing Table', nameEn: 'Dressing Table', propsZh: [] },
  'embroidery': { id: 'ancient_boudoir', name: 'Embroidery Chamber', nameEn: 'Embroidery Chamber', propsZh: [] },
  // Couch/Bed
  'couch': { id: 'ancient_couch', name: 'Couch', nameEn: 'Ancient Couch', propsZh: [] },
  'bed': { id: 'ancient_couch', name: 'Bed', nameEn: 'Bed', propsZh: [] },
  // Study
  'study': { id: 'ancient_study', name: 'Study', nameEn: 'Study', propsZh: [] },
  'writing': { id: 'ancient_study', name: 'Study', nameEn: 'Study', propsZh: [] },
  'reading': { id: 'ancient_study', name: 'Reading', nameEn: 'Study', propsZh: [] },
  // Shrine
  'buddha hall': { id: 'ancient_shrine', name: 'Buddha Hall', nameEn: 'Buddha Hall', propsZh: [] },
  'offering incense': { id: 'ancient_shrine', name: 'Offering', nameEn: 'Offering Incense', propsZh: [] },
  'ancestral hall': { id: 'ancient_shrine', name: 'Ancestral Hall', nameEn: 'Ancestral Hall', propsZh: [] },
  
  // ========== Ancient Outdoor Viewpoints (ancient_outdoor) ==========
  // Courtyard
  'courtyard ancient': { id: 'ancient_courtyard', name: 'Courtyard', nameEn: 'Courtyard', propsZh: [] },
  'front yard ancient': { id: 'ancient_courtyard', name: 'Front Yard', nameEn: 'Front Yard', propsZh: [] },
  'back yard ancient': { id: 'ancient_courtyard', name: 'Back Yard', nameEn: 'Back Yard', propsZh: [] },
  // Pond/Pavilion
  'pond ancient': { id: 'ancient_pond', name: 'Pond View', nameEn: 'Pond View', propsZh: [] },
  'lotus pond': { id: 'ancient_pond', name: 'Lotus Pond', nameEn: 'Lotus Pond', propsZh: [] },
  'pavilion ancient': { id: 'ancient_pavilion', name: 'Pavilion', nameEn: 'Pavilion', propsZh: [] },
  'water view': { id: 'ancient_pond', name: 'Water View', nameEn: 'Water View', propsZh: [] },
  // Road/Street
  'official road': { id: 'ancient_road', name: 'Official Road', nameEn: 'Official Road', propsZh: [] },
  'post station': { id: 'ancient_road', name: 'Post Station', nameEn: 'Post Station', propsZh: [] },
  'on road ancient': { id: 'ancient_road', name: 'Road', nameEn: 'Road', propsZh: [] },
  // Market/City Gate
  'market ancient': { id: 'ancient_market', name: 'Market', nameEn: 'Market', propsZh: [] },
  'city gate': { id: 'ancient_gate', name: 'City Gate', nameEn: 'City Gate', propsZh: [] },
  'city tower': { id: 'ancient_gate', name: 'City Tower', nameEn: 'City Tower', propsZh: [] },
  // Dock/Ferry
  'dock ancient': { id: 'ancient_dock', name: 'Dock', nameEn: 'Dock', propsZh: [] },
  'ferry crossing': { id: 'ancient_dock', name: 'Ferry Crossing', nameEn: 'Ferry Crossing', propsZh: [] },
  
  // ========== Ancient Vehicle Viewpoints (ancient_vehicle) ==========
  // Carriage/Sedan
  'sedan chair': { id: 'ancient_sedan', name: 'Sedan Chair', nameEn: 'Sedan Chair', propsZh: [] },
  'inside sedan': { id: 'ancient_sedan', name: 'Inside Sedan', nameEn: 'Inside Sedan', propsZh: [] },
  'entering sedan': { id: 'ancient_sedan', name: 'Sedan Door', nameEn: 'Entering Sedan', propsZh: [] },
  'exiting sedan': { id: 'ancient_sedan', name: 'Sedan Door', nameEn: 'Exiting Sedan', propsZh: [] },
  'carriage ancient': { id: 'ancient_carriage', name: 'Carriage', nameEn: 'Carriage', propsZh: [] },
  'inside carriage ancient': { id: 'ancient_carriage', name: 'Inside Carriage', nameEn: 'Inside Carriage', propsZh: [] },
  // Boat
  'boat cabin ancient': { id: 'ancient_boat', name: 'Boat Cabin', nameEn: 'Boat Cabin', propsZh: [] },
  'inside cabin ancient': { id: 'ancient_boat', name: 'Boat Cabin', nameEn: 'Inside Cabin', propsZh: [] },
  'ship deck': { id: 'ancient_deck', name: 'Ship Deck', nameEn: 'Ship Deck', propsZh: [] },
  'bow of ship': { id: 'ancient_deck', name: 'Bow', nameEn: 'Bow', propsZh: [] },
  'stern of ship': { id: 'ancient_deck', name: 'Stern', nameEn: 'Stern', propsZh: [] },
  // Horse Riding
  'on horseback': { id: 'ancient_horse', name: 'Horseback', nameEn: 'On Horseback', propsZh: [] },
  'mounting horse': { id: 'ancient_horse', name: 'Horseback', nameEn: 'Mounting', propsZh: [] },
  'dismounting horse': { id: 'ancient_horse', name: 'Horseback', nameEn: 'Dismounting', propsZh: [] },
  'galloping': { id: 'ancient_horse', name: 'Horseback', nameEn: 'Galloping', propsZh: [] },
  
  // ========== Modern Vehicle Viewpoints (vehicle) ==========
  // Window View
  'car window': { id: 'vehicle_window', name: 'Vehicle Window', nameEn: 'Vehicle Window View', propsZh: [] },
  'outside scenery': { id: 'vehicle_window', name: 'Vehicle Window', nameEn: 'Vehicle Window View', propsZh: [] },
  // Seat View
  'vehicle seat': { id: 'vehicle_seat', name: 'Seat Area', nameEn: 'Seat Area', propsZh: [] },
  'car seat': { id: 'vehicle_seat', name: 'Seat Area', nameEn: 'Seat Area', propsZh: [] },
  'sitting in vehicle': { id: 'vehicle_seat', name: 'Seat Area', nameEn: 'Seat Area', propsZh: [] },
  // Aisle View
  'vehicle aisle': { id: 'vehicle_aisle', name: 'Aisle View', nameEn: 'Aisle View', propsZh: [] },
  'walking aisle': { id: 'vehicle_aisle', name: 'Aisle View', nameEn: 'Aisle View', propsZh: [] },
  // Driver View
  'driving vehicle': { id: 'vehicle_driver', name: 'Driver Area', nameEn: 'Driver Area', propsZh: [] },
  'driver': { id: 'vehicle_driver', name: 'Driver Area', nameEn: 'Driver Area', propsZh: [] },
  'driving': { id: 'vehicle_driver', name: 'Driver Area', nameEn: 'Driver Area', propsZh: [] },
  // Door View
  'car door': { id: 'vehicle_door', name: 'Vehicle Door', nameEn: 'Vehicle Door', propsZh: [] },
  'entering vehicle': { id: 'vehicle_door', name: 'Vehicle Door', nameEn: 'Vehicle Door', propsZh: [] },
  'exiting vehicle': { id: 'vehicle_door', name: 'Vehicle Door', nameEn: 'Vehicle Door', propsZh: [] },
  
  // ========== Outdoor Viewpoints (outdoor) ==========
  // Road Views
  'roadside': { id: 'roadside', name: 'Roadside', nameEn: 'Roadside View', propsZh: [] },
  'road view': { id: 'roadside', name: 'Road View', nameEn: 'Road View', propsZh: [] },
  'street view': { id: 'street', name: 'Street View', nameEn: 'Street View', propsZh: [] },
  'street corner': { id: 'street', name: 'Street View', nameEn: 'Street View', propsZh: [] },
  // Nature Views
  'field view': { id: 'nature', name: 'Nature View', nameEn: 'Nature View', propsZh: [] },
  'mountain view': { id: 'nature', name: 'Nature View', nameEn: 'Nature View', propsZh: [] },
  'river view': { id: 'nature', name: 'Nature View', nameEn: 'Nature View', propsZh: [] },
  'among trees': { id: 'nature', name: 'Nature View', nameEn: 'Nature View', propsZh: [] },
  // Yard/Garden Views
  'yard view': { id: 'yard', name: 'Yard View', nameEn: 'Yard View', propsZh: [] },
  'garden view': { id: 'garden', name: 'Garden View', nameEn: 'Garden View', propsZh: [] },
  
  // ========== Indoor Home Viewpoints (indoor_home) ==========
  // Dining/Table
  'eating': { id: 'dining', name: 'Dining Area', nameEn: 'Dining Area', propsZh: [] },
  'dining table': { id: 'dining', name: 'Dining Area', nameEn: 'Dining Area', propsZh: [] },
  'at dining table': { id: 'dining', name: 'Dining Area', nameEn: 'Dining Area', propsZh: [] },
  'having meal': { id: 'dining', name: 'Dining Area', nameEn: 'Dining Area', propsZh: [] },
  'serving food': { id: 'dining', name: 'Dining Area', nameEn: 'Dining Area', propsZh: [] },
  'picking food': { id: 'dining', name: 'Dining Area', nameEn: 'Dining Area', propsZh: [] },
  'drinking alcohol': { id: 'dining', name: 'Dining Area', nameEn: 'Dining Area', propsZh: [] },
  'clinking glasses': { id: 'dining', name: 'Dining Area', nameEn: 'Dining Area', propsZh: [] },
  'raising glass': { id: 'dining', name: 'Dining Area', nameEn: 'Dining Area', propsZh: [] },
  
  // Sofa/Living Room
  'on sofa': { id: 'sofa', name: 'Sofa Area', nameEn: 'Sofa Area', propsZh: [] },
  'watching tv': { id: 'sofa', name: 'Sofa Area', nameEn: 'Sofa Area', propsZh: [] },
  'coffee table': { id: 'sofa', name: 'Sofa Area', nameEn: 'Sofa Area', propsZh: [] },
  'pouring tea': { id: 'sofa', name: 'Sofa Area', nameEn: 'Sofa Area', propsZh: [] },
  'drinking tea': { id: 'sofa', name: 'Sofa Area', nameEn: 'Sofa Area', propsZh: [] },
  
  // Window View
  'at window': { id: 'window', name: 'Window View', nameEn: 'Window View', propsZh: [] },
  'outside window': { id: 'window', name: 'Window View', nameEn: 'Window View', propsZh: [] },
  'by window': { id: 'window', name: 'Window View', nameEn: 'Window View', propsZh: [] },
  'balcony': { id: 'window', name: 'Window/Balcony', nameEn: 'Balcony View', propsZh: [] },
  'curtains': { id: 'window', name: 'Window View', nameEn: 'Window View', propsZh: [] },
  
  // Entrance/Door
  'at doorway': { id: 'entrance', name: 'Entrance', nameEn: 'Entrance View', propsZh: [] },
  'doorway': { id: 'entrance', name: 'Entrance', nameEn: 'Entrance View', propsZh: [] },
  'entering door': { id: 'entrance', name: 'Entrance', nameEn: 'Entrance View', propsZh: [] },
  'exiting door': { id: 'entrance', name: 'Entrance', nameEn: 'Entrance View', propsZh: [] },
  'returning home': { id: 'entrance', name: 'Entrance', nameEn: 'Entrance View', propsZh: [] },
  'coming in': { id: 'entrance', name: 'Entrance', nameEn: 'Entrance View', propsZh: [] },
  'walking in': { id: 'entrance', name: 'Entrance', nameEn: 'Entrance View', propsZh: [] },
  'leaving': { id: 'entrance', name: 'Entrance', nameEn: 'Entrance View', propsZh: [] },
  'entrance hall': { id: 'entrance', name: 'Entrance', nameEn: 'Entrance View', propsZh: [] },
  'changing shoes': { id: 'entrance', name: 'Entrance', nameEn: 'Entrance View', propsZh: [] },
  
  // Kitchen
  'in kitchen': { id: 'kitchen', name: 'Kitchen', nameEn: 'Kitchen', propsZh: [] },
  'cooking': { id: 'kitchen', name: 'Kitchen', nameEn: 'Kitchen', propsZh: [] },
  'cooking food': { id: 'kitchen', name: 'Kitchen', nameEn: 'Kitchen', propsZh: [] },
  'stir frying': { id: 'kitchen', name: 'Kitchen', nameEn: 'Kitchen', propsZh: [] },
  'washing dishes': { id: 'kitchen', name: 'Kitchen', nameEn: 'Kitchen', propsZh: [] },
  'cutting vegetables': { id: 'kitchen', name: 'Kitchen', nameEn: 'Kitchen', propsZh: [] },
  'at refrigerator': { id: 'kitchen', name: 'Kitchen', nameEn: 'Kitchen', propsZh: [] },
  
  // Study/Desk
  'at desk': { id: 'study', name: 'Study Area', nameEn: 'Study Area', propsZh: [] },
  'at computer': { id: 'study', name: 'Study Area', nameEn: 'Study Area', propsZh: [] },
  'reading book': { id: 'study', name: 'Study Area', nameEn: 'Study Area', propsZh: [] },
  'writing': { id: 'study', name: 'Study Area', nameEn: 'Study Area', propsZh: [] },
  'working': { id: 'study', name: 'Study Area', nameEn: 'Study Area', propsZh: [] },
  'with documents': { id: 'study', name: 'Study Area', nameEn: 'Study Area', propsZh: [] },
  'at bookshelf': { id: 'study', name: 'Study Area', nameEn: 'Study Area', propsZh: [] },
  
  // Bedroom
  'in bedroom': { id: 'bedroom', name: 'Bedroom', nameEn: 'Bedroom', propsZh: [] },
  'in bed': { id: 'bedroom', name: 'Bedroom', nameEn: 'Bedroom', propsZh: [] },
  'waking up': { id: 'bedroom', name: 'Bedroom', nameEn: 'Bedroom', propsZh: [] },
  'at bedside': { id: 'bedroom', name: 'Bedroom', nameEn: 'Bedroom', propsZh: [] },
  'under covers': { id: 'bedroom', name: 'Bedroom', nameEn: 'Bedroom', propsZh: [] },
  
  // ========== Universal Viewpoints (All Environments) ==========
  // Conversation/Emotion - Universal
  'talking': { id: 'conversation', name: 'Conversation Area', nameEn: 'Conversation Area', propsZh: [] },
  'chatting': { id: 'conversation', name: 'Conversation Area', nameEn: 'Conversation Area', propsZh: [] },
  'speaking': { id: 'conversation', name: 'Conversation Area', nameEn: 'Conversation Area', propsZh: [] },
  'arguing': { id: 'conversation', name: 'Conversation Area', nameEn: 'Conversation Area', propsZh: [] },
  'quarreling': { id: 'conversation', name: 'Conversation Area', nameEn: 'Conversation Area', propsZh: [] },
  'crying': { id: 'emotion', name: 'Emotional Close-up', nameEn: 'Emotional Close-up', propsZh: [] },
  'shedding tears': { id: 'emotion', name: 'Emotional Close-up', nameEn: 'Emotional Close-up', propsZh: [] },
  'smiling': { id: 'emotion', name: 'Emotional Close-up', nameEn: 'Emotional Close-up', propsZh: [] },
  'embracing': { id: 'emotion', name: 'Emotional Close-up', nameEn: 'Emotional Close-up', propsZh: [] },
  
  // Detail Close-up - Universal
  'hand': { id: 'detail', name: 'Detail Close-up', nameEn: 'Detail Close-up', propsZh: [] },
  'holding': { id: 'detail', name: 'Detail Close-up', nameEn: 'Detail Close-up', propsZh: [] },
  'picking up': { id: 'detail', name: 'Detail Close-up', nameEn: 'Detail Close-up', propsZh: [] },
  'putting down': { id: 'detail', name: 'Detail Close-up', nameEn: 'Detail Close-up', propsZh: [] },
  'closeup': { id: 'detail', name: 'Detail Close-up', nameEn: 'Detail Close-up', propsZh: [] },
  'close up': { id: 'detail', name: 'Detail Close-up', nameEn: 'Detail Close-up', propsZh: [] },
  
  // Looking/Gazing - Universal
  'looking at': { id: 'looking', name: 'Looking View', nameEn: 'Looking View', propsZh: [] },
  'gazing at': { id: 'looking', name: 'Looking View', nameEn: 'Looking View', propsZh: [] },
  'staring at': { id: 'looking', name: 'Looking View', nameEn: 'Looking View', propsZh: [] },

  // Sitting/Standing - Adapts to environment
  'sitting down': { id: 'seating', name: 'Seating Area', nameEn: 'Seating Area', propsZh: [] },
  'taking seat': { id: 'seating', name: 'Seating Area', nameEn: 'Seating Area', propsZh: [] },
  'standing up': { id: 'seating', name: 'Seating Area', nameEn: 'Seating Area', propsZh: [] },
};

// ==================== Core Functions ====================

/**
 * Extract viewpoint requirements from shot action descriptions
 */
export function extractViewpointsFromShots(
  shots: Shot[],
  maxViewpoints: number = 6
): SceneViewpoint[] {
  const viewpointMap = new Map<string, SceneViewpoint>();
  
  for (const shot of shots) {
    const actionText = shot.actionSummary || '';
    
    // Check each keyword
    for (const [keyword, config] of Object.entries(VIEWPOINT_KEYWORDS)) {
      if (actionText.includes(keyword)) {
        if (!viewpointMap.has(config.id)) {
          viewpointMap.set(config.id, {
            id: config.id,
            name: config.name,
            nameEn: config.nameEn,
            shotIds: [shot.id],
            keyProps: [...config.propsZh],
            keyPropsEn: [...config.propsEn],
            description: '',
            descriptionEn: '',
            gridIndex: viewpointMap.size,
          });
        } else {
          const existing = viewpointMap.get(config.id)!;
          if (!existing.shotIds.includes(shot.id)) {
            existing.shotIds.push(shot.id);
          }
          // Merge props
          for (const prop of config.propsZh) {
            if (!existing.keyProps.includes(prop)) {
              existing.keyProps.push(prop);
            }
          }
          for (const prop of config.propsEn) {
            if (!existing.keyPropsEn.includes(prop)) {
              existing.keyPropsEn.push(prop);
            }
          }
        }
      }
    }
  }
  
  // Sort by associated shot count (common viewpoints first)
  const viewpoints = Array.from(viewpointMap.values())
    .sort((a, b) => b.shotIds.length - a.shotIds.length)
    .slice(0, maxViewpoints);

  // Reassign gridIndex
  viewpoints.forEach((v, i) => { v.gridIndex = i; });

  // If fewer than 6 viewpoints, supplement with default viewpoints
  const defaultViewpoints: Array<Omit<SceneViewpoint, 'shotIds' | 'gridIndex'>> = [
    { id: 'overview', name: 'Overview', nameEn: 'Overview', keyProps: [], keyPropsEn: [], description: 'Overall spatial layout', descriptionEn: 'Overall spatial layout' },
    { id: 'detail', name: 'Detail View', nameEn: 'Detail View', keyProps: [], keyPropsEn: [], description: 'Decorative details close-up', descriptionEn: 'Decorative details close-up' },
  ];
  
  while (viewpoints.length < maxViewpoints && defaultViewpoints.length > 0) {
    const def = defaultViewpoints.shift()!;
    if (!viewpoints.some(v => v.id === def.id)) {
      viewpoints.push({
        ...def,
        shotIds: [],
        gridIndex: viewpoints.length,
      });
    }
  }
  
  return viewpoints;
}

/**
 * Generate contact sheet prompt
 * Prioritize AI analyzed viewpoints, fallback to keyword extraction if not available
 */
export function generateContactSheetPrompt(config: ContactSheetConfig): ContactSheetPromptResult {
  const { scene, shots, styleTokens, aspectRatio, maxViewpoints = 6 } = config;

  // Prioritize AI analyzed viewpoints (from scene.viewpoints)
  let viewpoints: SceneViewpoint[];
  let isAIAnalyzed = false;

  if (scene.viewpoints && scene.viewpoints.length > 0) {
    // Use AI analyzed viewpoints
    console.log(`[generateContactSheetPrompt] Using AI analyzed viewpoints: ${scene.viewpoints.length}`);
    viewpoints = scene.viewpoints.slice(0, maxViewpoints).map((v, idx: number) => ({
      id: v.id || `viewpoint_${idx}`,
      name: v.name || 'Unnamed Viewpoint',
      nameEn: v.nameEn || 'Unnamed Viewpoint',
      shotIds: v.shotIds || [],
      keyProps: v.keyProps || [],
      keyPropsEn: v.keyPropsEn || [],
      description: v.description || '',
      descriptionEn: v.descriptionEn || '',
      gridIndex: idx,
    }));
    isAIAnalyzed = true;
  } else {
    // Fallback to keyword extraction
    console.log('[generateContactSheetPrompt] No AI viewpoints, fallback to keyword extraction');
    viewpoints = extractViewpointsFromShots(shots, maxViewpoints);
  }

  // Determine grid layout - Force NxN layout (2x2 or 3x3)
  const vpCount = viewpoints.length;
  const gridLayout = vpCount <= 4 
    ? { rows: 2, cols: 2 }
    : { rows: 3, cols: 3 };

  // Build scene base description
  const sceneDescEn = [
    scene.architectureStyle && `Architecture: ${scene.architectureStyle}`,
    scene.colorPalette && `Color palette: ${scene.colorPalette}`,
    scene.eraDetails && `Era: ${scene.eraDetails}`,
    scene.lightingDesign && `Lighting: ${scene.lightingDesign}`,
  ].filter(Boolean).join('. ');

  // Generate description for each viewpoint
  viewpoints.forEach((vp) => {
    const propsEn = vp.keyPropsEn.length > 0 ? ` with ${vp.keyPropsEn.join(', ')}` : '';

    vp.description = `${vp.name} view${propsEn}`;
    vp.descriptionEn = `${vp.nameEn} angle${propsEn}`;
  });

  const styleStr = styleTokens.length > 0 
    ? styleTokens.join(', ') 
    : 'anime style, soft colors, detailed background';
  
  const totalCells = gridLayout.rows * gridLayout.cols;
  const paddedCount = totalCells;

  // Build enhanced prompt (Structured Prompt)
  const promptParts: string[] = [];

  // 1. Core instruction block
  promptParts.push('<instruction>');
  promptParts.push(`Generate a clean ${gridLayout.rows}x${gridLayout.cols} architectural concept grid with exactly ${paddedCount} equal-sized panels.`);
  promptParts.push(`Overall Aspect Ratio: ${aspectRatio}.`);
  promptParts.push('Structure: No borders between panels, no text, no watermarks.');
  promptParts.push('Consistency: Maintain consistent perspective, lighting, and style across all panels.');
  promptParts.push('Subject: Interior design and architectural details only, NO people.');
  promptParts.push('</instruction>');

  // 2. Layout description
  promptParts.push(`Layout: ${gridLayout.rows} rows, ${gridLayout.cols} columns, reading order left-to-right, top-to-bottom.`);

  // 3. Scene information
  if (sceneDescEn) {
    promptParts.push(`Scene Context: ${sceneDescEn}`);
  }

  // 4. Content description for each panel
  viewpoints.forEach((vp, idx) => {
    const row = Math.floor(idx / gridLayout.cols) + 1;
    const col = (idx % gridLayout.cols) + 1;

    promptParts.push(`Panel [row ${row}, col ${col}] (no people): ${vp.nameEn.toUpperCase()}: ${vp.descriptionEn}`);
  });

  // 5. Empty placeholder panel description
  for (let i = viewpoints.length; i < paddedCount; i++) {
    const row = Math.floor(i / gridLayout.cols) + 1;
    const col = (i % gridLayout.cols) + 1;
    promptParts.push(`Panel [row ${row}, col ${col}]: empty placeholder, solid gray background`);
  }

  // 6. Style and negative prompts
  promptParts.push(`Style: ${styleStr}`);
  promptParts.push('Negative constraints: text, watermark, split screen borders, speech bubbles, blur, distortion, bad anatomy, people, characters.');

  const prompt = promptParts.join('\n');
  const promptZh = ''; // No Chinese prompt needed for English-only mode

  return {
    prompt,
    promptZh,
    viewpoints,
    gridLayout,
  };
}

/**
 * Assign viewpoints based on split results
 * Assign split images to corresponding viewpoints
 */
export function assignViewpointImages(
  viewpoints: SceneViewpoint[],
  splitResults: Array<{
    id: number;
    dataUrl: string;
    row: number;
    col: number;
  }>,
  gridLayout: { rows: number; cols: number }
): Map<string, { imageUrl: string; gridIndex: number }> {
  const result = new Map<string, { imageUrl: string; gridIndex: number }>();
  
  for (const vp of viewpoints) {
    // Calculate this viewpoint's index in split results
    const gridIndex = vp.gridIndex;
    const row = Math.floor(gridIndex / gridLayout.cols);
    const col = gridIndex % gridLayout.cols;

    // Find matching split result
    const splitResult = splitResults.find(sr => sr.row === row && sr.col === col);
    
    if (splitResult) {
      result.set(vp.id, {
        imageUrl: splitResult.dataUrl,
        gridIndex: gridIndex,
      });
    }
  }
  
  return result;
}

/**
 * Automatically match best viewpoint based on shot action
 */
export function matchShotToViewpoint(
  shot: Shot,
  viewpoints: SceneViewpoint[]
): string | null {
  const actionText = shot.actionSummary || '';

  // Check if shot is already associated with a viewpoint
  for (const vp of viewpoints) {
    if (vp.shotIds.includes(shot.id)) {
      return vp.id;
    }
  }
  
  // Try matching based on action keywords
  for (const [keyword, config] of Object.entries(VIEWPOINT_KEYWORDS)) {
    if (actionText.includes(keyword)) {
      const matchedVp = viewpoints.find(vp => vp.id === config.id);
      if (matchedVp) {
        return matchedVp.id;
      }
    }
  }
  
  // Default to overview viewpoint
  const overviewVp = viewpoints.find(vp => vp.id === 'overview');
  return overviewVp?.id || viewpoints[0]?.id || null;
}

// ==================== Dynamic Viewpoint and Pagination Support ====================

import type {
  PendingViewpointData,
  ContactSheetPromptSet
} from '@/stores/media-panel-store';

/**
 * Extract all searchable content from shot text
 * Includes: action descriptions, dialogue, visual descriptions, etc.
 */
function getShotSearchableText(shot: Shot): string {
  const parts = [
    shot.actionSummary || '',
    shot.dialogue || '',
    shot.visualDescription || '',
    shot.characterBlocking || '',
  ];
  return parts.join(' ');
}

/**
 * Get default viewpoint list based on environment type
 * Used to supplement when extracted viewpoints are insufficient
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getDefaultViewpointsForEnvironment(
  envType: SceneEnvironmentType
): Array<Omit<SceneViewpoint, 'shotIds' | 'gridIndex'>> {
  // Common default viewpoints
  const commonDefaults: Array<Omit<SceneViewpoint, 'shotIds' | 'gridIndex'>> = [
    { id: 'overview', name: 'Overview', nameEn: 'Overview', keyProps: [], keyPropsEn: [], description: 'Overall spatial layout', descriptionEn: 'Overall spatial layout' },
    { id: 'detail', name: 'Detail View', nameEn: 'Detail View', keyProps: [], keyPropsEn: [], description: 'Detail close-up', descriptionEn: 'Detail close-up' },
  ];

  // Return specific default viewpoints based on environment type
  switch (envType) {
    case 'vehicle':
      return [
        { id: 'vehicle_window', name: 'Vehicle Window', nameEn: 'Vehicle Window View', keyProps: [], keyPropsEn: ['vehicle window', 'outside scenery'], description: 'Vehicle window view', descriptionEn: 'Vehicle window view' },
        { id: 'vehicle_seat', name: 'Seat Area', nameEn: 'Seat Area', keyProps: [], keyPropsEn: ['seat'], description: 'Seating area', descriptionEn: 'Seating area' },
        { id: 'vehicle_aisle', name: 'Aisle View', nameEn: 'Aisle View', keyProps: [], keyPropsEn: ['aisle', 'handrail'], description: 'Aisle view', descriptionEn: 'Aisle view' },
        { id: 'vehicle_driver', name: 'Driver Area', nameEn: 'Driver Area', keyProps: [], keyPropsEn: ['steering wheel'], description: 'Driver area', descriptionEn: 'Driver area' },
        ...commonDefaults,
      ];

    case 'outdoor':
      return [
        { id: 'nature', name: 'Nature View', nameEn: 'Nature View', keyProps: [], keyPropsEn: [], description: 'Nature scenery view', descriptionEn: 'Nature scenery view' },
        { id: 'roadside', name: 'Roadside', nameEn: 'Roadside View', keyProps: [], keyPropsEn: ['road'], description: 'Roadside view', descriptionEn: 'Roadside view' },
        { id: 'street', name: 'Street View', nameEn: 'Street View', keyProps: [], keyPropsEn: ['street'], description: 'Street view', descriptionEn: 'Street view' },
        ...commonDefaults,
      ];

    case 'indoor_home':
      return [
        { id: 'sofa', name: 'Sofa Area', nameEn: 'Sofa Area', keyProps: [], keyPropsEn: ['sofa', 'coffee table'], description: 'Sofa area', descriptionEn: 'Sofa area' },
        { id: 'window', name: 'Window View', nameEn: 'Window View', keyProps: [], keyPropsEn: ['window', 'curtains'], description: 'Window view', descriptionEn: 'Window view' },
        { id: 'entrance', name: 'Entrance', nameEn: 'Entrance View', keyProps: [], keyPropsEn: ['door', 'entrance'], description: 'Entrance view', descriptionEn: 'Entrance view' },
        ...commonDefaults,
      ];

    case 'indoor_work':
      return [
        { id: 'study', name: 'Work Area', nameEn: 'Work Area', keyProps: [], keyPropsEn: ['desk', 'computer'], description: 'Work area', descriptionEn: 'Work area' },
        { id: 'window', name: 'Window View', nameEn: 'Window View', keyProps: [], keyPropsEn: ['window'], description: 'Window view', descriptionEn: 'Window view' },
        { id: 'entrance', name: 'Entrance', nameEn: 'Entrance View', keyProps: [], keyPropsEn: ['door'], description: 'Entrance view', descriptionEn: 'Entrance view' },
        ...commonDefaults,
      ];

    case 'indoor_public':
      return [
        { id: 'seating', name: 'Seating Area', nameEn: 'Seating Area', keyProps: [], keyPropsEn: [], description: 'Seating area', descriptionEn: 'Seating area' },
        { id: 'entrance', name: 'Entrance', nameEn: 'Entrance View', keyProps: [], keyPropsEn: ['door'], description: 'Entrance view', descriptionEn: 'Entrance view' },
        ...commonDefaults,
      ];

    // === Ancient Scenes ===
    case 'ancient_indoor':
      return [
        { id: 'ancient_hall', name: 'Main Hall', nameEn: 'Main Hall', keyProps: [], keyPropsEn: ['chair', 'table'], description: 'Main hall view', descriptionEn: 'Main hall view' },
        { id: 'ancient_table', name: 'Table', nameEn: 'Ancient Table', keyProps: [], keyPropsEn: ['table', 'tea set'], description: 'Table view', descriptionEn: 'Table view' },
        { id: 'ancient_screen', name: 'Screen', nameEn: 'Screen View', keyProps: [], keyPropsEn: ['screen', 'curtain'], description: 'Screen view', descriptionEn: 'Screen view' },
        { id: 'ancient_couch', name: 'Couch', nameEn: 'Ancient Couch', keyProps: [], keyPropsEn: ['daybed', 'cushion'], description: 'Couch view', descriptionEn: 'Couch view' },
        ...commonDefaults,
      ];

    case 'ancient_outdoor':
      return [
        { id: 'ancient_courtyard', name: 'Courtyard', nameEn: 'Courtyard', keyProps: [], keyPropsEn: ['rockery', 'pond'], description: 'Courtyard view', descriptionEn: 'Courtyard view' },
        { id: 'ancient_pavilion', name: 'Pavilion', nameEn: 'Pavilion', keyProps: [], keyPropsEn: ['pavilion', 'stone bench'], description: 'Pavilion view', descriptionEn: 'Pavilion view' },
        { id: 'ancient_road', name: 'Road', nameEn: 'Official Road', keyProps: [], keyPropsEn: ['road'], description: 'Road view', descriptionEn: 'Road view' },
        { id: 'ancient_gate', name: 'City Gate', nameEn: 'City Gate', keyProps: [], keyPropsEn: ['city gate', 'wall'], description: 'City gate view', descriptionEn: 'City gate view' },
        ...commonDefaults,
      ];

    case 'ancient_vehicle':
      return [
        { id: 'ancient_sedan', name: 'Sedan', nameEn: 'Inside Sedan', keyProps: [], keyPropsEn: ['sedan curtain', 'cushion'], description: 'Inside sedan view', descriptionEn: 'Inside sedan view' },
        { id: 'ancient_carriage', name: 'Carriage', nameEn: 'Inside Carriage', keyProps: [], keyPropsEn: ['canopy', 'cushion'], description: 'Inside carriage view', descriptionEn: 'Inside carriage view' },
        { id: 'ancient_boat', name: 'Boat Cabin', nameEn: 'Boat Cabin', keyProps: [], keyPropsEn: ['cabin', 'window'], description: 'Boat cabin view', descriptionEn: 'Boat cabin view' },
        { id: 'ancient_deck', name: 'Deck', nameEn: 'Ship Deck', keyProps: [], keyPropsEn: ['deck', 'sail'], description: 'Deck view', descriptionEn: 'Deck view' },
        { id: 'ancient_horse', name: 'Horseback', nameEn: 'On Horseback', keyProps: [], keyPropsEn: ['horse', 'saddle'], description: 'Horseback view', descriptionEn: 'Horseback view' },
        ...commonDefaults,
      ];
      
    default:
      return commonDefaults;
  }
}


/**
 * Extract all viewpoints (unlimited count)
 * Returns all recognized viewpoints, no longer limited to 6
 *
 * Viewpoints are extracted from shot content, no environment filtering
 *
 * @param shots Shot list
 * @param sceneLocation Scene location (only used to supplement default viewpoints)
 */
export function extractAllViewpointsFromShots(
  shots: Shot[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _sceneLocation?: string
): SceneViewpoint[] {
  const viewpointMap = new Map<string, SceneViewpoint>();
  const matchedShotIds = new Set<string>();

  // First pass: Match shots to viewpoints by keywords
  for (const shot of shots) {
    const searchText = getShotSearchableText(shot);
    let shotMatched = false;

    for (const [keyword, config] of Object.entries(VIEWPOINT_KEYWORDS)) {
      if (searchText.includes(keyword)) {
        shotMatched = true;

        if (!viewpointMap.has(config.id)) {
          viewpointMap.set(config.id, {
            id: config.id,
            name: config.name,
            nameEn: config.nameEn,
            shotIds: [shot.id],
            keyProps: [...config.propsEn], // Use English props
            keyPropsEn: [...config.propsEn],
            description: '',
            descriptionEn: '',
            gridIndex: viewpointMap.size,
          });
        } else {
          const existing = viewpointMap.get(config.id)!;
          if (!existing.shotIds.includes(shot.id)) {
            existing.shotIds.push(shot.id);
          }
          for (const prop of config.propsEn) {
            if (!existing.keyPropsEn.includes(prop)) {
              existing.keyPropsEn.push(prop);
            }
          }
        }
      }
    }

    if (shotMatched) {
      matchedShotIds.add(shot.id);
    }
  }

  // Second pass: Assign unmatched shots to overview viewpoint
  const unmatchedShots = shots.filter(s => !matchedShotIds.has(s.id));
  if (unmatchedShots.length > 0) {
    if (!viewpointMap.has('overview')) {
      viewpointMap.set('overview', {
        id: 'overview',
        name: 'Overview',
        nameEn: 'Overview',
        shotIds: unmatchedShots.map(s => s.id),
        keyProps: [],
        keyPropsEn: [],
        description: 'Overall spatial layout',
        descriptionEn: 'Overall spatial layout',
        gridIndex: viewpointMap.size,
      });
    } else {
      const overview = viewpointMap.get('overview')!;
      for (const shot of unmatchedShots) {
        if (!overview.shotIds.includes(shot.id)) {
          overview.shotIds.push(shot.id);
        }
      }
    }
  }

  // Sort by associated shot count
  const viewpoints = Array.from(viewpointMap.values())
    .sort((a, b) => b.shotIds.length - a.shotIds.length);

  // Supplement default viewpoints (overview and detail)
  const defaultViewpoints = [
    { id: 'overview', name: 'Overview', nameEn: 'Overview', keyProps: [] as string[], keyPropsEn: [] as string[], description: 'Overall spatial layout', descriptionEn: 'Overall spatial layout' },
    { id: 'detail', name: 'Detail View', nameEn: 'Detail View', keyProps: [] as string[], keyPropsEn: [] as string[], description: 'Detail close-up', descriptionEn: 'Detail close-up' },
  ];
  
  while (viewpoints.length < 6 && defaultViewpoints.length > 0) {
    const def = defaultViewpoints.shift()!;
    if (!viewpoints.some(v => v.id === def.id)) {
      viewpoints.push({
        ...def,
        shotIds: [],
        gridIndex: viewpoints.length,
      });
    }
  }
  
  viewpoints.forEach((v, i) => { v.gridIndex = i; });
  
  return viewpoints;
}

/**
 * Group viewpoints into contact sheet pages
 * Maximum 6 viewpoints per page
 */
export function groupViewpointsIntoPages(
  viewpoints: SceneViewpoint[],
  viewpointsPerPage: number = 6
): SceneViewpoint[][] {
  const pages: SceneViewpoint[][] = [];

  for (let i = 0; i < viewpoints.length; i += viewpointsPerPage) {
    const page = viewpoints.slice(i, i + viewpointsPerPage);
    // Reassign gridIndex within page (0-5)
    page.forEach((v, idx) => { v.gridIndex = idx; });
    pages.push(page);
  }

  return pages;
}

/**
 * Generate contact sheet prompts
 * Returns PendingViewpointData and ContactSheetPromptSet for passing to scene library
 *
 * Layout selection logic:
 * - Viewpoints ≤ 6: Use 2x3 or 3x2 (1 image)
 * - Viewpoints 7-9: Use 3x3 (1 image)
 * - Viewpoints > 9: Multiple images
 */
export function generateMultiPageContactSheetData(
  config: ContactSheetConfig,
  shots: Shot[] // Used to get shot numbers
): {
  viewpoints: PendingViewpointData[];
  contactSheetPrompts: ContactSheetPromptSet[];
} {
  const { scene, styleTokens, aspectRatio } = config;

  // Extract all viewpoints (pass scene location for environment filtering)
  const sceneLocation = scene.location || scene.name || '';
  const allViewpoints = extractAllViewpointsFromShots(config.shots, sceneLocation);

  // Automatically select optimal layout based on viewpoint count and aspect ratio
  // Force NxN layout (2x2 or 3x3) for consistent aspect ratio, matching Director panel
  let gridLayout: { rows: number; cols: number };
  let viewpointsPerPage: number;

  const vpCount = allViewpoints.length;

  if (vpCount <= 4) {
    // 4 or fewer: Use 2x2
    gridLayout = { rows: 2, cols: 2 };
    viewpointsPerPage = 4;
  } else {
    // More than 4: Use 3x3 (max 9 per page)
    gridLayout = { rows: 3, cols: 3 };
    viewpointsPerPage = 9;
  }

  console.log('[ContactSheet] Layout selection:', { vpCount, aspectRatio, gridLayout, viewpointsPerPage });

  // Paginate
  const pages = groupViewpointsIntoPages(allViewpoints, viewpointsPerPage);

  // Build scene base description
  const sceneDescEn = [
    scene.architectureStyle && `Architecture: ${scene.architectureStyle}`,
    scene.colorPalette && `Color palette: ${scene.colorPalette}`,
    scene.eraDetails && `Era: ${scene.eraDetails}`,
    scene.lightingDesign && `Lighting: ${scene.lightingDesign}`,
  ].filter(Boolean).join('. ');

  const sceneDescZh = ''; // No Chinese description needed

  const styleStr = styleTokens.length > 0
    ? styleTokens.join(', ')
    : 'anime style, soft colors, detailed background';

  // Build shot ID to index mapping
  const shotIdToIndex = new Map<string, number>();
  shots.forEach(shot => {
    shotIdToIndex.set(shot.id, shot.index);
  });

  // Generate PendingViewpointData
  const pendingViewpoints: PendingViewpointData[] = [];

  pages.forEach((pageViewpoints, pageIndex) => {
    pageViewpoints.forEach((vp, idx) => {
      // Generate viewpoint description
      const propsEn = vp.keyPropsEn.length > 0 ? ` with ${vp.keyPropsEn.join(', ')}` : '';
      vp.description = `${vp.name} view${propsEn}`;
      vp.descriptionEn = `${vp.nameEn} angle${propsEn}`;

      // Update gridIndex
      vp.gridIndex = idx;

      // Get associated shot indexes
      const shotIndexes = vp.shotIds
        .map(id => shotIdToIndex.get(id))
        .filter((idx): idx is number => idx !== undefined)
        .sort((a, b) => a - b);

      pendingViewpoints.push({
        id: vp.id,
        name: vp.name,
        nameEn: vp.nameEn,
        shotIds: vp.shotIds,
        shotIndexes,
        keyProps: vp.keyProps,
        keyPropsEn: vp.keyPropsEn,
        gridIndex: vp.gridIndex,
        pageIndex,
      });
    });
  });

  // Generate ContactSheetPromptSet for each page
  const contactSheetPrompts: ContactSheetPromptSet[] = pages.map((pageViewpoints, pageIndex) => {
    const totalCells = gridLayout.rows * gridLayout.cols;
    const paddedCount = totalCells;
    const actualCount = pageViewpoints.length;

    // Build enhanced prompt (Structured Prompt)
    const promptParts: string[] = [];

    // 1. Core instruction block
    promptParts.push('<instruction>');
    promptParts.push(`Generate a clean ${gridLayout.rows}x${gridLayout.cols} architectural concept grid with exactly ${paddedCount} equal-sized panels.`);
    promptParts.push(`Overall Image Aspect Ratio: ${aspectRatio}.`);

    // Explicitly specify individual panel aspect ratio to prevent AI confusion
    const panelAspect = aspectRatio === '16:9' ? '16:9 (horizontal landscape)' : '9:16 (vertical portrait)';
    promptParts.push(`Each individual panel must have a ${panelAspect} aspect ratio.`);

    promptParts.push('Structure: No borders between panels, no text, no watermarks.');
    promptParts.push('Consistency: Maintain consistent perspective, lighting, and style across all panels.');
    promptParts.push('Subject: Interior design and architectural details only, NO people.');
    promptParts.push('</instruction>');

    // 2. Layout description
    promptParts.push(`Layout: ${gridLayout.rows} rows, ${gridLayout.cols} columns, reading order left-to-right, top-to-bottom.`);

    // 3. Scene information
    if (sceneDescEn) {
      promptParts.push(`Scene Context: ${sceneDescEn}`);
    }

    // 4. Content description for each panel
    pageViewpoints.forEach((vp, idx) => {
      const row = Math.floor(idx / gridLayout.cols) + 1;
      const col = (idx % gridLayout.cols) + 1;

      const content = vp.keyPropsEn.length > 0
        ? `showing ${vp.keyPropsEn.join(', ')}`
        : (vp.nameEn === 'Overview' ? 'wide shot showing the entire room layout' : `${vp.nameEn} angle of the room`);

      promptParts.push(`Panel [row ${row}, col ${col}] (no people): ${content}`);
    });

    // 5. Empty placeholder panel description
    for (let i = actualCount; i < paddedCount; i++) {
      const row = Math.floor(i / gridLayout.cols) + 1;
      const col = (i % gridLayout.cols) + 1;
      promptParts.push(`Panel [row ${row}, col ${col}]: empty placeholder, solid gray background`);
    }

    // 6. Style and negative prompts
    promptParts.push(`Style: ${styleStr}`);
    promptParts.push('Negative constraints: text, watermark, split screen borders, speech bubbles, blur, distortion, bad anatomy, people, characters.');

    const prompt = promptParts.join('\n');

    // Chinese prompt (empty for English-only mode)
    const promptZh = '';

    return {
      pageIndex,
      prompt,
      promptZh,
      viewpointIds: pageViewpoints.map(vp => vp.id),
      gridLayout,
    };
  });

  return {
    viewpoints: pendingViewpoints,
    contactSheetPrompts,
  };
}

/**
 * Build contact sheet data from existing viewpoints data
 * Used when jumping from script panel to scene library, directly using AI-analyzed viewpoints
 *
 * @param viewpoints - Viewpoint data from ScriptScene.viewpoints
 * @param scene - Scene information (for generating prompts)
 * @param shots - Shot list (for getting shot indexes)
 * @param styleTokens - Style tokens
 * @param aspectRatio - Aspect ratio
 */
export function buildContactSheetDataFromViewpoints(
  viewpoints: Array<{
    id: string;
    name: string;
    nameEn?: string;
    shotIds: string[];
    keyProps: string[];
    gridIndex: number;
  }>,
  scene: Pick<ScriptScene, 'name' | 'location' | 'architectureStyle' | 'lightingDesign' | 'colorPalette' | 'eraDetails' | 'visualPrompt' | 'visualPromptEn'>,
  shots: Shot[],
  styleTokens: string[],
  aspectRatio: '16:9' | '9:16' = '16:9'
): {
  viewpoints: PendingViewpointData[];
  contactSheetPrompts: ContactSheetPromptSet[];
} {
  // Select layout based on viewpoint count
  const vpCount = viewpoints.length;
  let gridLayout: { rows: number; cols: number };
  let viewpointsPerPage: number;

  if (vpCount <= 4) {
    gridLayout = { rows: 2, cols: 2 };
    viewpointsPerPage = 4;
  } else {
    gridLayout = { rows: 3, cols: 3 };
    viewpointsPerPage = 9;
  }

  console.log('[buildContactSheetDataFromViewpoints] Using AI viewpoints to build contact sheet data:', {
    vpCount,
    gridLayout,
    viewpointsPerPage,
    // Debug: Scene art design fields
    sceneFields: {
      name: scene.name,
      location: scene.location,
      architectureStyle: scene.architectureStyle,
      lightingDesign: scene.lightingDesign,
      colorPalette: scene.colorPalette,
      eraDetails: scene.eraDetails,
    },
  });

  // Paginate
  const pages: typeof viewpoints[] = [];
  for (let i = 0; i < viewpoints.length; i += viewpointsPerPage) {
    const page = viewpoints.slice(i, i + viewpointsPerPage);
    // Reassign gridIndex within page (0-based)
    page.forEach((v, idx) => { v.gridIndex = idx; });
    pages.push(page);
  }

  // Build scene description (art design fields)
  const sceneDescEn = [
    scene.architectureStyle && `Architecture: ${scene.architectureStyle}`,
    scene.colorPalette && `Color palette: ${scene.colorPalette}`,
    scene.eraDetails && `Era: ${scene.eraDetails}`,
    scene.lightingDesign && `Lighting: ${scene.lightingDesign}`,
  ].filter(Boolean).join('. ');

  const sceneDescZh = ''; // No Chinese description needed

  // Visual prompt (detailed scene description generated by AI scene calibration)
  const visualPromptZh = ''; // No Chinese visual prompt needed
  const visualPromptEn = scene.visualPromptEn || '';

  console.log('[buildContactSheetDataFromViewpoints] Scene description:', {
    sceneDescZh,
    sceneDescEn,
    visualPromptZh: '(none)',
    visualPromptEn: visualPromptEn ? visualPromptEn.substring(0, 50) + '...' : '(none)',
  });

  const styleStr = styleTokens.length > 0
    ? styleTokens.join(', ')
    : 'anime style, soft colors, detailed background';

  // Build shot ID to index mapping
  const shotIdToIndex = new Map<string, number>();
  shots.forEach(shot => {
    shotIdToIndex.set(shot.id, shot.index);
  });

  // Generate PendingViewpointData
  const pendingViewpoints: PendingViewpointData[] = [];

  pages.forEach((pageViewpoints, pageIndex) => {
    pageViewpoints.forEach((vp, idx) => {
      // Get associated shot indexes
      const shotIndexes = vp.shotIds
        .map(id => shotIdToIndex.get(id))
        .filter((idx): idx is number => idx !== undefined)
        .sort((a, b) => a - b);

      pendingViewpoints.push({
        id: vp.id,
        name: vp.name,
        nameEn: vp.nameEn || vp.name, // Use name if no English name
        shotIds: vp.shotIds,
        shotIndexes,
        keyProps: vp.keyProps,
        keyPropsEn: [], // May not have English prop names, leave empty
        gridIndex: idx,
        pageIndex,
      });
    });
  });

  // Generate ContactSheetPromptSet for each page
  const contactSheetPrompts: ContactSheetPromptSet[] = pages.map((pageViewpoints, pageIndex) => {
    const totalCells = gridLayout.rows * gridLayout.cols;
    const paddedCount = totalCells;
    const actualCount = pageViewpoints.length;

    // Build English prompt
    const promptParts: string[] = [];

    promptParts.push('<instruction>');
    promptParts.push(`Generate a clean ${gridLayout.rows}x${gridLayout.cols} architectural concept grid with exactly ${paddedCount} equal-sized panels.`);
    promptParts.push(`Overall Aspect Ratio: ${aspectRatio}.`);
    promptParts.push('Structure: No borders between panels, no text, no watermarks.');
    promptParts.push('Consistency: Maintain consistent perspective, lighting, and style across all panels.');
    promptParts.push('Subject: Interior design and architectural details only, NO people.');
    promptParts.push('</instruction>');

    promptParts.push(`Layout: ${gridLayout.rows} rows, ${gridLayout.cols} columns, reading order left-to-right, top-to-bottom.`);

    if (sceneDescEn) {
      promptParts.push(`Scene Context: ${sceneDescEn}`);
    }

    // Add visual prompt (English)
    if (visualPromptEn) {
      promptParts.push(`Visual Description: ${visualPromptEn}`);
    }

    // Content description for each panel
    pageViewpoints.forEach((vp, idx) => {
      const row = Math.floor(idx / gridLayout.cols) + 1;
      const col = (idx % gridLayout.cols) + 1;
      const vpNameEn = vp.nameEn || vp.name;
      const content = vp.keyProps.length > 0
        ? `showing ${vp.keyProps.join(', ')}`
        : (vpNameEn === 'Overview' || vp.name === 'Overview' ? 'wide shot showing the entire room layout' : `${vpNameEn} angle of the room`);

      promptParts.push(`Panel [row ${row}, col ${col}] (no people): ${content}`);
    });

    // Empty placeholder panels
    for (let i = actualCount; i < paddedCount; i++) {
      const row = Math.floor(i / gridLayout.cols) + 1;
      const col = (i % gridLayout.cols) + 1;
      promptParts.push(`Panel [row ${row}, col ${col}]: empty placeholder, solid gray background`);
    }

    promptParts.push(`Style: ${styleStr}`);
    promptParts.push('Negative constraints: text, watermark, split screen borders, speech bubbles, blur, distortion, bad anatomy, people, characters.');

    const prompt = promptParts.join('\n');

    // Chinese prompt (empty for English-only mode)
    const promptZh = '';

    return {
      pageIndex,
      prompt,
      promptZh,
      viewpointIds: pageViewpoints.map(vp => vp.id),
      gridLayout,
    };
  });
  
  return {
    viewpoints: pendingViewpoints,
    contactSheetPrompts,
  };
}
