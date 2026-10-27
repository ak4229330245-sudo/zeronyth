/** Portable, dependency-free platform eligibility rules (also importable by web clients). */
export const DEVICE_CLASSES=Object.freeze(['server','desktop','phone','tablet']);
export const DEVICE_ROLES=Object.freeze(['validator','compute','relay','light']);
export const DEVICE_PLATFORMS=Object.freeze(['linux','windows','macos','android','ios','ipados']);

const PROFILE_FIELDS=['deviceClass','platform','runtime','role','maxCpuPct','foregroundOnly'];
const HEARTBEAT_FIELDS=['foreground','charging','unmetered','batteryPct','thermal'];
const THERMAL=['normal','warm','hot','critical'];

function exact(object,fields){
  return object&&typeof object==='object'&&!Array.isArray(object)&&
    JSON.stringify(Object.keys(object).sort())===JSON.stringify([...fields].sort());
}

export function validateDeviceProfile(profile){
  if(!exact(profile,PROFILE_FIELDS)) throw Error('Unexpected device profile fields');
  const {deviceClass,platform,runtime,role,maxCpuPct,foregroundOnly}=profile;
  if(!DEVICE_CLASSES.includes(deviceClass)||!DEVICE_PLATFORMS.includes(platform)||
    !['native','browser'].includes(runtime)||!DEVICE_ROLES.includes(role)){
    throw Error('Unknown device classification');
  }
  const mobile=deviceClass==='phone'||deviceClass==='tablet';
  if(mobile!==['ios','ipados','android'].includes(platform)) {
    throw Error('Device platform/class combination prohibited');
  }
  if(platform==='ipados'&&deviceClass!=='tablet') throw Error('iPadOS requires tablet');
  if(platform==='ios'&&deviceClass!=='phone') throw Error('iOS requires phone');
  if(typeof maxCpuPct!=='string'||!/^(0|[1-9][0-9]?)$/.test(maxCpuPct)||
    Number(maxCpuPct)<1||Number(maxCpuPct)>50) throw Error('CPU budget must be 1..50 percent');
  if(typeof foregroundOnly!=='boolean') throw Error('Explicit foreground-only policy required');
  if(mobile&&!foregroundOnly) throw Error('Mobile nodes must be foreground-only');
  if((mobile||runtime==='browser')&&role==='validator') {
    throw Error('Mobile/browser cannot advertise continuous consensus validation');
  }
  if(['ios','ipados'].includes(platform)&&role==='compute') {
    throw Error('iPhone/iPad rewarded compute disallowed pending App Store compliance review');
  }
  if(runtime==='browser'&&role==='compute'&&!foregroundOnly) {
    throw Error('Browser compute requires a visible foreground session');
  }
  return true;
}

export function validateDeviceHeartbeat(heartbeat){
  if(!exact(heartbeat,HEARTBEAT_FIELDS)) throw Error('Unexpected heartbeat fields');
  if(!['foreground','charging','unmetered'].every(k=>typeof heartbeat[k]==='boolean')) {
    throw Error('Heartbeat booleans required');
  }
  if(typeof heartbeat.batteryPct!=='string'||
    !/^(0|[1-9][0-9]?|100)$/.test(heartbeat.batteryPct)||
    Number(heartbeat.batteryPct)>100||!THERMAL.includes(heartbeat.thermal)) {
    throw Error('Invalid heartbeat battery/thermal readings');
  }
  return true;
}

export function evaluateDeviceEligibility(profile,heartbeat,{role='compute',iterations=0}={}){
  validateDeviceProfile(profile);
  validateDeviceHeartbeat(heartbeat);
  if(profile.role!==role) return {eligible:false,reason:'wrong-role'};
  if(heartbeat.thermal==='hot'||heartbeat.thermal==='critical'){
    return {eligible:false,reason:'thermal-throttle'};
  }
  if((profile.foregroundOnly||profile.runtime==='browser')&&!heartbeat.foreground){
    return {eligible:false,reason:'not-foreground'};
  }
  const mobile=['phone','tablet'].includes(profile.deviceClass);
  if(role==='validator'){
    return profile.runtime==='native'&&!mobile&&heartbeat.unmetered?
      {eligible:true,reason:'eligible'}:{eligible:false,reason:'stable-host-required'};
  }
  if(role==='relay'||role==='light'){
    return {eligible:true,reason:'eligible'};
  }
  if(!Number.isInteger(iterations)||iterations<1||iterations>10000){
    return {eligible:false,reason:'invalid-work-size'};
  }
  if(['ios','ipados'].includes(profile.platform)){
    return {eligible:false,reason:'apple-device-compute-restricted'};
  }
  if(mobile&&(!heartbeat.foreground||!heartbeat.charging||
    !heartbeat.unmetered||Number(heartbeat.batteryPct)<40)){
    return {eligible:false,reason:'mobile-power-or-network-policy'};
  }
  if(mobile&&profile.runtime==='browser'&&!heartbeat.foreground){
    return {eligible:false,reason:'browser-background-suspended'};
  }
  const maxIterations=profile.deviceClass==='server'?10000:
    profile.deviceClass==='desktop'?2000:profile.deviceClass==='tablet'?512:256;
  if(iterations>maxIterations){return {eligible:false,reason:'work-too-large-for-device'};}
  return {eligible:true,reason:'eligible',maxIterations};
}
