import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import './styles.css';
import { ChatView } from './components/chat-view';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement,
);

root.render(
  <StrictMode>
    <ChatView />
  </StrictMode>,
);
