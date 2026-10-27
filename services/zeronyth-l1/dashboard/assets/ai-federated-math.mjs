const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function sentimentFeatures(text) {
  const value = String(text).toLowerCase();
  const positive = (value.match(/\b(great|good|excellent|wonderful|helpful|love|happy|fantastic|useful)\b/g) || []).length;
  const negative = (value.match(/\b(bad|poor|awful|terrible|unhelpful|hate|unhappy|horrible|useless|frustrating)\b/g) || []).length;
  return [1, Math.min(positive, 3) / 3, Math.min(negative, 3) / 3];
}

export function computeFederatedGradient({ weights, samples }) {
  if (!Array.isArray(weights) || weights.length !== 3 || !Array.isArray(samples) ||
      !samples.length || samples.length > 32) throw new Error('Invalid local training batch');
  const gradient = [0, 0, 0];
  for (const sample of samples) {
    if (!Array.isArray(sample.features) || sample.features.length !== weights.length ||
        sample.features.some((value) => !Number.isFinite(value) || Math.abs(value) > 1) ||
        ![0, 1].includes(sample.label)) throw new Error('Invalid training sample');
    const z = weights.reduce((sum, weight, index) => sum + weight * sample.features[index], 0);
    const probability = 1 / (1 + Math.exp(-clamp(z, -30, 30)));
    for (let i = 0; i < gradient.length; i++) {
      gradient[i] += (probability - sample.label) * sample.features[i] / samples.length;
    }
  }
  return gradient.map((value) => clamp(value, -2, 2));
}
