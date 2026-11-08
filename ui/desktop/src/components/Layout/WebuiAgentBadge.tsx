import React from 'react';

// Rendered only when the web bootstrap supplies an agent identity, so the
// desktop app is unaffected.
export const WebuiAgentBadge: React.FC = () => {
  const agentId = window.appConfig?.get('GOOSE_WEBUI_ID');
  if (typeof agentId !== 'string' || agentId.length === 0) return null;
  return (
    <span
      title={`This webui is served by the goose agent on ${agentId}`}
      className="ml-1 hidden select-none items-center rounded-md border border-border-subtle bg-background-tertiary px-1.5 py-0.5 text-[10px] font-medium leading-none text-text-secondary sm:flex"
    >
      goose@{agentId}
    </span>
  );
};
