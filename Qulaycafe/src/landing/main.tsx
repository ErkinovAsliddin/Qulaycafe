import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import Page from './page';
import './styles.css';

// The marketing site is a single page with no router and no data fetching, so
// there is nothing to resolve before the first paint (unlike src/main.tsx,
// which waits for the restaurant context).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
