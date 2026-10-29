/** Writes docs/COMMANDS.md from the live command registry. Run: npm run catalog */
import { writeFileSync } from 'node:fs';
import { allCommands } from '../src/commands/registry';
import { catalog } from './catalog';

writeFileSync('docs/COMMANDS.md', catalog());
console.log(`Wrote docs/COMMANDS.md (${allCommands().length} commands)`);
