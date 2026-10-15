import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './fonts/fonts.css';
import './styles.css';
import App from './App';
import { applyTheme } from './lib/theme';
import './lib/install';

applyTheme();
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(<App />);
