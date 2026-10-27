import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage(); const errs=[]; p.on('pageerror', e=>errs.push(e.message));
await p.goto('http://127.0.0.1:22673/', { waitUntil: 'networkidle2' }); await new Promise(r=>setTimeout(r,4000));
console.log(await p.evaluate(()=>[block.textContent, pqFinal.textContent, validators.textContent, status.textContent])); console.log(errs); await b.close();
