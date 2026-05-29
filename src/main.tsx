import './index.css';
import './lib/pwaRegister';
import {initSupabase} from './lib/supabase';

void (async () => {
  try {
    await initSupabase();

    const [{createRoot}, {StrictMode}, {default: App}] = await Promise.all([
      import('react-dom/client'),
      import('react'),
      import('./App.tsx'),
    ]);

    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  } catch (error) {
    const root = document.getElementById('root');
    const details = error instanceof Error ? error.message : String(error);
    if (root) {
      root.innerHTML =
        `<div style="padding:16px;font-family:system-ui">
          <div>Supabase startup failed.</div>
          <div style="margin-top:8px">Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.</div>
          <pre style="margin-top:8px;white-space:pre-wrap">${details}</pre>
        </div>`;
    }
    console.error(error);
  }
})();
