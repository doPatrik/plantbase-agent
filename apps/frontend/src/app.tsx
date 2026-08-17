import { useState } from 'react';
import { ChatView } from './components/chat-view';
import { CostEstimatorView } from './components/cost-estimator-view';
import { Button } from './components/ui/button';

type Tab = 'chat' | 'cost' | 'customer';

/** Tab-shell: Chat | Ügyfélchat | Költség-becslő — nincs router, csak nézet-váltó state. */
export function App() {
  const [tab, setTab] = useState<Tab>('chat');
  return (
    <div className="flex h-screen flex-col">
      <nav className="flex gap-2 border-b border-border p-2">
        <Button
          variant={tab === 'chat' ? 'default' : 'ghost'}
          onClick={() => setTab('chat')}
        >
          Chat
        </Button>
        <Button
          variant={tab === 'customer' ? 'default' : 'ghost'}
          onClick={() => setTab('customer')}
        >
          Ügyfélchat
        </Button>
        <Button
          variant={tab === 'cost' ? 'default' : 'ghost'}
          onClick={() => setTab('cost')}
        >
          Költség-becslő
        </Button>
      </nav>
      <div className="flex-1 overflow-hidden">
        {tab === 'chat' && <ChatView />}
        {tab === 'customer' && <ChatView variant="customer" />}
        {tab === 'cost' && <CostEstimatorView />}
      </div>
    </div>
  );
}
