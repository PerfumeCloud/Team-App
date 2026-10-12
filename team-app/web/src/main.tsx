import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import '@fontsource-variable/inter';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import './styles.css';
import App from './App';
import { applyTheme } from './lib/theme';

applyTheme();
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(<App />);
