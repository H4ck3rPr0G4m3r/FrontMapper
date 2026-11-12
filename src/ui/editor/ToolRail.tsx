import { tool, type Tool } from '../../state/store';

interface Item {
  id: Tool;
  icon: string;
  label: string;
  key: string;
}

const GROUPS: Item[][] = [
  [
    { id: 'pan', icon: 'ph-hand', label: 'Pan', key: 'H' },
    { id: 'select', icon: 'ph-selection', label: 'Select', key: 'M' },
  ],
  [
    { id: 'brush', icon: 'ph-paint-brush', label: 'Brush', key: 'B' },
    { id: 'fill', icon: 'ph-paint-bucket', label: 'Fill', key: 'G' },
    { id: 'raise', icon: 'ph-mountains', label: 'Raise / lower', key: 'R' },
    { id: 'smooth', icon: 'ph-wave-sine', label: 'Smooth', key: 'S' },
    { id: 'texture', icon: 'ph-dots-nine', label: 'Texture', key: 'T' },
    { id: 'eyedropper', icon: 'ph-eyedropper', label: 'Pick terrain', key: 'I' },
  ],
  [{ id: 'spawn', icon: 'ph-flag', label: 'Nation spawn', key: 'N' }],
];

export const TOOL_KEYS: Record<string, Tool> = Object.fromEntries(GROUPS.flat().map((t) => [t.key.toLowerCase(), t.id]));

export function ToolRail() {
  return (
    <nav class="ed-tools" aria-label="Tools">
      {GROUPS.map((group, gi) => (
        <>
          {gi > 0 && <div class="rail-sep" />}
          {group.map((t) => (
            <button
              key={t.id}
              class={`tool${tool.value === t.id ? ' on' : ''}`}
              aria-label={t.label}
              aria-pressed={tool.value === t.id}
              onClick={() => (tool.value = t.id)}
            >
              <i aria-hidden="true" class={`ph ${t.icon}`} />
              <span class="tip">
                {t.label}
                <kbd>{t.key}</kbd>
              </span>
            </button>
          ))}
        </>
      ))}
    </nav>
  );
}
