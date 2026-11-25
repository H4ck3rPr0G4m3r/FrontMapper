import { render } from 'preact';
import '@phosphor-icons/web/regular';
import '@phosphor-icons/web/bold';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './ui/theme.css';
import { App } from './ui/App';
import { watchConnection } from './state/offline';

watchConnection();
render(<App />, document.getElementById('app')!);
