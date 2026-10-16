import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './fonts/fonts.css';
import './styles.css';
import App from './App';
import { applyTheme } from './lib/theme';
import './lib/install';
import { externeLinksImNeuenTab } from './lib/links';

applyTheme();
registerSW({ immediate: true });
externeLinksImNeuenTab();

createRoot(document.getElementById('root')!).render(<App />);
