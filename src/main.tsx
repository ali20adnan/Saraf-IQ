import './index.css';
import './lib/pwaRegister';
import {initSupabase} from './lib/supabase';

void initSupabase();

void (async () => {
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
})();
