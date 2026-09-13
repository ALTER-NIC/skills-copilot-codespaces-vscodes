import { startLeverReplica } from './lever-replica.js';
const f = await startLeverReplica(Number(process.env.PORT ?? 8799));
process.stdout.write(`Lever replica running\n  posting: ${f.postingUrl}\n  apply:   ${f.postingUrl}/apply\n`);
