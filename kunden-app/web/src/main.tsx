import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import '@fontsource/castoro/latin-400.css';
import '@fontsource/castoro/latin-400-italic.css';
import '@fontsource/tenor-sans/latin-400.css';
import './styles.css';
import App from './App';

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(<App />);
