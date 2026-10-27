import { computeFederatedGradient } from './ai-federated-math.mjs';

self.onmessage = ({ data }) => {
  try {
    if (!data || typeof data.jobId !== 'string') throw new Error('Invalid training task');
    const gradient = computeFederatedGradient(data);
    self.postMessage({ jobId: data.jobId, gradient, sampleCount: data.samples.length });
  } catch {
    self.postMessage({ error: 'Local training update could not be calculated' });
  }
};
