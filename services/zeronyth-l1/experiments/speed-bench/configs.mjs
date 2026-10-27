// Bench matrix. Defaults mirror main: FOREST, 30M gas, blockperiodseconds 1, requesttimeoutseconds 2, main JVM opts,
// layered txpool defaults, 4 validators (validator 4 = "VPS", optionally behind a delay proxy emulating the ssh tunnel).
// main runs --profile=ENTERPRISE => SEQUENCED txpool (tx-pool-max-size default 4096). Layered options are rejected in that mode.
const TXPOOL = ['--tx-pool-max-size=20000', '--tx-pool-limit-by-account-percentage=0.05'];
const LAYERED = ['--tx-pool=LAYERED', '--tx-pool-max-prioritized=30000', '--tx-pool-max-future-by-sender=2000', '--tx-pool-layer-max-capacity=150000000'];
const BIG = [['transfer', 12000], ['swap', 3000]]; // erc20 dropped for big-block configs: RAM-limited box (abort at 1.2 GB free)
const WAN = 65; // one-way ms; measured box->VPS TCP RTT ~130 ms (2026-10-27)
export const CONFIGS = {
  base:            {},
  dbg:             { idleS: 5, workloads: [['transfer', 6000], ['erc20', 2000]] },
  base_burst:      { window: 1e9, workloads: [['transfer', 6000]] },
  txpool_burst:    { window: 1e9, workloads: [['transfer', 6000]], nodeFlags: TXPOOL },
  base_wan:        { wanDelayMs: WAN },
  gas60:           { gasLimit: 60_000_000, nodeFlags: TXPOOL, window: 6000, workloads: BIG },
  gas100:          { gasLimit: 100_000_000, nodeFlags: TXPOOL, window: 9000, workloads: BIG },
  p500:            { periodMs: 500, workloads: [['transfer', 6000], ['swap', 3000]] },
  p500_wan:        { periodMs: 500, wanDelayMs: WAN, workloads: [['transfer', 6000], ['swap', 3000]] },
  p500_rt1_wan:    { periodMs: 500, requestTimeoutS: 1, wanDelayMs: WAN },
  rt1_wan:         { requestTimeoutS: 1, wanDelayMs: WAN },
  bonsai_par:      { storage: 'BONSAI', parallel: true },
  bonsai_seq:      { storage: 'BONSAI', parallel: false },
  txpool:          { nodeFlags: TXPOOL },
  layered:         { nodeFlags: LAYERED },
  layered_burst:   { window: 1e9, workloads: [['transfer', 6000]], nodeFlags: LAYERED },
  jvm1g:           { jvm: '-Xms256m -Xmx1024m -XX:MaxMetaspaceSize=192m -XX:ReservedCodeCacheSize=96m -XX:MaxDirectMemorySize=64m -XX:+UseG1GC -XX:MaxGCPauseMillis=50 -Xss512k -XX:ActiveProcessorCount=4' },
  cpu4:            { jvm: '-Xms64m -Xmx512m -XX:MaxMetaspaceSize=192m -XX:ReservedCodeCacheSize=64m -XX:MaxDirectMemorySize=64m -XX:+UseSerialGC -Xss512k -XX:ActiveProcessorCount=4' },
  gateway:         { workloads: [['transfer', 6000, 'direct', 50, 4], ['transfer', 6000, 'gateway', 50, 4], ['transfer', 3000, 'gateway', 1, 32], ['transfer', 3000, 'direct', 1, 32]] },
  combo:           { gasLimit: 60_000_000, periodMs: 500, nodeFlags: TXPOOL, window: 6000, workloads: BIG },
  combo_wan:       { gasLimit: 60_000_000, periodMs: 500, wanDelayMs: WAN, nodeFlags: TXPOOL, window: 6000, workloads: BIG },
};
