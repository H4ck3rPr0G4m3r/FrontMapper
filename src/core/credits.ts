/** Open data sources a map can be built from. Satellite imagery is display-only and never listed. */
export type SourceId = 'osm' | 'terrain-tiles' | 'natural-earth';

/**
 * Attribution lines in the shape of OpenFront's CREDITS.md "Map Data" section.
 * Sources that already have an entry there only need adding once; the header comment says so.
 */
export function creditsSnippet(ids: SourceId[], displayName: string): string {
  const parts: string[] = [
    '<!-- FrontMapper: merge into the "Map Data" section of CREDITS.md.',
    '     Sources that already have an entry there only need the map named; add what is missing. -->',
  ];
  if (!ids.length) parts.push('', 'No external map data was used for this map.');
  if (ids.includes('osm')) {
    parts.push(
      '',
      '### OpenStreetMap',
      '',
      '© [OpenStreetMap contributors](https://www.openstreetmap.org/copyright)  ',
      'Licensed under ODbL',
      'Vector tiles: [OpenFreeMap](https://openfreemap.org) / [OpenMapTiles](https://openmaptiles.org)',
    );
  }
  if (ids.includes('terrain-tiles')) {
    parts.push(
      '',
      '### Terrain Tiles',
      '',
      `Elevation data from [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen/Tilezen), used for the ${displayName} map.`,
      'Source attribution: [tilezen/joerd attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)',
    );
  }
  if (ids.includes('natural-earth')) {
    parts.push('', '### Natural Earth', '', '[Natural Earth](https://www.naturalearthdata.com/)  ', 'Public Domain');
  }
  return parts.join('\n') + '\n';
}
