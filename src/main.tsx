import './index.css';
import './lib/pwaRegister';

void (async () => {
  try {
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
          <div>App startup failed.</div>
          <pre style="margin-top:8px;white-space:pre-wrap">${details}</pre>
        </div>`;
    }
    console.error(error);
  }
})();
