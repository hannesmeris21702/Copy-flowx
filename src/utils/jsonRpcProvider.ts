require("dotenv").config({});

import { JsonRpcError, SuiClient, SuiHTTPStatusError, SuiTransport, SuiTransportRequestOptions, SuiTransportSubscribeOptions } from "@mysten/sui/client";


const HTTP_TRANSPORT_DEFAULTS = {
  maxRetry: 10,
  timeoutMs: 30000,
};

class HTTPTransport implements SuiTransport {
  private rpcEndpoints: { node: string; enable: boolean }[] = [];
  private maxRetry: number;
  private currentNodeIndex = 0;
  private timeoutMs: number;

  constructor(options: { rpcEndpoints: string[]; maxRetry?: number; timeoutMs?: number }) {
    const { rpcEndpoints, maxRetry, timeoutMs } = options;

    if (rpcEndpoints.length === 0) {
      throw Error(`HTTPTransport: RPC endpoints empty`);
    }

    this.rpcEndpoints = rpcEndpoints.map(node => ({ node, enable: true }));
    this.maxRetry = maxRetry ?? HTTP_TRANSPORT_DEFAULTS.maxRetry;
    this.timeoutMs = timeoutMs ?? HTTP_TRANSPORT_DEFAULTS.timeoutMs;
  }

  private setDisableNode(nodeIndex: number): void {
    if (!this.rpcEndpoints[nodeIndex].enable) {
      return;
    }

    this.rpcEndpoints[nodeIndex].enable = false;
    setTimeout(() => {
      this.rpcEndpoints[nodeIndex].enable = true;
    }, 1000);
  }

  async fetch(url: string, reqInit: RequestInit) {
    const response = await fetch(url, { ...reqInit, signal: AbortSignal.timeout(this.timeoutMs), keepalive: true });

    return response;
  }

  private getNodeIndex(): number {
    this.currentNodeIndex++;

    if (this.currentNodeIndex > this.rpcEndpoints.length - 1) {
      this.currentNodeIndex = 0;
    }

    return this.currentNodeIndex;
  }

  getCurrentNodeInfo() {
    return this.rpcEndpoints[this.currentNodeIndex].node;
  }

  private allNodeIsDisable(): boolean {
    for (const node of this.rpcEndpoints) {
      if (node.enable) {
        return false;
      }
    }

    return true;
  }

  async request<T>(input: SuiTransportRequestOptions, retryCounter = this.maxRetry): Promise<T> {
    if (this.allNodeIsDisable()) {
      await this.sleep(100);
    }

    const nodeIndex = this.getNodeIndex();
    const node = this.rpcEndpoints[nodeIndex];

    if (!node.enable) {
      return this.request(input, retryCounter);
    }
    
    const startTime = Date.now();

    const [error, res] = await this.executePromise(
      this.fetch(node.node, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: input.method,
          params: input.params,
        }),
      }),
    );

    if (error) {
      if (retryCounter === 0) {
        throw error;
      }

      return this.handleRetryRequest(nodeIndex, input, retryCounter);
    }

    if (!res.ok) {
      if (retryCounter === 0) {
        throw new SuiHTTPStatusError(
          `Unexpected status code: ${res.status} [node: ${node.node}]`,
          res.status,
          res.statusText,
        );
      }

      return this.handleRetryRequest(nodeIndex, input, retryCounter);
    }

    const data = await res.json();

    if ('error' in data && data.error != null) {
      throw new JsonRpcError(`${data.error.message} [node: ${node.node}]`, data.error.code);
    }

    return data.result;
  }

  private handleRetryRequest<T>(
    nodeIndex: number,
    input: SuiTransportRequestOptions,
    retryCounter = this.maxRetry,
  ): Promise<T> {
    this.setDisableNode(nodeIndex);
    retryCounter--;
    return this.request(input, retryCounter);
  }

  async subscribe<T = unknown>(input: SuiTransportSubscribeOptions<T>): Promise<() => Promise<boolean>> {
    return () => Promise.resolve(true);
  }

  private executePromise(promise: Promise<any>) {
    return promise.then(data => [null, data]).catch(error => [error, null]);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const jsonRpcProvider = new SuiClient({
  transport: new HTTPTransport({
    rpcEndpoints: [process.env.JSON_RPC_ENDPOINT],
    maxRetry: 0,
  }),
});
