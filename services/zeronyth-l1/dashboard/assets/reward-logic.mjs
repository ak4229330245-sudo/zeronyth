/**
 * ZERONYTH Reward Logic (Testnet Simulation Only)
 * No real value. No mainnet. Local calculation only.
 *
 * Rules:
 * - AI usage fee is paid in ZNYT (testnet token).
 * - A portion of the fee is distributed to node providers
 *   proportional to their verified job contribution.
 * - VPS contribution also earns a share.
 * - Quantum-resistant path and privacy commitments are unaffected.
 */

export const REWARD_CONFIG = {
  aiFee: 0.5,          // ZNYT per AI use
  vpsFee: 1.2,         // ZNYT per VPS use
  // Mirrors the on-chain 10-day plan (ZnytEconomy): the fee is held in escrow and paid out to providers that
  // were online during the plan (unused time is refunded). No burn is implemented, so burn shares are 0.
  aiProviderShare: 1.0,
  aiBurnShare: 0,
  vpsProviderShare: 1.0,
  vpsBurnShare: 0,
  minJobsForReward: 1,
};

export class RewardEngine {
  constructor() {
    this.totalAiUses = 0;
    this.totalVpsUses = 0;
    this.totalFeesCollected = 0;
    this.totalRewardsDistributed = 0;
    this.providerJobs = 0; // verified jobs from this node
  }

  recordJobs(count) {
    this.providerJobs += count;
  }

  useAI() {
    const fee = REWARD_CONFIG.aiFee;
    this.totalAiUses += 1;
    this.totalFeesCollected += fee;
    const reward = fee * REWARD_CONFIG.aiProviderShare;
    const burned = fee * REWARD_CONFIG.aiBurnShare;
    this.totalRewardsDistributed += reward;
    this.totalBurned = (this.totalBurned || 0) + burned;
    return { fee, reward, burned, type: 'ai' };
  }

  useVPS() {
    const fee = REWARD_CONFIG.vpsFee;
    this.totalVpsUses += 1;
    this.totalFeesCollected += fee;
    const reward = fee * REWARD_CONFIG.vpsProviderShare;
    const burned = fee * REWARD_CONFIG.vpsBurnShare;
    this.totalRewardsDistributed += reward;
    this.totalBurned = (this.totalBurned || 0) + burned;
    return { fee, reward, burned, type: 'vps' };
  }

  // Proportional reward for this provider based on jobs
  myEstimatedReward(globalJobs = this.providerJobs) {
    if (globalJobs <= 0) return 0;
    const share = this.providerJobs / globalJobs;
    return this.totalRewardsDistributed * share;
  }

  summary() {
    return {
      aiUses: this.totalAiUses,
      vpsUses: this.totalVpsUses,
      feesCollected: this.totalFeesCollected.toFixed(2),
      rewardsDistributed: this.totalRewardsDistributed.toFixed(2),
      burned: (this.totalBurned || 0).toFixed(2),
      myJobs: this.providerJobs,
      myEstimated: this.myEstimatedReward().toFixed(4),
    };
  }
}

export const rewardEngine = new RewardEngine();
