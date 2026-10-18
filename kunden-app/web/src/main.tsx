import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './fonts/fonts.css';
import './styles.css';
import App from './App';
import { einladungMerken } from './lib/einladung';
import { externeLinksImNeuenTab } from './lib/links';

registerSW({ immediate: true });
einladungMerken();
externeLinksImNeuenTab();

createRoot(document.getElementById('root')!).render(<App />);
