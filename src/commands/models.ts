import { stdout } from 'node:process';
import { fetchModels } from '../models.js';

export async function modelsCommand(): Promise<void> {
  if (process.env.ANTHROPIC_API_KEY) {
    stdout.write('ANTHROPIC_API_KEY is set: model calls go to Anthropic directly, pass any Anthropic model id with --model.\n\n');
  }
  const { default: fallback, data } = await fetchModels();
  if (data.length === 0) {
    stdout.write('No coding models are available for your aiolah plan right now.\n');
    return;
  }
  const width = Math.max(...data.map((model) => model.id.length));
  for (const model of data) {
    stdout.write(`${model.id.padEnd(width)}  ${model.name}${model.id === fallback ? '  (default)' : ''}\n`);
  }
  stdout.write('\nUse one with --model <id>, e.g. aiolah rc --model <id>\n');
}
