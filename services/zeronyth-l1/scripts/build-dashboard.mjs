import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const source = fileURLToPath(new URL('../dashboard/', import.meta.url));
const output = fileURLToPath(new URL('../../../artifacts/zeronyth/dist/public/', import.meta.url));
await mkdir(output, { recursive: true });
await cp(source, output, { recursive: true, filter: (path) => !path.endsWith('nginx.conf') });
process.stdout.write('Original ZERONYTH dashboard copied. The live testnet requires the native runtime.\n');
