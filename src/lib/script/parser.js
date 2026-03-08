/**
 * Simple Script Parser for AI Creative Studio
 * Parses scripts into episodes and shots
 */

export function parseScript(text) {
  if (!text || text.trim().length === 0) {
    return { episodes: [], error: 'Empty script' };
  }

  // Split by episode markers
  const episodeBlocks = text.split(/(?:^|\n)Episode\s+\d+/gi).filter(block => block.trim().length > 50);

  const episodes = episodeBlocks.map((block, index) => {
    const lines = block.split('\n').filter(line => line.trim());
    const scenes = parseScenes(block);

    return {
      number: index + 1,
      title: extractTitle(lines[0]) || `Episode ${index + 1}`,
      content: block.trim(),
      sceneCount: scenes.length,
      estimatedShots: Math.ceil(block.split(/\s+/).length / 150)
    };
  });

  return { episodes, error: null };
}

function parseScenes(block) {
  // Find scene headers (all caps lines)
  const lines = block.split('\n');
  const scenes = [];
  let currentScene = null;

  lines.forEach(line => {
    const trimmed = line.trim();
    // Scene header pattern: **1-1 Day Int. Location**
    if (trimmed.match(/^\*\*\d+-\d+/) || trimmed.match(/^[A-Z][A-Z\s]{5,}$/)) {
      if (currentScene) scenes.push(currentScene);
      currentScene = { header: trimmed, content: [] };
    } else if (currentScene) {
      currentScene.content.push(trimmed);
    }
  });

  if (currentScene) scenes.push(currentScene);
  return scenes;
}

function extractTitle(firstLine) {
  if (!firstLine) return null;
  const titleMatch = firstLine.match(/^[:\s]*([A-Z][^,\n]+)/i);
  return titleMatch ? titleMatch[1].trim() : null;
}

export function generateShots(episode) {
  const words = episode.content.split(/\s+/);
  const shotsCount = Math.ceil(words.length / 150);

  return Array.from({ length: shotsCount }, (_, i) => ({
    id: crypto.randomUUID(),
    episodeNumber: episode.number,
    shotNumber: i + 1,
    description: `Shot ${i + 1} from ${episode.title}`,
    cinematography: {
      lens: 'Wide',
      movement: 'Static',
      lighting: 'Natural'
    }
  }));
}
