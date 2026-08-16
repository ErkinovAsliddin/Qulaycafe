import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initRestaurantContext } from './utils/restaurantContext';

// Awaited so that if the person arrived via a restaurant's shareable link
// (/order/<slug>), the slug is already resolved to a restaurant id before
// the app's very first API calls go out — otherwise those first calls
// would briefly hit the wrong (default) tenant while resolution was still
// in flight.
initRestaurantContext().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
