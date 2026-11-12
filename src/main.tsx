import { render } from 'preact';
import '@phosphor-icons/web/regular';
import '@phosphor-icons/web/bold';
import './ui/theme.css';
import { App } from './ui/App';

render(<App />, document.getElementById('app')!);
