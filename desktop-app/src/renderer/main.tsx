import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import './design-system/tokens.css';
import './design-system/base.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
