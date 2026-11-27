import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { requestPersistentStorage } from './lib/offlineDb';
import { recordPwaDiagError } from './lib/pwaDiagnostics';

if (import.meta.env.PROD && typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('/sw.js', { scope: '/', updateViaCache: 'none' })
    .then(() => navigator.serviceWorker.ready)
    .then(() => {
      void requestPersistentStorage();
    })
    .catch((err) => {
      recordPwaDiagError('registration', err);
    });
}

createRoot(document.getElementById('root')!).render(<App />);
