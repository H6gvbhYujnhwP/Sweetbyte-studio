import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { applyBrandCssVars } from './brand.js';
import './index.css';

applyBrandCssVars();

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
