import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './style.css';
import './lobby.css';
import './gameplay.css';
import './phase4.css';

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
