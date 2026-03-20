import 'dotenv/config';
import { handler } from './handler';

const event = {
  municipality: process.argv[2] || undefined,
  batchSize: process.argv[3] ? parseInt(process.argv[3], 10) : 5,
};

console.log('\n=== Invocação Local do NLP Processor ===\n');
console.log('Evento:', JSON.stringify(event, null, 2), '\n');

handler(event).then((response) => {
  console.log('\n=== Resposta ===\n');
  console.log('Status:', response.statusCode);
  console.log('Body:', JSON.stringify(JSON.parse(response.body), null, 2));
  process.exit(0);
});
