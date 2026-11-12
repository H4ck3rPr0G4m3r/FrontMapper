import { infoErrors } from '../../state/mapOps';
import { exportMap, exportState, saveProjectFile } from '../../state/projectIO';
import type { EditorController } from '../../state/controller';
import { sideTab } from './SidePanel';

export function ExportActions({ controller }: { controller: EditorController }) {
  const st = exportState.value;
  const errors = infoErrors.value;
  const label = st.phase === 'waiting' ? 'Finishing edits…' : st.phase === 'exporting' ? 'Exporting…' : 'Export';
  const onExport = () => {
    if (errors.length) {
      sideTab.value = 'checks';
      exportState.value = { phase: 'error', message: `Fix the map info first: ${errors[0]}` };
      return;
    }
    exportMap(controller);
  };
  return (
    <div class="export-actions">
      <button class="btn" onClick={() => saveProjectFile(controller)} title="Download a .frontmap project file">
        <i aria-hidden="true" class="ph ph-floppy-disk" />
        <span class="btn-label">Save</span>
      </button>
      <button class="btn primary" onClick={onExport} disabled={st.phase === 'waiting' || st.phase === 'exporting'}>
        <i aria-hidden="true" class="ph ph-export" />
        {label}
      </button>
      {st.phase === 'error' && (
        <div class="export-error" role="alert">
          <i aria-hidden="true" class="ph-bold ph-warning" />
          <span>{st.message}</span>
          <button class="icon-btn sm" aria-label="Dismiss" onClick={() => (exportState.value = { phase: 'idle' })}>
            <i aria-hidden="true" class="ph ph-x" />
          </button>
        </div>
      )}
    </div>
  );
}
