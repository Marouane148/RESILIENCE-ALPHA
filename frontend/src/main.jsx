import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import PaymentDashboard from './components/PaymentDashboard';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PaymentDashboard />
  </StrictMode>,
);
