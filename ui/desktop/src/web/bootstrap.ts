import { createElectronShim, setAcpUrl, setWebuiAgentId } from './electronShim';

// The trusted host hands out the same tokened ws URL the Electron main process
// leases to renderer windows. Same-origin deployments that reverse-proxy goosed
// can skip the fetch entirely.
const sameOriginAcpUrl = (): string =>
  `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/acp`;

let webConfig: Record<string, unknown> = {};

export const bootstrapWeb = async () => {
  if (!window.electron) {
    window.electron = createElectronShim();
  }

  if (!window.appConfig) {
    window.appConfig = {
      get: (key: string) => webConfig[key],
      getAll: () => webConfig,
    };
  }

  const fetches = await Promise.allSettled([
    fetch('/goose/acp-url'),
    fetch('/goose/config'),
  ]);
  const [acpRes, configRes] = fetches;
  if (acpRes.status === 'fulfilled' && acpRes.value.ok) {
    const { acpUrl } = (await acpRes.value.json()) as { acpUrl: string | null };
    setAcpUrl(acpUrl);
  } else {
    setAcpUrl(sameOriginAcpUrl());
  }
  if (configRes.status === 'fulfilled' && configRes.value.ok) {
    webConfig = (await configRes.value.json()) as Record<string, unknown>;
    if (typeof webConfig.GOOSE_WEBUI_ID === 'string') {
      setWebuiAgentId(webConfig.GOOSE_WEBUI_ID);
      console.info(`[goose webui] agent: ${webConfig.GOOSE_WEBUI_ID}`);
    }
  }
};
